import { runRoutingLibrary } from '../router/LibraryRunner';
export interface Point {
    x: number;
    y: number;
}
export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface WireRoutingRequest {
    net?: string;
    clearance?: number;
    start: Point;
    end: Point;
    obstacles: Box[];
    waypoints?: Point[];
}
export function pointOnSegment(p: Point, a: Point, b: Point, tolerance = 1e-6): boolean {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < tolerance) return Math.hypot(p.x - a.x, p.y - a.y) < tolerance;
    return (
        Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / length < tolerance &&
        p.x >= Math.min(a.x, b.x) - tolerance &&
        p.x <= Math.max(a.x, b.x) + tolerance &&
        p.y >= Math.min(a.y, b.y) - tolerance &&
        p.y <= Math.max(a.y, b.y) + tolerance
    );
}
/** Orthogonal obstacle routing with exact, ordered checkpoints (no coordinate quantization). */
export class Router {
    constructor(_gridSize = 1.27) {}
    route(start: Point, end: Point, obstacles: Box[], waypoints: Point[] = []): Point[] {
        return this.routeMany([{ start, end, obstacles, waypoints }])[0];
    }
    routeMany(
        requests: WireRoutingRequest[],
        reserved: { net: string; points: Point[] }[] = [],
    ): Point[][] {
        if (!requests.length) return [];
        const contains = (box: Box, point: Point) =>
            point.x >= box.x &&
            point.x <= box.x + box.width &&
            point.y >= box.y &&
            point.y <= box.y + box.height;
        const connections = requests.map((request) => {
            for (const point of [request.start, ...(request.waypoints ?? []), request.end]) {
                if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
                    throw new Error('Schematic routing requires finite coordinates.');
            }
            const obstacles = request.obstacles.filter(
                (box) => !contains(box, request.start) && !contains(box, request.end),
            );
            if (request.waypoints?.some((point) => obstacles.some((box) => contains(box, point))))
                throw new Error('Required schematic waypoint lies inside an obstacle.');
            return { ...request, obstacles };
        });
        const paths = runRoutingLibrary<Point[][]>({ engine: 'libavoid', connections, reserved });
        return paths.map((path, index) => {
            const request = connections[index];
            if (
                path.length < 2 ||
                !pointOnSegment(request.start, path[0], path[0]) ||
                !pointOnSegment(request.end, path[path.length - 1], path[path.length - 1])
            )
                throw new Error('Schematic router did not connect the requested terminals.');
            for (let i = 1; i < path.length; i++) {
                const a = path[i - 1],
                    b = path[i];
                if (a.x !== b.x && a.y !== b.y)
                    throw new Error(
                        `Schematic router returned a non-orthogonal wire for ${request.net}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`,
                    );
                for (const box of request.obstacles) {
                    const intersects =
                        a.x === b.x
                            ? a.x > box.x + 1e-7 &&
                              a.x < box.x + box.width - 1e-7 &&
                              Math.max(a.y, b.y) > box.y + 1e-7 &&
                              Math.min(a.y, b.y) < box.y + box.height - 1e-7
                            : a.y > box.y + 1e-7 &&
                              a.y < box.y + box.height - 1e-7 &&
                              Math.max(a.x, b.x) > box.x + 1e-7 &&
                              Math.min(a.x, b.x) < box.x + box.width - 1e-7;
                    if (intersects)
                        throw new Error(
                            `Schematic route ${request.net} crosses obstacle ${JSON.stringify(box)} at ${JSON.stringify(a)} -> ${JSON.stringify(b)}.`,
                        );
                }
            }
            // Insert checkpoints lying inside straight segments so they remain explicit support vertices.
            let cursor = 0;
            for (const waypoint of request.waypoints ?? []) {
                let found = false;
                for (let i = Math.max(1, cursor); i < path.length; i++) {
                    if (!pointOnSegment(waypoint, path[i - 1], path[i])) continue;
                    if (!pointOnSegment(waypoint, path[i], path[i])) path.splice(i, 0, waypoint);
                    cursor = i;
                    found = true;
                    break;
                }
                if (!found)
                    throw new Error(
                        `Schematic router ${request.net} bypassed waypoint ${JSON.stringify(waypoint)} in ${JSON.stringify(path)}.`,
                    );
            }
            return path;
        });
    }
}

/** Crossings are allowed; overlapping parallel runs must retain the requested gap. */
export function assertParallelWireSpacing(
    wires: { p1: Point; p2: Point; netName: string }[],
    minimum: number,
): void {
    for (let i = 0; i < wires.length; i++)
        for (let j = i + 1; j < wires.length; j++) {
            const { p1: a, p2: b } = wires[i],
                { p1: c, p2: d } = wires[j];
            const horizontal = Math.abs(a.y - b.y) < 1e-6;
            const axis = horizontal ? 'x' : 'y',
                fixed = horizontal ? 'y' : 'x';
            if (Math.abs(c[fixed] - d[fixed]) > 1e-6) continue;
            const overlap =
                Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
                Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
            const gap = Math.abs(a[fixed] - c[fixed]);
            if (overlap <= 1e-6 || (gap < 1e-6 && wires[i].netName === wires[j].netName)) continue;
            if (gap < minimum - 1e-6)
                throw new Error(
                    `Schematic wires ${wires[i].netName}/${wires[j].netName} are ${gap.toFixed(3)} mm apart; at least ${minimum} mm is required.`,
                );
        }
}
