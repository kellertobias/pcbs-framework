import type { Component } from './Component';
import { footprint, footprintBounds, transformRect, type Rect } from '../kicad/FootprintGeometry';

/** Deterministic packing of a disposable captured circuit for placement review.
 * Projects select fixed obstacles, priority and allowed regions. This engine
 * applies the shared grid, edge margins, orientation and collision rules.
 */
export class ReviewPlacement {
    private readonly cols: number;
    private readonly rows: number;
    private readonly grid: Uint8Array;
    constructor(
        readonly width: number,
        readonly height: number,
        readonly step = 0.5,
    ) {
        if (!(width > 0 && height > 0 && step > 0) || ![width, height, step].every(Number.isFinite))
            throw new Error('Placement dimensions and grid step must be finite and positive');
        this.cols = Math.ceil(width / step);
        this.rows = Math.ceil(height / step);
        this.grid = new Uint8Array(this.cols * this.rows);
    }
    occupy(r: Rect, gap = 0.25) {
        const { cols, rows, grid, step: STEP } = this;
        for (
            let y = Math.max(0, Math.floor((r.y1 - gap) / STEP));
            y < Math.min(rows, Math.ceil((r.y2 + gap) / STEP));
            y++
        )
            for (
                let x = Math.max(0, Math.floor((r.x1 - gap) / STEP));
                x < Math.min(cols, Math.ceil((r.x2 + gap) / STEP));
                x++
            )
                grid[y * cols + x] = 1;
    }
    fits(r: Rect) {
        const { width, height, cols, grid, step: STEP } = this;
        if (r.x1 < 0.6 || r.y1 < 0.6 || r.x2 > width - 0.6 || r.y2 > height - 0.6) return false;
        for (let y = Math.floor(r.y1 / STEP); y < Math.ceil(r.y2 / STEP); y++)
            for (let x = Math.floor(r.x1 / STEP); x < Math.ceil(r.x2 / STEP); x++)
                if (grid[y * cols + x]) return false;
        return true;
    }
    assign(c: Component<any>, x: number, y: number, rotation = 0) {
        // Components use immutable constructor metadata in the framework. A capture
        // is a disposable generated instance; assigning placement here leaves source
        // controls and subsequently captured snapshots untouched.
        Object.assign(c, { pcbPosition: { x, y, rotation, side: 'back' } });
        let parent = c.parent;
        while (parent) {
            Object.assign(parent, { pcbPosition: { x: 0, y: 0 } });
            parent = parent.parent;
        }
    }
    place(c: Component<any>, area: Rect) {
        const STEP = this.step;
        const r = footprintBounds(footprint(c.footprint));
        let found = false;
        search: for (const rotation of [0, 90]) {
            const local = transformRect(r, { x: 0, y: 0, rotation, side: 'back' });
            for (
                let y = Math.ceil(area.y1 / STEP) * STEP;
                y + local.y2 - local.y1 <= area.y2;
                y += STEP
            )
                for (
                    let x = Math.ceil(area.x1 / STEP) * STEP;
                    x + local.x2 - local.x1 <= area.x2;
                    x += STEP
                ) {
                    const box = {
                        x1: x,
                        y1: y,
                        x2: x + local.x2 - local.x1,
                        y2: y + local.y2 - local.y1,
                    };
                    if (!this.fits(box)) continue;
                    this.assign(c, x - local.x1, y - local.y1, rotation);
                    this.occupy(box);
                    found = true;
                    break search;
                }
        }
        if (!found)
            throw new Error(`No on-board review placement available for ${c.ref} (${c.footprint})`);
    }
}
