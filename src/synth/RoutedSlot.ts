import type { PcbContour, PcbRoutedSlot } from './types';
/** Explicit capsule contour. True tangent-side and axial end points prevent
 * degenerate arcs, independent of the framework's shorthand slot serializer. */
export function routedSlotContour(slot: PcbRoutedSlot): PcbContour {
    const dx = slot.end.x - slot.start.x,
        dy = slot.end.y - slot.start.y;
    const length = Math.hypot(dx, dy),
        r = slot.width / 2;
    if (length === 0 || r <= 0) throw new Error('A routed slot requires length and width');
    const ux = dx / length,
        uy = dy / length;
    const a = { x: slot.start.x - uy * r, y: slot.start.y + ux * r };
    const b = { x: slot.end.x - uy * r, y: slot.end.y + ux * r };
    const c = { x: slot.end.x + uy * r, y: slot.end.y - ux * r };
    const d = { x: slot.start.x + uy * r, y: slot.start.y - ux * r };
    return {
        id: slot.id,
        edges: [
            { kind: 'line', start: a, end: b },
            {
                kind: 'arc',
                start: b,
                mid: { x: slot.end.x + ux * r, y: slot.end.y + uy * r },
                end: c,
            },
            { kind: 'line', start: c, end: d },
            {
                kind: 'arc',
                start: d,
                mid: { x: slot.start.x - ux * r, y: slot.start.y - uy * r },
                end: a,
            },
        ],
    };
}
