import type { Component } from './Component';
import type { CircuitSnapshot, PcbPoint, PcbPosition } from './types';
import {
    footprint,
    footprintBounds,
    padRects,
    contourRects,
    transformRect,
    bounds,
    type Rect,
} from '../kicad/FootprintGeometry';

export interface PcbPackingOptions {
    width: number;
    height: number;
    libraryDirectories?: readonly string[];
    pitch?: number;
    edgeClearance?: number;
    clearance?: number;
    priority?: (component: Component<any>) => number;
    /** Board-specific physical regions and preferred centres; not generated track coordinates. */
    hint?: (component: Component<any>) => { area?: Rect; target?: PcbPoint; clearance?: number };
}

/** Pack unpositioned rear components while preserving fixed modules, front bodies and drill envelopes. */
export function packPcbComponents(
    snapshot: CircuitSnapshot,
    options: PcbPackingOptions,
): CircuitSnapshot {
    const { width, height } = options,
        pitch = options.pitch ?? 0.5,
        edge = options.edgeClearance ?? 0.6,
        gap = options.clearance ?? 0.3;
    if (
        ![width, height, pitch].every((n) => Number.isFinite(n) && n > 0) ||
        ![edge, gap].every((n) => Number.isFinite(n) && n >= 0)
    )
        throw new Error('Invalid physical PCB packing dimensions.');
    const columns = Math.ceil(width / pitch),
        rows = Math.ceil(height / pitch),
        occupied = new Uint8Array(columns * rows),
        frontBodies: Rect[] = [];
    const mark = (rect: Rect, padding = gap) => {
        for (
            let y = Math.max(0, Math.floor((rect.y1 - padding) / pitch));
            y < Math.min(rows, Math.ceil((rect.y2 + padding) / pitch));
            y++
        )
            for (
                let x = Math.max(0, Math.floor((rect.x1 - padding) / pitch));
                x < Math.min(columns, Math.ceil((rect.x2 + padding) / pitch));
                x++
            )
                occupied[y * columns + x] = 1;
    };
    const intersects = (a: Rect, b: Rect) =>
        a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && b.y1 < a.y2;
    const available = (rect: Rect, throughHole: boolean) => {
        if (rect.x1 < edge || rect.y1 < edge || rect.x2 > width - edge || rect.y2 > height - edge)
            return false;
        if (throughHole && frontBodies.some((body) => intersects(body, rect))) return false;
        for (let y = Math.floor(rect.y1 / pitch); y < Math.ceil(rect.y2 / pitch); y++)
            for (let x = Math.floor(rect.x1 / pitch); x < Math.ceil(rect.x2 / pitch); x++)
                if (occupied[y * columns + x]) return false;
        return true;
    };
    const physical = snapshot.components.filter((c) => c.footprint && c.footprint !== 'DNC');
    const isFixed = (component: Component<any>) => {
        let parent: any = component;
        while (parent) {
            if (parent.pcbPosition) return true;
            parent = parent.parent;
        }
        return false;
    };
    const fixed = physical.filter(isFixed),
        pending = physical.filter((c) => !fixed.includes(c));
    for (const cutout of snapshot.pcb?.cutouts ?? [])
        if (cutout.points) mark(bounds(cutout.points), 0.5);
    for (const keepout of snapshot.pcb?.keepouts ?? [])
        if (keepout.footprints) mark(bounds(keepout.points));
    for (const component of fixed) {
        const position = component.absolutePcbPosition,
            shape = footprint(component.footprint, options.libraryDirectories);
        if (position.side === 'back') mark(transformRect(footprintBounds(shape), position));
        else {
            frontBodies.push(transformRect(footprintBounds(shape), position));
            for (const rect of [...padRects(shape, true), ...contourRects(shape, 'Edge.Cuts')])
                mark(transformRect(rect, position));
        }
    }
    pending.sort((a, b) => (options.priority?.(a) ?? 0) - (options.priority?.(b) ?? 0));
    for (const component of pending) {
        const shape = footprint(component.footprint, options.libraryDirectories),
            local = footprintBounds(shape),
            throughHole = JSON.stringify(shape).includes('"thru_hole"');
        const hint = options.hint?.(component) ?? {},
            area = hint.area ?? { x1: edge, y1: edge, x2: width - edge, y2: height - edge },
            target = hint.target ?? { x: width / 2, y: height / 2 };
        if (
            ![area.x1, area.y1, area.x2, area.y2, target.x, target.y].every(Number.isFinite) ||
            area.x1 >= area.x2 ||
            area.y1 >= area.y2
        )
            throw new Error(`Invalid placement hint for ${component.ref}.`);
        const candidates: Array<PcbPosition & { box: Rect; distance: number }> = [];
        for (const rotation of [0, 90]) {
            const box = transformRect(local, { x: 0, y: 0, rotation, side: 'back' });
            for (
                let y = Math.ceil((area.y1 - box.y1) / pitch) * pitch;
                y + box.y2 <= area.y2;
                y += pitch
            )
                for (
                    let x = Math.ceil((area.x1 - box.x1) / pitch) * pitch;
                    x + box.x2 <= area.x2;
                    x += pitch
                )
                    candidates.push({
                        x,
                        y,
                        rotation,
                        box,
                        distance: (x - target.x) ** 2 + (y - target.y) ** 2,
                    });
        }
        candidates.sort((a, b) => a.distance - b.distance);
        const chosen = candidates.find((p) =>
            available(
                { x1: p.x + p.box.x1, y1: p.y + p.box.y1, x2: p.x + p.box.x2, y2: p.y + p.box.y2 },
                throughHole,
            ),
        );
        if (!chosen)
            throw new Error(`No clear rear placement for ${snapshot.name}:${component.ref}.`);
        const { x, y, rotation, box } = chosen;
        Object.assign(component, { pcbPosition: { x, y, rotation, side: 'back' } });
        let parent = component.parent;
        while (parent) {
            Object.assign(parent, { pcbPosition: { x: 0, y: 0 } });
            parent = parent.parent;
        }
        mark(
            { x1: x + box.x1, y1: y + box.y1, x2: x + box.x2, y2: y + box.y2 },
            hint.clearance ?? gap,
        );
    }
    return snapshot;
}
