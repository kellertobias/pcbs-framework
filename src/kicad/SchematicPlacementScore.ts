import type { GroupLayoutResult } from './GroupedSchematicLayout';
export interface PlacementWire {
    p1: { x: number; y: number };
    p2: { x: number; y: number };
    netName: string;
}
/** Score actual emitted routing, not just component centres. Crossings of distinct
 * nets and excessive lead lengths cost space/readability; same-net junctions do not.
 */
export function placementRoutingScore(wires: PlacementWire[], layout: GroupLayoutResult) {
    const wireLengths = new Map<string, number>();
    let length = 0,
        crossings = 0;
    for (const wire of wires) {
        const distance = Math.abs(wire.p1.x - wire.p2.x) + Math.abs(wire.p1.y - wire.p2.y);
        length += distance;
        wireLengths.set(wire.netName, (wireLengths.get(wire.netName) ?? 0) + distance);
    }
    for (let i = 0; i < wires.length; i++)
        for (let j = i + 1; j < wires.length; j++) {
            const a = wires[i],
                b = wires[j];
            if (a.netName === b.netName) continue;
            const ah = Math.abs(a.p1.y - a.p2.y) < 0.001,
                bh = Math.abs(b.p1.y - b.p2.y) < 0.001;
            if (ah === bh) continue;
            const h = ah ? a : b,
                v = ah ? b : a;
            if (
                v.p1.x > Math.min(h.p1.x, h.p2.x) + 0.001 &&
                v.p1.x < Math.max(h.p1.x, h.p2.x) - 0.001 &&
                h.p1.y > Math.min(v.p1.y, v.p2.y) + 0.001 &&
                h.p1.y < Math.max(v.p1.y, v.p2.y) - 0.001
            )
                crossings++;
        }
    const area = layout.frames.reduce((sum, f) => sum + f.width * f.height, 0);
    return { cost: length + crossings * 25.4 + area * 0.005, length, crossings, area, wireLengths };
}
