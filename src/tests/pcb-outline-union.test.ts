import { expect, it } from 'vitest';
import { joinPcbOutlines } from '../synth/PcbOutlineUnion';
const rect = (x: number, y: number, w: number, h: number) => [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
];
it('joins detached sections through two webs while keeping the routed gap', () => {
    const joined = joinPcbOutlines([
        rect(0, 0, 10, 5),
        rect(0, 7, 10, 3),
        rect(1, 4.9, 1, 2.2),
        rect(8, 4.9, 1, 2.2),
    ]);
    expect(joined.cutouts).toHaveLength(1);
    expect(Math.max(...joined.outline.map((p) => p.y))).toBe(10);
    expect(Math.min(...joined.cutouts[0].points!.map((p) => p.y))).toBe(5);
});
it('rejects missing webs instead of producing multiple detached fabrication boards', () => {
    expect(() => joinPcbOutlines([rect(0, 0, 10, 5), rect(0, 7, 10, 3)])).toThrow(
        'connected laminate',
    );
});

it('quantizes joins before clipping so decimal web edges do not create zero-length cuts', () => {
    const shape = joinPcbOutlines([
        rect(0, 0, 10, 5),
        rect(0.2, 7, 1.8, 3),
        rect(1.1 - 0.9, 4.9, 1.8, 2.2),
    ]);
    for (const ring of [shape.outline, ...shape.cutouts.map((c) => c.points!)]) {
        for (let i = 0; i < ring.length; i++)
            expect(
                Math.hypot(
                    ring[i].x - ring[(i + 1) % ring.length].x,
                    ring[i].y - ring[(i + 1) % ring.length].y,
                ),
            ).toBeGreaterThan(0.000001);
    }
});
