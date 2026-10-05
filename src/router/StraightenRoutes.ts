import type { PcbExactRoute, PcbPoint } from '../synth/types';
import {
    boardRoutingGeometry,
    inPolygon,
    segmentDistance,
    segmentInRegions,
} from './BoardRoutingGeometry';

type Segment = NonNullable<PcbExactRoute['segments']>[number];
const key = (point: PcbPoint) => `${point.x.toFixed(6)},${point.y.toFixed(6)}`;
const same = (a: PcbPoint, b: PcbPoint) => key(a) === key(b);

/** Replace stair-step chains with straight / 45-degree paths while preserving
 * every pad, via and branch junction. Clearance is checked against the actual
 * framework board geometry, including foreign traces and the real outline.
 * Native DRC is still required after synthesis and zone filling.
 */
export function straightenRoutes(
    boardSource: string,
    routes: PcbExactRoute[],
    protectedPoints: Record<string, PcbPoint[]> = {},
): PcbExactRoute[] {
    const geometry = boardRoutingGeometry(boardSource, new Set());
    const committed: Array<{ net: string; segment: Segment }> = [];
    return routes.map((route) => {
        const segments = route.segments ?? [];
        if (segments.some((segment) => !('x' in segment.start) || !('x' in segment.end))) {
            throw new Error('Straightening requires resolved board coordinates.');
        }
        const fixedPoints = new Set([
            ...(protectedPoints[route.net] ?? []).map(key),
            ...geometry.terminals.filter((pad) => pad.net === route.net).map((pad) => key(pad.at)),
            ...(route.vias ?? []).map((via) => key(via.at as PcbPoint)),
        ]);
        const foreign = geometry.obstacles.filter((obstacle) => obstacle.net !== route.net);
        const inside = (point: PcbPoint) =>
            geometry.contours.reduce(
                (yes, contour) => (inPolygon(point, contour) ? !yes : yes),
                false,
            );
        const legal = (a: PcbPoint, b: PcbPoint, segment: Segment) => {
            const radius = (segment.width ?? route.width ?? 0.15) / 2;
            if (!segmentInRegions(a, b, geometry.contours, inside)) return false;
            for (const contour of geometry.contours) {
                for (let index = 0; index < contour.length; index++) {
                    if (
                        segmentDistance(
                            a,
                            b,
                            contour[index],
                            contour[(index + 1) % contour.length],
                        ) <
                        radius + 0.2
                    )
                        return false;
                }
            }
            for (const obstacle of foreign) {
                if (!obstacle.layers.includes(segment.layer)) continue;
                const dx = obstacle.width / 2 + radius + 0.15001;
                const dy = obstacle.height / 2 + radius + 0.15001;
                const left = obstacle.center.x - dx;
                const right = obstacle.center.x + dx;
                const top = obstacle.center.y - dy;
                const bottom = obstacle.center.y + dy;
                if (
                    Math.max(a.x, b.x) < left ||
                    Math.min(a.x, b.x) > right ||
                    Math.max(a.y, b.y) < top ||
                    Math.min(a.y, b.y) > bottom
                )
                    continue;
                const polygon = [
                    { x: left, y: top },
                    { x: right, y: top },
                    { x: right, y: bottom },
                    { x: left, y: bottom },
                ];
                if (!segmentInRegions(a, b, [polygon], (point) => !inPolygon(point, polygon)))
                    return false;
            }
            // Earlier replacements must also be obstacles. Checking each net only
            // against the original copper could let two new shortcuts collide.
            for (const previous of committed) {
                if (previous.net === route.net || previous.segment.layer !== segment.layer)
                    continue;
                const clearance = radius + (previous.segment.width ?? 0.15) / 2 + 0.15001;
                if (
                    segmentDistance(
                        a,
                        b,
                        previous.segment.start as PcbPoint,
                        previous.segment.end as PcbPoint,
                    ) < clearance
                )
                    return false;
            }
            return true;
        };

        // A chain can only continue through an ordinary degree-two node on the
        // same layer and with the same width. Other connections are fixed.
        const adjacency = new Map<string, number[]>();
        segments.forEach((segment, index) => {
            for (const point of [segment.start, segment.end]) {
                const pointKey = key(point as PcbPoint);
                const entries = adjacency.get(pointKey) ?? [];
                entries.push(index);
                adjacency.set(pointKey, entries);
            }
        });
        const boundary = (point: PcbPoint, segment: Segment) => {
            const adjacent = adjacency.get(key(point)) ?? [];
            return (
                fixedPoints.has(key(point)) ||
                adjacent.length !== 2 ||
                adjacent.some(
                    (index) =>
                        segments[index].layer !== segment.layer ||
                        segments[index].width !== segment.width,
                )
            );
        };
        const visited = new Set<number>();
        const result: Segment[] = [];
        const ordered = segments
            .map((_, index) => index)
            .sort(
                (a, b) =>
                    Number(
                        !boundary(segments[a].start as PcbPoint, segments[a]) &&
                            !boundary(segments[a].end as PcbPoint, segments[a]),
                    ) -
                    Number(
                        !boundary(segments[b].start as PcbPoint, segments[b]) &&
                            !boundary(segments[b].end as PcbPoint, segments[b]),
                    ),
            );
        for (const index of ordered) {
            if (visited.has(index)) continue;
            const template = segments[index];
            const start = boundary(template.start as PcbPoint, template)
                ? (template.start as PcbPoint)
                : (template.end as PcbPoint);
            const points = [start];
            let current = index;
            while (!visited.has(current)) {
                visited.add(current);
                const segment = segments[current];
                const end = same(points[points.length - 1], segment.start as PcbPoint)
                    ? (segment.end as PcbPoint)
                    : (segment.start as PcbPoint);
                points.push(end);
                if (boundary(end, template)) break;
                const next = adjacency.get(key(end))?.find((candidate) => !visited.has(candidate));
                if (next === undefined) break;
                current = next;
            }
            let cursor = 0;
            while (cursor < points.length - 1) {
                let replacement: PcbPoint[] | undefined;
                let last = cursor + 1;
                for (let target = points.length - 1; target > cursor + 1; target--) {
                    const a = points[cursor],
                        b = points[target];
                    const dx = b.x - a.x,
                        dy = b.y - a.y;
                    const diagonal = Math.min(Math.abs(dx), Math.abs(dy));
                    const bends = [
                        { x: a.x + Math.sign(dx) * diagonal, y: a.y + Math.sign(dy) * diagonal },
                        { x: b.x - Math.sign(dx) * diagonal, y: b.y - Math.sign(dy) * diagonal },
                    ];
                    for (const bend of bends) {
                        const candidate = [a, bend, b].filter(
                            (point, i, all) => !i || !same(point, all[i - 1]),
                        );
                        if (
                            candidate
                                .slice(1)
                                .every((point, i) => legal(candidate[i], point, template))
                        ) {
                            replacement = candidate;
                            last = target;
                            break;
                        }
                    }
                    if (replacement) break;
                }
                const path = replacement ?? [points[cursor], points[last]];
                for (let i = 1; i < path.length; i++) {
                    result.push({
                        start: path[i - 1],
                        end: path[i],
                        layer: template.layer,
                        width: template.width,
                    });
                }
                cursor = last;
            }
        }
        committed.push(...result.map((segment) => ({ net: route.net, segment })));
        return { ...route, segments: result };
    });
}
