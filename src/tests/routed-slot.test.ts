import { describe, expect, it } from 'vitest';
import { routedSlotContour } from '../synth/RoutedSlot';
describe('routed capsule contour', () => {
    for (const end of [
        { x: 10, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
    ])
        it(`preserves tangent/axial points for ${end.x},${end.y}`, () => {
            const contour = routedSlotContour({
                id: 'slot',
                start: { x: 0, y: 0 },
                end,
                width: 1.8,
            });
            const edges = contour.edges!;
            edges.forEach((e, i) => {
                expect(e.end).toEqual(edges[(i + 1) % edges.length].start);
            });
            for (const edge of edges)
                if (edge.kind === 'arc') {
                    expect(edge.mid).not.toEqual(edge.start);
                    expect(edge.mid).not.toEqual(edge.end);
                    const area =
                        (edge.mid.x - edge.start.x) * (edge.end.y - edge.start.y) -
                        (edge.mid.y - edge.start.y) * (edge.end.x - edge.start.x);
                    expect(Math.abs(area)).toBeGreaterThan(0.1);
                }
        });
});
