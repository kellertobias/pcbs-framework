// Async ESM/WASM engines behind the framework's synchronous synthesis API.
import fs from 'node:fs';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
console.log = (...args) => console.error(...args);
globalThis.fetch = async () => {
    throw new Error('Routing network access is disabled; engines must solve locally.');
};
try {
    let result;
    if (input.engine === 'capacity') {
        const { AutoroutingPipelineSolver } = await import('@tscircuit/capacity-autorouter');
        const problems = input.forceLegs
            ? input.problem.connections.map((connection) => ({
                  ...input.problem,
                  connections: [connection],
              }))
            : [input.problem];
        const traces = [];
        for (const problem of problems) {
            const solver = new AutoroutingPipelineSolver(problem);
            let steps = 0;
            while (!solver.solved && !solver.failed && steps++ < 1000000) solver.step();
            if (!solver.solved || solver.failed)
                throw new Error(solver.error || 'PCB autorouter exhausted its step budget');
            traces.push(...(solver.getOutputSimpleRouteJson().traces ?? []));
        }
        result = { traces };
    } else if (input.engine === 'libavoid') {
        const { AvoidLib } = await import('libavoid-js');
        await AvoidLib.load();
        const A = AvoidLib.getInstance();
        const reserved = [...(input.reserved ?? [])];
        const onSegment = (p, a, b) =>
            Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) < 1e-7 &&
            p.x >= Math.min(a.x, b.x) - 1e-7 &&
            p.x <= Math.max(a.x, b.x) + 1e-7 &&
            p.y >= Math.min(a.y, b.y) - 1e-7 &&
            p.y <= Math.max(a.y, b.y) + 1e-7;
        const pointBox = (p) => ({ x: p.x - 0.2, y: p.y - 0.2, width: 0.4, height: 0.4 });
        // Visibility-grid fallback: direction-aware spacing permits clean crossings
        // without weakening the minimum separation of parallel runs.
        const gridRoute = (connection, reserved) => {
            const spacing = connection.clearance ?? 0;
            const obstacles = connection.obstacles;
            const segments = reserved.flatMap((item) =>
                item.points.slice(1).map((b, i) => ({ a: item.points[i], b, net: item.net })),
            );
            const foreign = segments.filter((segment) => segment.net !== connection.net);
            const xs = new Set(),
                ys = new Set();
            const add = (p) => {
                xs.add(Number(p.x.toFixed(6)));
                ys.add(Number(p.y.toFixed(6)));
            };
            for (const p of [connection.start, connection.end, ...(connection.waypoints ?? [])])
                add(p);
            for (const box of obstacles) {
                add({ x: box.x - 0.01, y: box.y - 0.01 });
                add({ x: box.x + box.width + 0.01, y: box.y + box.height + 0.01 });
            }
            for (const { a, b } of segments)
                for (const p of [a, b])
                    for (const offset of [-spacing - 0.01, 0, spacing + 0.01])
                        add({ x: p.x + offset, y: p.y + offset });
            const xx = [...xs].sort((a, b) => a - b),
                yy = [...ys].sort((a, b) => a - b),
                width = xx.length;
            const point = (id) => ({ x: xx[id % width], y: yy[Math.floor(id / width)] });
            const id = (p) =>
                xx.indexOf(Number(p.x.toFixed(6))) + width * yy.indexOf(Number(p.y.toFixed(6)));
            const intersects = (a, b, box) =>
                a.x === b.x
                    ? a.x > box.x + 1e-7 &&
                      a.x < box.x + box.width - 1e-7 &&
                      Math.max(a.y, b.y) > box.y + 1e-7 &&
                      Math.min(a.y, b.y) < box.y + box.height - 1e-7
                    : a.y > box.y + 1e-7 &&
                      a.y < box.y + box.height - 1e-7 &&
                      Math.max(a.x, b.x) > box.x + 1e-7 &&
                      Math.min(a.x, b.x) < box.x + box.width - 1e-7;
            const edgeCache = new Map();
            const valid = (aId, bId) => {
                const key = aId < bId ? `${aId}/${bId}` : `${bId}/${aId}`;
                if (edgeCache.has(key)) return edgeCache.get(key);
                const a = point(aId),
                    b = point(bId),
                    horizontal = a.y === b.y,
                    axis = horizontal ? 'x' : 'y',
                    fixed = horizontal ? 'y' : 'x';
                let okay = !obstacles.some((box) => intersects(a, b, box));
                if (okay)
                    for (const segment of segments) {
                        const { a: c, b: d } = segment;
                        if (horizontal === (c.y === d.y)) {
                            const overlap =
                                Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
                                Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
                            const gap = Math.abs(a[fixed] - c[fixed]);
                            if (
                                overlap > 1e-7 &&
                                gap < spacing - 1e-7 &&
                                !(gap < 1e-7 && segment.net === connection.net)
                            ) {
                                okay = false;
                                break;
                            }
                        }
                        if (
                            segment.net !== connection.net &&
                            (onSegment(c, a, b) || onSegment(d, a, b))
                        ) {
                            okay = false;
                            break;
                        }
                    }
                edgeCache.set(key, okay);
                return okay;
            };
            const heap = [];
            const push = (item) => {
                heap.push(item);
                let i = heap.length - 1;
                while (i) {
                    const p = (i - 1) >> 1;
                    if (heap[p].f <= item.f) break;
                    heap[i] = heap[p];
                    i = p;
                }
                heap[i] = item;
            };
            const pop = () => {
                const first = heap[0],
                    last = heap.pop();
                if (heap.length) {
                    let i = 0;
                    while (i * 2 + 1 < heap.length) {
                        let c = i * 2 + 1;
                        if (c + 1 < heap.length && heap[c + 1].f < heap[c].f) c++;
                        if (heap[c].f >= last.f) break;
                        heap[i] = heap[c];
                        i = c;
                    }
                    heap[i] = last;
                }
                return first;
            };
            const targets = [connection.start, ...(connection.waypoints ?? []), connection.end];
            let route = [];
            for (let leg = 1; leg < targets.length; leg++) {
                heap.length = 0;
                const start = id(targets[leg - 1]),
                    end = id(targets[leg]);
                const target = point(end),
                    costs = new Map(),
                    previous = new Map();
                const heuristic = (node) => {
                    const p = point(node);
                    return Math.abs(p.x - target.x) + Math.abs(p.y - target.y);
                };
                costs.set(start * 3, 0);
                push({ state: start * 3, g: 0, f: heuristic(start) });
                let finish;
                while (heap.length) {
                    const current = pop();
                    if (costs.get(current.state) !== current.g) continue;
                    const node = Math.floor(current.state / 3),
                        direction = current.state % 3;
                    if (node === end) {
                        finish = current.state;
                        break;
                    }
                    const x = node % width,
                        y = Math.floor(node / width),
                        p = point(node);
                    for (const [next, newDirection] of [
                        [x > 0 ? node - 1 : -1, 1],
                        [x + 1 < width ? node + 1 : -1, 1],
                        [y > 0 ? node - width : -1, 2],
                        [y + 1 < yy.length ? node + width : -1, 2],
                    ]) {
                        if (next < 0 || !valid(node, next)) continue;
                        if (
                            direction &&
                            direction !== newDirection &&
                            foreign.some(({ a, b }) => onSegment(p, a, b))
                        )
                            continue;
                        const q = point(next),
                            state = next * 3 + newDirection;
                        const g =
                            current.g +
                            Math.abs(q.x - p.x) +
                            Math.abs(q.y - p.y) +
                            (direction && direction !== newDirection ? 5 : 0);
                        if (g >= (costs.get(state) ?? Infinity) - 1e-8) continue;
                        costs.set(state, g);
                        previous.set(state, current.state);
                        push({ state, g, f: g + heuristic(next) });
                    }
                }
                if (finish === undefined)
                    throw new Error(
                        `Cannot satisfy ${spacing} mm schematic wire spacing for ${connection.net}.`,
                    );
                const points = [];
                for (let state = finish; state !== undefined; state = previous.get(state))
                    points.push(point(Math.floor(state / 3)));
                points.reverse();
                route.push(...points.slice(leg === 1 ? 0 : 1));
            }
            return route.filter(
                (p, i) =>
                    i === 0 ||
                    i === route.length - 1 ||
                    !(
                        (route[i - 1].x === p.x && p.x === route[i + 1].x) ||
                        (route[i - 1].y === p.y && p.y === route[i + 1].y)
                    ),
            );
        };
        result = input.connections.map((connection, index) => {
            const net = connection.net ?? String(index);
            const other = reserved.filter((item) => item.net !== net);
            const vertices = other.flatMap((item) => item.points.map(pointBox));
            let path;
            const extra = [];
            for (let attempt = 0; attempt < 8; attempt++) {
                const router = new A.Router(A.RouterFlag.OrthogonalRouting.value);
                router.setRoutingParameter(A.RoutingParameter.segmentPenalty, 10);
                // Permit perpendicular crossings; never trade a short route for a long
                // perimeter detour just to avoid crossing an unrelated signal.
                const barriers = vertices;
                for (const box of [...connection.obstacles, ...barriers, ...extra])
                    new A.ShapeRef(
                        router,
                        new A.Rectangle(
                            new A.Point(box.x, box.y),
                            new A.Point(box.x + box.width, box.y + box.height),
                        ),
                    );
                const connector = new A.ConnRef(
                    router,
                    new A.ConnEnd(new A.Point(connection.start.x, connection.start.y)),
                    new A.ConnEnd(new A.Point(connection.end.x, connection.end.y)),
                );
                connector.setRoutingType(A.ConnType.ConnType_Orthogonal);
                const checkpoints = new A.CheckpointVector();
                for (const p of connection.waypoints ?? [])
                    checkpoints.push_back(new A.Checkpoint(new A.Point(p.x, p.y)));
                connector.setRoutingCheckpoints(checkpoints);
                router.processTransaction();
                const line = connector.displayRoute();
                path = Array.from({ length: line.size() }, (_, i) => ({
                    x: line.at(i).x,
                    y: line.at(i).y,
                }));
                router.delete();
                if (
                    path.length < 2 ||
                    path.some((p, i) => i > 0 && p.x !== path[i - 1].x && p.y !== path[i - 1].y)
                )
                    continue;
                if (
                    (connection.waypoints ?? []).some(
                        (point) => !path.slice(1).some((b, i) => onSegment(point, path[i], b)),
                    )
                )
                    continue;
                const crossesBox = (a, b, box) =>
                    a.x === b.x
                        ? a.x > box.x + 1e-7 &&
                          a.x < box.x + box.width - 1e-7 &&
                          Math.max(a.y, b.y) > box.y + 1e-7 &&
                          Math.min(a.y, b.y) < box.y + box.height - 1e-7
                        : a.y > box.y + 1e-7 &&
                          a.y < box.y + box.height - 1e-7 &&
                          Math.max(a.x, b.x) > box.x + 1e-7 &&
                          Math.min(a.x, b.x) < box.x + box.width - 1e-7;
                if (
                    path
                        .slice(1)
                        .some((b, i) =>
                            connection.obstacles.some((box) => crossesBox(path[i], b, box)),
                        )
                )
                    continue;
                const contacts = [];
                for (const item of other) {
                    for (const p of path)
                        for (let i = 1; i < item.points.length; i++)
                            if (onSegment(p, item.points[i - 1], item.points[i])) contacts.push(p);
                    for (const p of item.points)
                        for (let i = 1; i < path.length; i++)
                            if (onSegment(p, path[i - 1], path[i])) contacts.push(p);
                }
                const spacingBarriers = [];
                if (connection.clearance)
                    for (const item of reserved) {
                        for (let i = 1; i < path.length; i++)
                            for (let j = 1; j < item.points.length; j++) {
                                const a = path[i - 1],
                                    b = path[i],
                                    c = item.points[j - 1],
                                    d = item.points[j];
                                const horizontal = a.y === b.y;
                                if (horizontal !== (c.y === d.y)) continue;
                                const axis = horizontal ? 'x' : 'y',
                                    fixed = horizontal ? 'y' : 'x';
                                const overlap =
                                    Math.min(
                                        Math.max(a[axis], b[axis]),
                                        Math.max(c[axis], d[axis]),
                                    ) -
                                    Math.max(
                                        Math.min(a[axis], b[axis]),
                                        Math.min(c[axis], d[axis]),
                                    );
                                const gap = Math.abs(a[fixed] - c[fixed]);
                                if (
                                    overlap <= 1e-7 ||
                                    gap >= connection.clearance - 1e-7 ||
                                    (item.net === net && gap < 1e-7)
                                )
                                    continue;
                                const r = connection.clearance;
                                spacingBarriers.push({
                                    x: Math.min(c.x, d.x) - r,
                                    y: Math.min(c.y, d.y) - r,
                                    width: Math.abs(c.x - d.x) + 2 * r,
                                    height: Math.abs(c.y - d.y) + 2 * r,
                                });
                            }
                    }
                if (spacingBarriers.length) {
                    extra.push(...spacingBarriers);
                    continue;
                }
                if (!contacts.length) {
                    reserved.push({ net, points: path });
                    return path;
                }
                extra.push(...contacts.map(pointBox));
            }
            path = gridRoute(connection, reserved);
            reserved.push({ net, points: path });
            return path;
        });
    } else throw new Error(`Unknown routing engine '${input.engine}'`);
    process.stdout.write(JSON.stringify({ result }));
} catch (error) {
    process.stdout.write(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
    );
    process.exitCode = 1;
}
