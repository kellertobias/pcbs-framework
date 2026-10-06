import { PcbExactRoute, PcbPoint, PcbRouteHint } from '../synth/types';
import {
    BackendNetResult,
    RouterPad,
    RoutingBackend,
    RoutingBackendRequest,
    RoutingBackendResult,
} from './types';

const samePoint = (a: PcbPoint, b: PcbPoint): boolean =>
    Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

const pointInPolygon = (point: PcbPoint, polygon: PcbPoint[]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        if (
            a.y > point.y !== b.y > point.y &&
            point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
        )
            inside = !inside;
    }
    return inside;
};

const distance = (a: PcbPoint, b: PcbPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/** A deliberately conservative first backend for short, low-speed Manhattan routes. */
export class SimpleRoutingBackend implements RoutingBackend {
    readonly id = 'simple';

    route(request: RoutingBackendRequest): RoutingBackendResult {
        const result: RoutingBackendResult = { completed: [], skipped: [], failed: [] };
        for (const net of request.eligibleNets) {
            const pads = [...(request.padsByNet.get(net) ?? [])];
            if (pads.length < 2) {
                result.skipped.push({
                    net,
                    reason: `requires at least two pads; found ${pads.length}`,
                });
                continue;
            }
            try {
                result.completed.push(this.routeNet(net, pads, request));
            } catch (error) {
                result.failed.push({
                    net,
                    reason: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return result;
    }

    private routeNet(
        net: string,
        pads: RouterPad[],
        request: RoutingBackendRequest,
    ): BackendNetResult {
        if (request.snapshot.pcb?.routingRegions?.length)
            throw new Error('Routing regions require the grid or capacity backend.');
        const hint = request.routeHints.find((candidate) => candidate.nets.includes(net));
        const netClass = request.netClasses.find((candidate) => candidate.nets?.includes(net));
        const layer = hint?.preferredLayers?.[0] ?? netClass?.preferredLayers?.[0] ?? 'F.Cu';
        if (layer !== 'F.Cu' && layer !== 'B.Cu')
            throw new Error(`simple backend cannot route on '${layer}'`);
        const width = netClass?.width ?? 0.25;
        const route: PcbExactRoute = { id: `autoroute:${net}`, net, width, segments: [] };
        const ordered = this.nearestNeighbourOrder(pads);
        let segmentIndex = 0;
        let totalLength = 0;

        for (let index = 1; index < ordered.length; index++) {
            const start = ordered[index - 1].at;
            const end = ordered[index].at;
            const points = [start, ...(hint?.waypoints ?? []), end];
            for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
                const from = points[pointIndex - 1];
                const to = points[pointIndex];
                const corner = { x: to.x, y: from.y };
                for (const [a, b] of [
                    [from, corner],
                    [corner, to],
                ] as [PcbPoint, PcbPoint][]) {
                    if (samePoint(a, b)) continue;
                    route.segments!.push({
                        id: `segment-${segmentIndex++}`,
                        start: a,
                        end: b,
                        layer,
                        width,
                    });
                    totalLength += distance(a, b);
                }
            }
        }

        const violations = this.constraintViolations(hint, route, totalLength);
        return {
            net,
            route,
            reason: `routed ${pads.length} pads with ${route.segments!.length} Manhattan segments`,
            constraintViolations: violations,
        };
    }

    private nearestNeighbourOrder(pads: RouterPad[]): RouterPad[] {
        const remaining = pads.slice(1);
        const ordered = [pads[0]];
        while (remaining.length) {
            const current = ordered[ordered.length - 1];
            remaining.sort((a, b) => distance(current.at, a.at) - distance(current.at, b.at));
            ordered.push(remaining.shift()!);
        }
        return ordered;
    }

    private constraintViolations(
        hint: PcbRouteHint | undefined,
        route: PcbExactRoute,
        totalLength: number,
    ): string[] {
        if (!hint) return [];
        const violations: string[] = [];
        const points = (route.segments ?? []).flatMap((segment) => [
            segment.start as PcbPoint,
            segment.end as PcbPoint,
        ]);
        if (
            hint.corridors?.length &&
            points.some(
                (point) => !hint.corridors!.some((polygon) => pointInPolygon(point, polygon)),
            )
        ) {
            violations.push('route leaves every permitted corridor');
        }
        if (
            hint.forbiddenRegions?.some((polygon) =>
                points.some((point) => pointInPolygon(point, polygon)),
            )
        ) {
            violations.push('route enters a forbidden region');
        }
        if (hint.length?.min !== undefined && totalLength < hint.length.min) {
            violations.push(
                `length ${totalLength.toFixed(3)}mm is below minimum ${hint.length.min}mm`,
            );
        }
        if (hint.length?.max !== undefined && totalLength > hint.length.max) {
            violations.push(
                `length ${totalLength.toFixed(3)}mm exceeds maximum ${hint.length.max}mm`,
            );
        }
        if (
            hint.length?.target !== undefined &&
            hint.length.tolerance !== undefined &&
            Math.abs(totalLength - hint.length.target) > hint.length.tolerance
        ) {
            violations.push(
                `length ${totalLength.toFixed(3)}mm is outside ${hint.length.target}±${hint.length.tolerance}mm`,
            );
        }
        if (hint.differential)
            violations.push('simple backend does not jointly route differential pairs');
        if (hint.topology === 'star')
            violations.push('simple backend uses a nearest-neighbour chain, not star topology');
        return violations;
    }
}
