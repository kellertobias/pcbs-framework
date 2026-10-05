import { PcbExactRoute, PcbPoint } from '../synth/types';
import { pointOnSegment } from '../kicad/Router';
import { RoutingBackend, RoutingBackendRequest, RoutingBackendResult } from './types';
import { runRoutingLibrary } from './LibraryRunner';
import {
    boardRoutingGeometry,
    CopperLayer,
    CopperObstacle,
    inPolygon,
    rectObstacle,
    segmentInRegions,
    segmentDistance,
} from './BoardRoutingGeometry';
type Wire = {
    route_type: 'wire';
    x: number;
    y: number;
    layer: string;
    width: number;
};
type Via = {
    route_type: 'via';
    x: number;
    y: number;
    from_layer: string;
    to_layer: string;
    via_diameter?: number;
};
interface Output {
    traces?: Array<{
        connection_name: string;
        route: Array<Wire | Via>;
    }>;
}
/** Local tscircuit engine with hard waypoint legs and conservative clearance validation. */
export class CapacityRoutingBackend implements RoutingBackend {
    readonly id = 'capacity';
    route(request: RoutingBackendRequest): RoutingBackendResult {
        const result: RoutingBackendResult = { completed: [], skipped: [], failed: [] };
        let geometry: ReturnType<typeof boardRoutingGeometry>;
        try {
            // A selected reroute can fail. Its old copper must remain an obstacle for other nets.
            geometry = boardRoutingGeometry(request.boardSource, new Set());
        } catch (error) {
            return {
                ...result,
                failed: request.eligibleNets.map((net) => ({ net, reason: String(error) })),
            };
        }
        const obstacles = [...geometry.obstacles];
        for (const net of request.eligibleNets) {
            try {
                const hints = request.routeHints.filter((hint) => hint.nets.includes(net));
                if (hints.length > 1) throw new Error('Use one consolidated route hint per net.');
                const hint = hints[0];
                if (hint?.differential)
                    throw new Error(
                        'Differential-pair routing requires a specialized joint-pair backend.',
                    );
                const rules = request.netClasses.find(
                    (rule) =>
                        rule.nets?.includes(net) ||
                        rule.name ===
                            request.snapshot.nets.find((item) => item.name === net)?.class,
                );
                const width = rules?.width ?? 0.25,
                    clearance = rules?.clearance ?? 0.2,
                    viaDiameter = rules?.viaDiameter ?? 0.6,
                    viaDrill = rules?.viaDrill ?? 0.3;
                if (
                    ![width, clearance, viaDiameter, viaDrill].every(Number.isFinite) ||
                    width <= 0 ||
                    clearance < 0 ||
                    viaDiameter <= viaDrill ||
                    viaDrill <= 0
                )
                    throw new Error('Invalid routing width, clearance or via dimensions.');
                const allowed = hint?.preferredLayers ?? rules?.preferredLayers ?? ['F.Cu', 'B.Cu'];
                if (
                    !allowed.length ||
                    allowed.some((layer) => layer !== 'F.Cu' && layer !== 'B.Cu')
                )
                    throw new Error('Unsupported PCB routing layers.');
                const layerNames = new Map<CopperLayer, string>(
                    allowed.length === 1
                        ? [[allowed[0], 'top']]
                        : [
                              ['F.Cu', 'top'],
                              ['B.Cu', 'bottom'],
                          ],
                );
                const actualLayer = (name: string): CopperLayer => {
                    const layer = [...layerNames].find(([, value]) => value === name)?.[0];
                    if (!layer) throw new Error(`Router violated allowed layers: ${name}`);
                    return layer;
                };
                const terminals = geometry.terminals.filter((pad) => pad.net === net);
                if (terminals.length < 2) {
                    result.skipped.push({ net, reason: 'requires at least two connected pads' });
                    continue;
                }
                const endpoint = (pad: (typeof terminals)[number]) => {
                    const layers = pad.layers
                        .filter((layer) => layerNames.has(layer))
                        .map((layer) => layerNames.get(layer)!);
                    if (!layers.length)
                        throw new Error(
                            `Pad ${pad.ref}.${pad.pad} cannot be reached on the allowed layers.`,
                        );
                    return layers.length === 1
                        ? { ...pad.at, layer: layers[0] }
                        : { ...pad.at, layers };
                };
                const connections: Array<{
                    name: string;
                    pointsToConnect: unknown[];
                    nominalTraceWidth: number;
                }> = [];
                const targets: Array<PcbPoint[]> = [];
                for (let index = 1; index < terminals.length; index++) {
                    const start = terminals[hint?.topology === 'star' ? 0 : index - 1],
                        end = terminals[index];
                    const support = index === 1 ? (hint?.waypoints ?? []) : [];
                    const points = [
                        endpoint(start),
                        ...support.map((point) => ({ ...point, layer: 'top' })),
                        endpoint(end),
                    ];
                    for (let leg = 1; leg < points.length; leg++) {
                        connections.push({
                            name: `${net}/${index}/${leg}`,
                            pointsToConnect: [points[leg - 1], points[leg]],
                            nominalTraceWidth: width,
                        });
                        targets.push([points[leg - 1] as PcbPoint, points[leg] as PcbPoint]);
                    }
                }
                const names = connections.map((connection) => connection.name);
                const forbidden = (hint?.forbiddenRegions ?? []).map((polygon) =>
                    rectObstacle(polygon, 0, allowed),
                );
                const inputObstacles = [...obstacles, ...forbidden].flatMap((obstacle) => {
                    const layers = obstacle.layers
                        .filter((layer) => layerNames.has(layer))
                        .map((layer) => layerNames.get(layer)!);
                    return layers.length
                        ? [
                              {
                                  type: 'rect',
                                  center: obstacle.center,
                                  width: obstacle.width + 2 * clearance,
                                  height: obstacle.height + 2 * clearance,
                                  layers,
                                  connectedTo: obstacle.net === net ? names : [],
                              },
                          ]
                        : [];
                });
                const output = runRoutingLibrary<Output>({
                    engine: 'capacity',
                    forceLegs: true,
                    problem: {
                        layerCount: allowed.length,
                        minTraceWidth: width,
                        minViaPadDiameter: viaDiameter,
                        minViaHoleDiameter: viaDrill,
                        defaultObstacleMargin: clearance,
                        minBoardEdgeClearance: clearance,
                        bounds: geometry.bounds,
                        obstacles: inputObstacles,
                        connections,
                    },
                });
                // The library rounds coordinates to 0.001 mm. Restore only the
                // terminal endpoints to their exact board positions, before both
                // connectivity and clearance validation (never accept a gap).
                for (const trace of output.traces ?? []) {
                    const index = connections.findIndex((c) => c.name === trace.connection_name);
                    if (index < 0) continue;
                    for (const item of [trace.route[0], trace.route[trace.route.length - 1]]) {
                        if (!item) continue;
                        const target = targets[index].find(
                            (p) => Math.hypot(p.x - item.x, p.y - item.y) <= 0.00072,
                        );
                        if (target) {
                            item.x = target.x;
                            item.y = target.y;
                        }
                    }
                }
                const route: PcbExactRoute = {
                    id: `autoroute:${net}`,
                    net,
                    width,
                    segments: [],
                    vias: [],
                };
                for (const trace of output.traces ?? []) {
                    let previous:
                        | {
                              at: PcbPoint;
                              layer: CopperLayer;
                          }
                        | undefined;
                    for (const item of trace.route) {
                        const at = { x: item.x, y: item.y };
                        if (!Number.isFinite(at.x) || !Number.isFinite(at.y))
                            throw new Error('Router returned non-finite geometry.');
                        if (item.route_type === 'via') {
                            const from = actualLayer(item.from_layer),
                                to = actualLayer(item.to_layer);
                            if (
                                previous &&
                                Math.hypot(previous.at.x - at.x, previous.at.y - at.y) > 1e-8
                            )
                                route.segments!.push({
                                    start: previous.at,
                                    end: at,
                                    layer: previous.layer,
                                    width,
                                });
                            route.vias!.push({
                                at,
                                fromLayer: from,
                                toLayer: to,
                                diameter: viaDiameter,
                                drill: viaDrill,
                            });
                            previous = { at, layer: to };
                        } else {
                            const layer = actualLayer(item.layer);
                            if (
                                previous &&
                                Math.hypot(previous.at.x - at.x, previous.at.y - at.y) > 1e-8
                            ) {
                                if (layer !== previous.layer)
                                    throw new Error('Router changed copper layers without a via.');
                                route.segments!.push({ start: previous.at, end: at, layer, width });
                            }
                            previous = { at, layer };
                        }
                    }
                }
                if (!route.segments!.length)
                    throw new Error('Router returned no connected copper.');
                // Check each mandatory leg, not just whether some disconnected copper happens to touch its supports.
                for (const [index, connection] of connections.entries()) {
                    const traces = (output.traces ?? []).filter(
                        (trace) => trace.connection_name === connection.name,
                    );
                    const segments = traces.flatMap((trace) =>
                        trace.route.slice(1).map((item, i) => [trace.route[i], item]),
                    );
                    for (const target of targets[index])
                        if (!segments.some(([a, b]) => pointOnSegment(target, a, b)))
                            throw new Error(
                                `Router bypassed a required terminal or waypoint in ${connection.name}.`,
                            );
                }
                const boardAllowed = (point: PcbPoint) =>
                    geometry.contours.reduce(
                        (inside, polygon) => (inPolygon(point, polygon) ? !inside : inside),
                        false,
                    );
                const check = (a: PcbPoint, b: PcbPoint, layer: CopperLayer, radius: number) => {
                    if (!segmentInRegions(a, b, geometry.contours, boardAllowed))
                        throw new Error('Route leaves the board or crosses a cutout.');
                    for (const contour of geometry.contours)
                        for (let i = 0; i < contour.length; i++) {
                            if (
                                segmentDistance(
                                    a,
                                    b,
                                    contour[i],
                                    contour[(i + 1) % contour.length],
                                ) <
                                radius + clearance + 0.001
                            )
                                throw new Error(
                                    'Route violates clearance to the board edge or a cutout.',
                                );
                        }
                    if (
                        hint?.corridors?.length &&
                        !segmentInRegions(a, b, hint.corridors, (p) =>
                            hint.corridors!.some((poly) => inPolygon(p, poly)),
                        )
                    )
                        throw new Error('Route leaves its permitted corridors.');
                    if (
                        hint?.forbiddenRegions?.length &&
                        !segmentInRegions(
                            a,
                            b,
                            hint.forbiddenRegions,
                            (p) => !hint.forbiddenRegions!.some((poly) => inPolygon(p, poly)),
                        )
                    )
                        throw new Error('Route crosses a forbidden region.');
                    for (const obstacle of obstacles) {
                        if (obstacle.net === net || !obstacle.layers.includes(layer)) continue;
                        const dx = obstacle.width / 2 + radius + clearance - 1e-6,
                            dy = obstacle.height / 2 + radius + clearance - 1e-6,
                            c = obstacle.center;
                        const polygon = [
                            { x: c.x - dx, y: c.y - dy },
                            { x: c.x + dx, y: c.y - dy },
                            { x: c.x + dx, y: c.y + dy },
                            { x: c.x - dx, y: c.y + dy },
                        ];
                        if (!segmentInRegions(a, b, [polygon], (p) => !inPolygon(p, polygon)))
                            throw new Error(
                                'Route violates clearance to existing copper or a pad.',
                            );
                    }
                };
                for (const segment of route.segments!)
                    check(
                        segment.start as PcbPoint,
                        segment.end as PcbPoint,
                        segment.layer,
                        width / 2,
                    );
                for (const via of route.vias!)
                    for (const layer of allowed)
                        check(via.at as PcbPoint, via.at as PcbPoint, layer, viaDiameter / 2);
                if (hint?.maxVias !== undefined && route.vias!.length > hint.maxVias)
                    throw new Error('Router exceeded the permitted via count.');
                const length = route.segments!.reduce(
                    (sum, s) =>
                        sum +
                        Math.hypot(
                            (s.end as PcbPoint).x - (s.start as PcbPoint).x,
                            (s.end as PcbPoint).y - (s.start as PcbPoint).y,
                        ),
                    0,
                );
                const target = hint?.length ?? rules?.length;
                if (
                    target &&
                    ((target.min !== undefined && length < target.min) ||
                        (target.max !== undefined && length > target.max) ||
                        (target.target !== undefined &&
                            target.tolerance !== undefined &&
                            Math.abs(length - target.target) > target.tolerance))
                )
                    throw new Error('Router could not satisfy the required length constraint.');
                for (const segment of route.segments!)
                    obstacles.push(
                        rectObstacle(
                            [segment.start as PcbPoint, segment.end as PcbPoint],
                            width / 2,
                            [segment.layer],
                            net,
                        ),
                    );
                for (const via of route.vias!)
                    obstacles.push({
                        center: via.at as PcbPoint,
                        width: viaDiameter,
                        height: viaDiameter,
                        layers: ['F.Cu', 'B.Cu'],
                        net,
                    });
                result.completed.push({
                    net,
                    route,
                    reason: `tscircuit routed ${terminals.length} pads through ${hint?.waypoints?.length ?? 0} required support points`,
                });
            } catch (error) {
                result.failed.push({
                    net,
                    reason: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return result;
    }
}
