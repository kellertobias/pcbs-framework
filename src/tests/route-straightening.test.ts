import { describe, expect, it } from 'vitest';
import { straightenRoutes } from '../router/StraightenRoutes';
import type { PcbExactRoute } from '@tobisk/pcbs';

const board = `(kicad_pcb
  (net 1 "SIGNAL") (net 2 "OTHER")
  (gr_rect (start 0 0) (end 20 20) (layer "Edge.Cuts"))
  (footprint "obstacle" (at 10 10) (property "Reference" "R1")
    (pad "1" smd rect (at 0 0) (size 3 3) (layers "F.Cu") (net 2 "OTHER"))))`;
const route = (points: number[][]): PcbExactRoute => ({
    id: 'signal',
    net: 'SIGNAL',
    segments: points.slice(1).map((end, i) => ({
        start: { x: points[i][0], y: points[i][1] },
        end: { x: end[0], y: end[1] },
        layer: 'F.Cu',
        width: 0.15,
    })),
});

describe('route straightening with real copper obstacles', () => {
    it('reduces a staircase to a straight segment', () => {
        const [result] = straightenRoutes(board, [
            route([
                [2, 2],
                [4, 2],
                [4, 4],
                [6, 4],
                [6, 6],
            ]),
        ]);
        expect(result.segments).toHaveLength(1);
        expect(result.segments?.[0].start).toEqual({ x: 2, y: 2 });
        expect(result.segments?.[0].end).toEqual({ x: 6, y: 6 });
    });
    it('keeps the detour around a foreign copper pad', () => {
        const [result] = straightenRoutes(board, [
            route([
                [5, 10],
                [5, 6],
                [15, 6],
                [15, 10],
            ]),
        ]);
        expect(result.segments?.length).toBeGreaterThan(1);
        expect(
            result.segments?.some(
                (segment) =>
                    JSON.stringify(segment.start) === '{"x":5,"y":10}' &&
                    JSON.stringify(segment.end) === '{"x":15,"y":10}',
            ),
        ).toBe(false);
    });
    it('preserves a branch connection even when the trunk could be shortened', () => {
        const branched = route([
            [2, 2],
            [4, 2],
            [6, 2],
        ]);
        branched.segments?.push({
            start: { x: 4, y: 2 },
            end: { x: 4, y: 5 },
            layer: 'F.Cu',
            width: 0.15,
        });
        const [result] = straightenRoutes(board, [branched]);
        expect(
            result.segments?.filter(
                (segment) =>
                    JSON.stringify(segment.start) === '{"x":4,"y":2}' ||
                    JSON.stringify(segment.end) === '{"x":4,"y":2}',
            ),
        ).toHaveLength(3);
    });
});
