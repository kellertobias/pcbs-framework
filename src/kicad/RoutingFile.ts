import { backupGeneratedFile } from '../project/OutputPaths';
import { normalizeBoardNets } from './KicadNetFormat';
import * as fs from 'fs';
import * as path from 'path';
import { CircuitSnapshot, PcbExactRoute, PcbRoutePoint, PcbHandoff } from '../synth/types';
import { SExpr, SExpressionParser } from './SExpressionParser';
import { transformPcbPoint } from '../synth/PcbPosition';

export interface RoutingFile {
    version: 1;
    board: string;
    routes: PcbExactRoute[];
}

/** Read persistent copper without modifying either the snapshot or its source file. */
export function loadRoutingFile(snapshot: CircuitSnapshot, outputDir: string): CircuitSnapshot {
    if (!snapshot.pcb) return snapshot;
    const file = path.resolve(outputDir, snapshot.pcb.routingFile ?? 'routing.json');
    if (!fs.existsSync(file)) {
        if (snapshot.pcb.routingFile) throw new Error(`Routing file does not exist: ${file}`);
        return snapshot;
    }
    const saved = JSON.parse(fs.readFileSync(file, 'utf-8')) as RoutingFile;
    if (
        !saved ||
        saved.version !== 1 ||
        saved.board !== snapshot.name ||
        !Array.isArray(saved.routes)
    ) {
        throw new Error(
            `Invalid routing file '${file}': expected version 1, board '${snapshot.name}', and routes array.`,
        );
    }
    const routes = [...(snapshot.pcb.exactRoutes ?? [])];
    const ids = new Set(routes.map((route) => route.id));
    for (const route of saved.routes) {
        if (!route || typeof route.id !== 'string' || !route.id || typeof route.net !== 'string')
            throw new Error(`Invalid route in '${file}'.`);
        if (ids.has(route.id))
            throw new Error(`Duplicate route '${route.id}' in '${file}' and source declarations.`);
        ids.add(route.id);
        routes.push(route);
    }
    return { ...snapshot, pcb: { ...snapshot.pcb, exactRoutes: routes } };
}

type Node = SExpr[];
const nodes = (node: Node, key: string): Node[] =>
    node.filter((item): item is Node => Array.isArray(item) && item[0] === key);
const child = (node: Node, key: string): Node | undefined => nodes(node, key)[0];
const atom = (node: Node | undefined, index: number): string =>
    typeof node?.[index] === 'string' ? SExpressionParser.unquote(node[index] as string) : '';
const coordinate = (node: Node | undefined) => {
    const point = { x: Number(atom(node, 1)), y: Number(atom(node, 2)) };
    if (
        !node ||
        !atom(node, 1) ||
        !atom(node, 2) ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y)
    )
        throw new Error('Invalid copper/pad coordinates in KiCad board.');
    return point;
};

/** Capture all board tracks, arcs, and vias. Pad-coincident endpoints retain logical anchors. */
export function captureRouting(
    source: string,
    boardName: string,
    options: {
        excludeUuids?: Iterable<string>;
        handoffs?: PcbHandoff[];
        coordinateOnly?: boolean;
    } = {},
): RoutingFile {
    const board = SExpressionParser.parse(source).find(
        (item): item is Node => Array.isArray(item) && item[0] === 'kicad_pcb',
    );
    if (!board) throw new Error('Cannot capture routing from an invalid KiCad board.');
    normalizeBoardNets(board);
    const nets = new Map(nodes(board, 'net').map((net) => [atom(net, 1), atom(net, 2)]));
    const pads: Array<{ net: string; point: { x: number; y: number }; ref: string; pad: string }> =
        [];
    for (const footprint of nodes(board, 'footprint')) {
        const ref = nodes(footprint, 'property').find(
            (property) => atom(property, 1) === 'Reference',
        );
        if (!ref) continue;
        const at = child(footprint, 'at');
        // KiCad board files already store mirrored local geometry for back footprints.
        const origin = {
            ...coordinate(at),
            rotation: Number(atom(at, 3) || 0),
            side: 'front' as const,
        };
        for (const pad of nodes(footprint, 'pad')) {
            if (!atom(pad, 1)) continue;
            pads.push({
                net: atom(child(pad, 'net'), 1),
                point: transformPcbPoint(coordinate(child(pad, 'at')), origin),
                ref: atom(ref, 2),
                pad: atom(pad, 1),
            });
        }
    }
    const excluded = new Set(options.excludeUuids);
    const routes = new Map<string, PcbExactRoute>();
    for (const kind of ['segment', 'arc', 'via'] as const) {
        for (const item of nodes(board, kind)) {
            const uuid = atom(child(item, 'uuid'), 1);
            if (excluded.has(uuid)) continue;
            const code = atom(child(item, 'net'), 1);
            const net = nets.get(code);
            if (!net)
                throw new Error(`Cannot capture ${kind} on unnamed or unknown net '${code}'.`);
            let route = routes.get(net);
            if (!route) {
                route = { id: `captured/${net}`, net };
                routes.set(net, route);
            }
            if (!uuid) throw new Error(`Cannot capture ${kind} without a stable UUID.`);
            const anchored = (key: string): PcbRoutePoint => {
                const point = coordinate(child(item, key));
                if (options.coordinateOnly) return point;
                const handoffs = (options.handoffs ?? []).filter(
                    (handoff) =>
                        handoff.net === net &&
                        Math.hypot(handoff.at.x - point.x, handoff.at.y - point.y) < 1e-6,
                );
                if (handoffs.length === 1)
                    return { module: handoffs[0].module, port: handoffs[0].port };
                const matches = pads.filter(
                    (pad) =>
                        pad.net === code &&
                        Math.hypot(pad.point.x - point.x, pad.point.y - point.y) < 1e-6,
                );
                const unique = new Map(matches.map((pad) => [`${pad.ref}:${pad.pad}`, pad]));
                if (unique.size === 1) {
                    const pad = [...unique.values()][0];
                    return { ref: pad.ref, pad: pad.pad };
                }
                return point;
            };
            if (kind === 'via') {
                const layers = child(item, 'layers');
                const fromLayer = atom(layers, 1),
                    toLayer = atom(layers, 2);
                if (
                    !(
                        (fromLayer === 'F.Cu' && toLayer === 'B.Cu') ||
                        (fromLayer === 'B.Cu' && toLayer === 'F.Cu')
                    )
                )
                    throw new Error('Only two-layer through vias can be captured.');
                (route.vias ??= []).push({
                    id: uuid,
                    uuid,
                    at: anchored('at'),
                    fromLayer,
                    toLayer,
                    diameter: Number(atom(child(item, 'size'), 1)),
                    drill: Number(atom(child(item, 'drill'), 1)),
                });
            } else {
                const layer = atom(child(item, 'layer'), 1);
                if (layer !== 'F.Cu' && layer !== 'B.Cu')
                    throw new Error(`Unsupported captured copper layer '${layer}'.`);
                const base = {
                    id: uuid,
                    uuid,
                    start: anchored('start'),
                    end: anchored('end'),
                    layer,
                    width: Number(atom(child(item, 'width'), 1)),
                };
                if (kind === 'arc')
                    (route.arcs ??= []).push({
                        ...base,
                        layer,
                        mid: coordinate(child(item, 'mid')),
                    });
                else (route.segments ??= []).push({ ...base, layer });
            }
        }
    }
    return { version: 1, board: boardName, routes: [...routes.values()] };
}

/** Save explicitly; never overwrite saved routing silently during synthesis. */
export function saveRoutingFile(file: string, routing: RoutingFile): void {
    if (fs.existsSync(file)) {
        backupGeneratedFile(file);
    }
    const temporary = `${file}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporary, `${JSON.stringify(routing, null, 2)}\n`, { flag: 'wx' });
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

/** Stable identities of top-level copper only (not footprint drawings). */
export function copperUuids(source: string): string[] {
    const board = SExpressionParser.parse(source).find(
        (item): item is Node => Array.isArray(item) && item[0] === 'kicad_pcb',
    );
    if (!board) throw new Error('Invalid KiCad PCB document.');
    return ['segment', 'arc', 'via']
        .flatMap((kind) => nodes(board, kind).map((item) => atom(child(item, 'uuid'), 1)))
        .filter(Boolean);
}
