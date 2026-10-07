import type { LayoutPart, GroupLayoutResult } from './GroupedSchematicLayout';
export interface PlacementWire {
    p1: { x: number; y: number };
    p2: { x: number; y: number };
    netName: string;
}
/** Score actual emitted routing, not just component centres. Crossings of distinct
 * nets and excessive lead lengths cost space/readability; same-net junctions do not.
 */
export function placementRoutingScore(
    wires: PlacementWire[],
    layout: GroupLayoutResult,
    parts: LayoutPart[] = [],
) {
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
    const point = (part: LayoutPart, pin: LayoutPart['pins'][number]) => {
        const p = layout.positions.get(part.id)!;
        const angle = ((p.rotation ?? 0) * Math.PI) / 180;
        return {
            x: p.x + pin.x * Math.cos(angle) - pin.y * Math.sin(angle),
            y: p.y - pin.x * Math.sin(angle) - pin.y * Math.cos(angle),
        };
    };
    let conventions = 0;
    for (const part of parts) {
        const signal = part.pins.find((p) => p.net && !p.power);
        const rail = part.pins.find((p) => p.power);
        const probe = part.pins.length === 1;
        const shunt = part.pins.length === 2 && !!rail && !!signal;
        if (!signal || (!probe && !shunt)) continue;
        const p = point(part, signal);
        const frame = layout.frames.find((f) => f.members.includes(part.id));
        const hosts = parts
            .filter((owner) => owner.pins.length > 2 && frame?.members.includes(owner.id))
            .flatMap((owner) =>
                owner.pins.filter((pin) => pin.net === signal.net).map((pin) => point(owner, pin)),
            );
        if (hosts.length)
            conventions += probe
                ? Math.max(
                      0,
                      Math.min(...hosts.map((h) => Math.abs(h.x - p.x) + Math.abs(h.y - p.y))) -
                          5.08,
                  ) * 2
                : Math.min(...hosts.map((h) => Math.abs(h.y - p.y))) * 2;
        if (shunt) {
            const q = point(part, rail!);
            const ground = /gnd|vss/i.test(rail!.net ?? '');
            // A supply shunt reads vertically, with its signal terminal aligned
            // to the device row; test points attach directly to that row.
            if (Math.abs(q.x - p.x) > 0.001) conventions += 25.4;
            if (ground ? q.y < p.y : q.y > p.y) conventions += 25.4;
        }
    }
    return {
        cost: length + crossings * 25.4 + area * 0.005 + conventions,
        conventions,
        length,
        crossings,
        area,
        wireLengths,
    };
}
