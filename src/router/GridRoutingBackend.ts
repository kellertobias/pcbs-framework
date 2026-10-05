import { RoutingBackend, RoutingBackendRequest, RoutingBackendResult } from './types';
import { PcbPoint, PcbExactRoute } from '../synth/types';
import {
    boardRoutingGeometry,
    CopperLayer,
    inPolygon,
    segmentDistance,
    segmentInRegions,
} from './BoardRoutingGeometry';
/** Two-layer fine-grid A* escape router. All endpoint joins and grid edges are
 * checked against the real board contour and copper before emitting geometry. */
export class GridRoutingBackend implements RoutingBackend {
    readonly id = 'grid';
    route(request: RoutingBackendRequest): RoutingBackendResult {
        let best: RoutingBackendResult | undefined,
            current = request;
        for (let attempt = 0; attempt < 8; attempt++) {
            const result = this.routeAttempt(current, attempt);
            console.error(
                `[grid] pass ${attempt + 1}: ${result.completed.length} complete, ${result.failed.length} failed`,
            );
            if (!best || result.failed.length < best.failed.length) best = result;
            if (!result.failed.length) break;
            // Negotiate congestion by routing previously blocked nets first on a fresh
            // copy of the unchanged source. Keep only the best complete pass.
            const priority = result.failed.map((f) => f.net);
            current = {
                ...request,
                routeHints: [{ id: 'grid-negotiation', nets: priority }, ...request.routeHints],
            };
        }
        return best!;
    }
    private routeAttempt(request: RoutingBackendRequest, attempt: number): RoutingBackendResult {
        const out: RoutingBackendResult = { completed: [], skipped: [], failed: [] };
        const geometry = boardRoutingGeometry(request.boardSource, new Set());
        const obstacles = [...geometry.obstacles];
        const pitch = 0.05,
            b = geometry.bounds,
            nx = Math.ceil((b.maxX - b.minX) / pitch) + 1,
            ny = Math.ceil((b.maxY - b.minY) / pitch) + 1,
            plane = nx * ny;
        const pos = (id: number): PcbPoint => ({
            x: b.minX + (id % nx) * pitch,
            y: b.minY + (Math.floor(id / nx) % ny) * pitch,
        });
        const layer = (id: number): CopperLayer => (id >= plane ? 'B.Cu' : 'F.Cu');
        const idx = (x: number, y: number, z: number) => x + y * nx + z * plane;
        const priority = [
            ...new Set(
                request.routeHints.filter((hint) => !hint.routeZonePads).flatMap((h) => h.nets),
            ),
        ];
        const rank = (n: string) =>
            priority.includes(n)
                ? priority.indexOf(n) - 100
                : geometry.terminals.filter((p) => p.net === n).length;
        // Reserve short fanouts of narrow SMT pads first. This prevents early
        // cross-board tracks from sealing later IC pins off from both routing layers.
        const fanouts = new Map<string, PcbExactRoute>();
        const candidates = geometry.terminals.filter(
            (t) =>
                t.layers.length === 1 &&
                geometry.obstacles.some(
                    (o) =>
                        o.net === t.net &&
                        Math.hypot(o.center.x - t.at.x, o.center.y - t.at.y) < 1e-6 &&
                        o.width > 1 &&
                        o.width < 2 &&
                        o.height < 0.5,
                ),
        );
        for (const t of candidates) {
            if (!t.net || request.existingCopperNets.has(t.net)) continue;
            const r =
                request.netClasses.find((r) => r.nets?.includes(t.net!)) ??
                request.netClasses.find((r) => r.name === 'Signal');
            const w = r?.width ?? 0.18,
                d = r?.viaDiameter ?? 0.5,
                dr = r?.viaDrill ?? 0.25,
                c = r?.clearance ?? 0.15;
            const siblings = geometry.terminals.filter((p) => p.ref === t.ref),
                cx = siblings.reduce((sum, p) => sum + p.at.x, 0) / siblings.length,
                sign = t.at.x < cx ? -1 : 1;
            const clear = (a: PcbPoint, z: CopperLayer, rad: number) =>
                geometry.contours.every((contour) =>
                    contour.every(
                        (p, i) =>
                            segmentDistance(a, a, p, contour[(i + 1) % contour.length]) >=
                            rad + 0.2,
                    ),
                ) &&
                geometry.contours.reduce((yes, p) => (inPolygon(a, p) ? !yes : yes), false) &&
                obstacles.every(
                    (o) =>
                        o.net === t.net ||
                        !o.layers.includes(z) ||
                        Math.abs(a.x - o.center.x) >= o.width / 2 + rad + c + 1e-5 ||
                        Math.abs(a.y - o.center.y) >= o.height / 2 + rad + c + 1e-5,
                );
            let end: PcbPoint | undefined;
            for (const direction of [-sign, sign]) {
                for (let dist = 0.8; dist <= 2.5 && !end; dist += 0.1)
                    for (const dy of [0, 0.05, -0.05, 0.1, -0.1]) {
                        const q = { x: t.at.x + direction * dist, y: t.at.y + dy };
                        if (!clear(q, 'F.Cu', d / 2) || !clear(q, 'B.Cu', d / 2)) continue;
                        const steps = Math.ceil(dist / 0.05);
                        if (
                            Array.from({ length: steps + 1 }, (_, i) =>
                                clear(
                                    {
                                        x: t.at.x + ((q.x - t.at.x) * i) / steps,
                                        y: t.at.y + ((q.y - t.at.y) * i) / steps,
                                    },
                                    t.layers[0],
                                    w / 2,
                                ),
                            ).every(Boolean)
                        ) {
                            end = q;
                            break;
                        }
                    }
                if (end) break;
            }
            if (!end) continue;
            const f = fanouts.get(t.net) ?? {
                id: `escape:${t.net}`,
                net: t.net,
                width: w,
                segments: [],
                vias: [],
            };
            f.segments!.push({ start: { ...t.at }, end, layer: t.layers[0], width: w });
            f.vias!.push({ at: end, diameter: d, drill: dr, fromLayer: 'F.Cu', toLayer: 'B.Cu' });
            fanouts.set(t.net, f);
            // Small rectangles avoid overblocking diagonal escapes.
            const n = Math.ceil(Math.hypot(end.x - t.at.x, end.y - t.at.y) / 0.1);
            for (let i = 0; i < n; i++) {
                const a = {
                        x: t.at.x + ((end.x - t.at.x) * i) / n,
                        y: t.at.y + ((end.y - t.at.y) * i) / n,
                    },
                    b = {
                        x: t.at.x + ((end.x - t.at.x) * (i + 1)) / n,
                        y: t.at.y + ((end.y - t.at.y) * (i + 1)) / n,
                    };
                obstacles.push({
                    center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                    width: Math.abs(b.x - a.x) + w,
                    height: Math.abs(b.y - a.y) + w,
                    layers: t.layers,
                    net: t.net,
                });
            }
            obstacles.push({
                center: end,
                width: d,
                height: d,
                layers: ['F.Cu', 'B.Cu'],
                net: t.net,
            });
            t.at = end;
            t.layers = ['F.Cu', 'B.Cu'];
        }
        // Reserve declared cross-board waypoint trunks before ordinary routing.
        // All their joints are emitted as connected copper, not just ignored hints.
        const trunks = new Map<string, PcbExactRoute>();
        for (const h of request.routeHints.filter((h) => (h.waypoints?.length ?? 0) > 1))
            for (const net of h.nets) {
                const r =
                    request.netClasses.find((r) => r.nets?.includes(net)) ??
                    request.netClasses.find((r) => r.name === 'Signal');
                const w = r?.width ?? 0.15,
                    z = h.waypointLayer ?? 'F.Cu';
                const t: PcbExactRoute = {
                    id: `trunk:${net}`,
                    net,
                    width: w,
                    segments: [],
                    vias: [],
                };
                for (let i = 1; i < h.waypoints!.length; i++) {
                    const a = h.waypoints![i - 1],
                        b = h.waypoints![i];
                    t.segments!.push({ start: a, end: b, layer: z, width: w });
                    const n = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / 0.1));
                    for (let j = 0; j < n; j++) {
                        const p = {
                                x: a.x + ((b.x - a.x) * j) / n,
                                y: a.y + ((b.y - a.y) * j) / n,
                            },
                            q = {
                                x: a.x + ((b.x - a.x) * (j + 1)) / n,
                                y: a.y + ((b.y - a.y) * (j + 1)) / n,
                            };
                        obstacles.push({
                            center: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
                            width: Math.abs(q.x - p.x) + w,
                            height: Math.abs(q.y - p.y) + w,
                            layers: [z],
                            net,
                        });
                    }
                }
                trunks.set(net, t);
            }
        const order = [...request.eligibleNets].sort((a, c) => rank(a) - rank(c));
        for (const net of order) {
            try {
                const rule =
                    request.netClasses.find((r) => r.nets?.includes(net)) ??
                    request.netClasses.find((r) => r.name === 'Signal');
                const width = rule?.width ?? 0.18,
                    clearance = rule?.clearance ?? 0.15,
                    diameter = rule?.viaDiameter ?? 0.5,
                    drill = rule?.viaDrill ?? 0.25;
                const hints = request.routeHints.filter((h) => h.nets.includes(net));
                if (
                    hints.some(
                        (h) =>
                            h.corridors?.length ||
                            h.forbiddenRegions?.length ||
                            h.differential ||
                            h.length,
                    )
                )
                    throw Error('Grid backend does not support this route hint; use capacity.');
                const allowed = hints[0]?.preferredLayers ??
                    rule?.preferredLayers ?? ['F.Cu', 'B.Cu'];
                if (
                    request.snapshot.pcb?.zones?.some((z) => z.net === net) &&
                    !hints.some((h) => h.routeZonePads)
                ) {
                    const f = fanouts.get(net);
                    if (f)
                        out.completed.push({
                            net,
                            route: f,
                            reason: 'ground pad escape vias; zone fill requires DRC verification',
                        });
                    else
                        out.skipped.push({
                            net,
                            reason: 'zone-backed net; requires filled-zone DRC verification',
                        });
                    continue;
                }
                const terminals = geometry.terminals.filter((p) => p.net === net);
                if (terminals.length < 2) {
                    out.skipped.push({ net, reason: 'one terminal' });
                    continue;
                }
                const foreign = obstacles.filter((o) => o.net !== net);
                const bins = new Map<string, typeof foreign>();
                for (const o of foreign)
                    for (
                        let x = Math.floor((o.center.x - o.width / 2 - 1) / 2);
                        x <= Math.floor((o.center.x + o.width / 2 + 1) / 2);
                        x++
                    )
                        for (
                            let y = Math.floor((o.center.y - o.height / 2 - 1) / 2);
                            y <= Math.floor((o.center.y + o.height / 2 + 1) / 2);
                            y++
                        ) {
                            const k = x + ',' + y;
                            const list = bins.get(k) ?? [];
                            list.push(o);
                            bins.set(k, list);
                        }
                const nearby = (a: PcbPoint, c: PcbPoint) => {
                    const result = new Set<(typeof foreign)[number]>();
                    for (
                        let x = Math.floor(Math.min(a.x, c.x) / 2);
                        x <= Math.floor(Math.max(a.x, c.x) / 2);
                        x++
                    )
                        for (
                            let y = Math.floor(Math.min(a.y, c.y) / 2);
                            y <= Math.floor(Math.max(a.y, c.y) / 2);
                            y++
                        )
                            for (const o of bins.get(x + ',' + y) ?? []) result.add(o);
                    return result;
                };
                const margin = (n?: string) =>
                    Math.max(
                        clearance,
                        request.netClasses.find((r) => r.nets?.includes(n ?? ''))?.clearance ??
                            0.15,
                    );
                const inside = (p: PcbPoint) =>
                    geometry.contours.reduce((yes, c) => (inPolygon(p, c) ? !yes : yes), false);
                const legal = (a: PcbPoint, c: PcbPoint, z: CopperLayer, radius: number) => {
                    if (!segmentInRegions(a, c, geometry.contours, inside)) return false;
                    for (const contour of geometry.contours)
                        for (let i = 0; i < contour.length; i++)
                            if (
                                segmentDistance(
                                    a,
                                    c,
                                    contour[i],
                                    contour[(i + 1) % contour.length],
                                ) <
                                radius + Math.max(0.2, clearance) - 1e-6
                            )
                                return false;
                    for (const o of nearby(a, c)) {
                        if (!o.layers.includes(z)) continue;
                        const m = margin(o.net) + radius + 1e-5;
                        const dx = o.width / 2 + m,
                            dy = o.height / 2 + m;
                        if (
                            Math.max(a.x, c.x) < o.center.x - dx ||
                            Math.min(a.x, c.x) > o.center.x + dx ||
                            Math.max(a.y, c.y) < o.center.y - dy ||
                            Math.min(a.y, c.y) > o.center.y + dy
                        )
                            continue;
                        const p = [
                            { x: o.center.x - dx, y: o.center.y - dy },
                            { x: o.center.x + dx, y: o.center.y - dy },
                            { x: o.center.x + dx, y: o.center.y + dy },
                            { x: o.center.x - dx, y: o.center.y + dy },
                        ];
                        if (!segmentInRegions(a, c, [p], (q) => !inPolygon(q, p))) return false;
                    }
                    return true;
                };
                const cache = new Int8Array(plane * 2),
                    vcache = new Int8Array(plane);
                const valid = (id: number) => {
                    if (!cache[id])
                        cache[id] =
                            allowed.includes(layer(id)) &&
                            legal(pos(id), pos(id), layer(id), width / 2)
                                ? 1
                                : -1;
                    return cache[id] === 1;
                };
                const via = (id: number) => {
                    const k = id % plane;
                    if (!vcache[k])
                        vcache[k] =
                            allowed.length === 2 &&
                            legal(pos(k), pos(k), 'F.Cu', diameter / 2) &&
                            legal(pos(k), pos(k), 'B.Cu', diameter / 2)
                                ? 1
                                : -1;
                    return vcache[k] === 1;
                };
                const endpoints = (p: (typeof terminals)[number]) => {
                    const ids: number[] = [];
                    const x = Math.round((p.at.x - b.minX) / pitch),
                        y = Math.round((p.at.y - b.minY) / pitch);
                    for (let z = 0; z < 2; z++)
                        if (p.layers.includes(z ? 'B.Cu' : 'F.Cu'))
                            for (let dy = -2; dy <= 2; dy++)
                                for (let dx = -2; dx <= 2; dx++) {
                                    if (x + dx < 0 || x + dx >= nx || y + dy < 0 || y + dy >= ny)
                                        continue;
                                    const id = idx(x + dx, y + dy, z);
                                    if (valid(id) && legal(p.at, pos(id), layer(id), width / 2))
                                        ids.push(id);
                                }
                    return ids;
                };
                const f = fanouts.get(net),
                    trunk = trunks.get(net);
                const route: PcbExactRoute = {
                    id: `autoroute:${net}`,
                    net,
                    width,
                    segments: [...(f?.segments ?? []), ...(trunk?.segments ?? [])],
                    vias: [...(f?.vias ?? [])],
                };
                const remaining = terminals.slice(1),
                    ordered = [terminals[0]];
                while (remaining.length) {
                    const a = ordered[ordered.length - 1];
                    remaining.sort(
                        (p, q) =>
                            Math.hypot(p.at.x - a.at.x, p.at.y - a.at.y) -
                            Math.hypot(q.at.x - a.at.x, q.at.y - a.at.y),
                    );
                    ordered.push(remaining.shift()!);
                }
                const pairs = trunk
                    ? terminals.map((t) => {
                          const h = hints.find((h) => h.waypoints?.length)!,
                              z = h.waypointLayer ?? 'F.Cu',
                              p = [...h.waypoints!].sort(
                                  (a, b) =>
                                      Math.hypot(a.x - t.at.x, a.y - t.at.y) -
                                      Math.hypot(b.x - t.at.x, b.y - t.at.y),
                              )[0];
                          return [t, { ref: 'waypoint', pad: '', net, at: p, layers: [z] }] as [
                              typeof t,
                              typeof t,
                          ];
                      })
                    : ordered.slice(1).map((t, i) => [ordered[i], t] as [typeof t, typeof t]);
                for (const [a, c] of pairs) {
                    if (Math.hypot(a.at.x - c.at.x, a.at.y - c.at.y) < 1e-6) continue;
                    // Use direct joins first, particularly tiny IC bypass and charge-pump nets.
                    const same = a.layers.find(
                        (z) =>
                            c.layers.includes(z) &&
                            allowed.includes(z) &&
                            legal(a.at, c.at, z, width / 2),
                    );
                    if (same) {
                        route.segments!.push({ start: a.at, end: c.at, layer: same, width });
                        continue;
                    }
                    const starts = endpoints(a),
                        ends = new Set(endpoints(c));
                    if (!starts.length || !ends.size)
                        throw Error(`No legal pad escape: ${a.ref}.${a.pad} -> ${c.ref}.${c.pad}`);
                    const cost = new Float64Array(plane * 2);
                    cost.fill(Infinity);
                    const prev = new Int32Array(plane * 2);
                    prev.fill(-1);
                    const closed = new Uint8Array(plane * 2);
                    const heap: Array<[number, number]> = [];
                    const push = (id: number, f: number) => {
                        let i = heap.length;
                        heap.push([id, f]);
                        while (i > 0) {
                            const p = (i - 1) >> 1;
                            if (heap[p][1] <= f) break;
                            heap[i] = heap[p];
                            i = p;
                        }
                        heap[i] = [id, f];
                    };
                    const pop = () => {
                        const result = heap[0],
                            last = heap.pop()!;
                        if (heap.length) {
                            let i = 0;
                            while (i * 2 + 1 < heap.length) {
                                let k = i * 2 + 1;
                                if (k + 1 < heap.length && heap[k + 1][1] < heap[k][1]) k++;
                                if (last[1] <= heap[k][1]) break;
                                heap[i] = heap[k];
                                i = k;
                            }
                            heap[i] = last;
                        }
                        return result[0];
                    };
                    const heuristic = (id: number) =>
                        Math.hypot(pos(id).x - c.at.x, pos(id).y - c.at.y);
                    for (const id of starts) {
                        cost[id] = Math.hypot(pos(id).x - a.at.x, pos(id).y - a.at.y);
                        push(id, cost[id] + heuristic(id));
                    }
                    let found = -1,
                        steps = 0;
                    while (heap.length && steps++ < plane * 2) {
                        const id = pop();
                        if (closed[id]) continue;
                        closed[id] = 1;
                        if (ends.has(id)) {
                            found = id;
                            break;
                        }
                        const x = id % nx,
                            y = Math.floor(id / nx) % ny,
                            z = id >= plane ? 1 : 0;
                        const next: Array<[number, number]> = [];
                        for (const [dx, dy] of [
                            [1, 0],
                            [-1, 0],
                            [0, 1],
                            [0, -1],
                            [1, 1],
                            [-1, 1],
                            [1, -1],
                            [-1, -1],
                        ])
                            if (x + dx >= 0 && x + dx < nx && y + dy >= 0 && y + dy < ny) {
                                const n = idx(x + dx, y + dy, z);
                                if (
                                    valid(n) &&
                                    (!dx ||
                                        !dy ||
                                        (valid(idx(x + dx, y, z)) && valid(idx(x, y + dy, z))))
                                )
                                    next.push([n, pitch * Math.hypot(dx, dy)]);
                            }
                        if (via(id))
                            next.push([
                                id >= plane ? id - plane : id + plane,
                                0.35 + attempt * 0.15,
                            ]);
                        for (const [n, w] of next)
                            if (!closed[n] && cost[id] + w < cost[n]) {
                                cost[n] = cost[id] + w;
                                prev[n] = id;
                                push(n, cost[n] + heuristic(n));
                            }
                    }
                    if (found < 0)
                        throw Error(`No grid path: ${a.ref}.${a.pad} -> ${c.ref}.${c.pad}`);
                    const ids = [found];
                    while (prev[ids[0]] >= 0) ids.unshift(prev[ids[0]]);
                    const nodes = [
                        { at: a.at, layer: layer(ids[0]) },
                        ...ids.map((id) => ({ at: pos(id), layer: layer(id) })),
                        { at: c.at, layer: layer(found) },
                    ];
                    for (let i = 1; i < nodes.length; i++) {
                        const p = nodes[i - 1],
                            q = nodes[i];
                        if (p.layer !== q.layer) {
                            route.vias!.push({
                                at: p.at,
                                diameter,
                                drill,
                                fromLayer: 'F.Cu',
                                toLayer: 'B.Cu',
                            });
                            continue;
                        }
                        if (Math.hypot(p.at.x - q.at.x, p.at.y - q.at.y) > 1e-8)
                            route.segments!.push({ start: p.at, end: q.at, layer: p.layer, width });
                    }
                }
                // Coalesce collinear grid edges. Copper is unchanged; native files and DRC
                // remain small enough to inspect rather than containing thousands of stubs.
                const compact: NonNullable<PcbExactRoute['segments']> = [];
                for (const s of route.segments!) {
                    const p = compact[compact.length - 1];
                    if (p && p.layer === s.layer && p.width === s.width) {
                        const a = p.start as PcbPoint,
                            b = p.end as PcbPoint,
                            c = s.start as PcbPoint,
                            d = s.end as PcbPoint;
                        const ux = b.x - a.x,
                            uy = b.y - a.y,
                            vx = d.x - c.x,
                            vy = d.y - c.y;
                        if (
                            Math.hypot(b.x - c.x, b.y - c.y) < 1e-8 &&
                            Math.abs(ux * vy - uy * vx) < 1e-8 &&
                            ux * vx + uy * vy > 0
                        ) {
                            p.end = s.end;
                            continue;
                        }
                    }
                    compact.push(s);
                }
                route.segments = compact;
                route.vias = route.vias!.filter(
                    (v, i, all) =>
                        all.findIndex(
                            (q) =>
                                Math.hypot(
                                    (v.at as PcbPoint).x - (q.at as PcbPoint).x,
                                    (v.at as PcbPoint).y - (q.at as PcbPoint).y,
                                ) < 1e-8,
                        ) === i,
                );
                // Validate coalesced geometry independently of grid occupancy.
                for (const s of route.segments!)
                    if (!legal(s.start as PcbPoint, s.end as PcbPoint, s.layer, width / 2))
                        throw Error('Final grid route violates copper clearance');
                // Reserve actual copper for subsequent nets, as short conservative rectangles.
                for (const s of route.segments!) {
                    const a = s.start as PcbPoint,
                        c = s.end as PcbPoint,
                        n = Math.max(1, Math.ceil(Math.hypot(a.x - c.x, a.y - c.y) / 0.1));
                    for (let i = 0; i < n; i++) {
                        const p = {
                                x: a.x + ((c.x - a.x) * i) / n,
                                y: a.y + ((c.y - a.y) * i) / n,
                            },
                            q = {
                                x: a.x + ((c.x - a.x) * (i + 1)) / n,
                                y: a.y + ((c.y - a.y) * (i + 1)) / n,
                            };
                        obstacles.push({
                            center: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
                            width: Math.abs(q.x - p.x) + width,
                            height: Math.abs(q.y - p.y) + width,
                            layers: [s.layer],
                            net,
                        });
                    }
                }
                for (const v of route.vias!)
                    obstacles.push({
                        center: v.at as PcbPoint,
                        width: diameter,
                        height: diameter,
                        layers: ['F.Cu', 'B.Cu'],
                        net,
                    });
                out.completed.push({
                    net,
                    route,
                    reason: 'fine-grid A* routing with exact pad escapes',
                });
            } catch (e) {
                out.failed.push({ net, reason: String(e) });
            }
        }
        return out;
    }
}
