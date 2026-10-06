import polygonClipping, { type Polygon } from 'polygon-clipping';
import type { PcbContour, PcbPoint } from './types';

/** Join physical section outlines and breakaway webs into one laminate perimeter. */
export function joinPcbOutlines(polygons: readonly (readonly PcbPoint[])[]): {
    outline: PcbPoint[];
    cutouts: PcbContour[];
} {
    if (
        !polygons.length ||
        polygons.some(
            (points) =>
                points.length < 3 ||
                points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)),
        )
    )
        throw new Error('PCB outline union needs finite polygons with at least three points.');
    const shapes: Polygon[] = polygons.map((points) => [
        points.map((p) => [Math.round(p.x * 1e6), Math.round(p.y * 1e6)]),
    ]);
    const merged = polygonClipping.union(shapes[0], ...shapes.slice(1));
    if (merged.length !== 1)
        throw new Error('Breakaway webs must join every PCB section into one connected laminate.');
    const points = (ring: number[][]) =>
        ring.slice(0, -1).map(([x, y]) => ({ x: x / 1e6, y: y / 1e6 }));
    return {
        outline: points(merged[0][0]),
        cutouts: merged[0]
            .slice(1)
            .map((ring, index) => ({ id: `joined-outline-gap-${index}`, points: points(ring) })),
    };
}
