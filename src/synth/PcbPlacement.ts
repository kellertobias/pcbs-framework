import type { CircuitSnapshot, PcbPosition } from './types';

/** Strict physical placement from measured coordinates; relative offsets remain explicit millimetres. */
export function placePcbComponents(
    snapshot: CircuitSnapshot,
    positions: Record<string, PcbPosition>,
    options: {
        defaultSide?: 'front' | 'back';
        relative?: Record<
            string,
            { anchor: string; x: number; y: number; rotation?: number; side?: 'front' | 'back' }
        >;
    } = {},
): CircuitSnapshot {
    const resolved = new Map<string, PcbPosition>();
    const active = new Set<string>();
    const positionFor = (ref: string): PcbPosition => {
        if (resolved.has(ref)) return resolved.get(ref)!;
        if (active.has(ref)) throw new Error(`Cyclic PCB placement for ${ref}.`);
        active.add(ref);
        const relative = options.relative?.[ref];
        if (positions[ref] && relative)
            throw new Error(`PCB placement for ${ref} is both absolute and relative.`);
        const anchor = relative ? positionFor(relative.anchor) : undefined;
        const p = relative
            ? {
                  x: anchor!.x + relative.x,
                  y: anchor!.y + relative.y,
                  rotation: relative.rotation,
                  side: relative.side ?? anchor!.side,
              }
            : positions[ref];
        if (
            !p ||
            !Number.isFinite(p.x) ||
            !Number.isFinite(p.y) ||
            (p.rotation !== undefined && !Number.isFinite(p.rotation))
        )
            throw new Error(`Missing or invalid explicit PCB position for ${ref}.`);
        const result = { side: options.defaultSide ?? 'front', ...p } as PcbPosition;
        resolved.set(ref, result);
        active.delete(ref);
        return result;
    };
    for (const component of snapshot.components) {
        if (!component.footprint || component.footprint === 'DNC') continue;
        Object.assign(component, { pcbPosition: { ...positionFor(component.ref) } });
    }
    return snapshot;
}
