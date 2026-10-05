import fs from 'node:fs';
import path from 'node:path';
import { SExpressionParser, SExpr } from '../../kicad/SExpressionParser';
import { captureRouting, saveRoutingFile } from '../../kicad/RoutingFile';
import { normalizeBoardNets } from '../../kicad/KicadNetFormat';
import { GridRoutingBackend } from '../../router/GridRoutingBackend';
/** Explicit local repair between two real pad anchors. Other pads remain copper
 * obstacles; only the routing request's terminal selection is narrowed. */
export async function cmdRouteJoin(args: string[]): Promise<void> {
    const opt = (key: string) => {
        const i = args.indexOf(key);
        return i < 0 ? undefined : args[i + 1];
    };
    if (!args[0]) throw Error('Missing board path.');
    const file = path.resolve(args[0]),
        net = opt('--net'),
        from = opt('--from'),
        to = opt('--to');
    if (!net || !from || !to) throw Error('route-join board --net NET --from Ref.pad --to Ref.pad');
    const source = fs.readFileSync(file, 'utf8'),
        board = SExpressionParser.parse(source)[0] as SExpr[];
    normalizeBoardNets(board);
    const nodes = (n: SExpr[], k: string) =>
        n.filter((v) => Array.isArray(v) && v[0] === k) as SExpr[][];
    const atom = (n: SExpr[] | undefined, i: number) =>
        SExpressionParser.unquote(String(n?.[i] ?? ''));
    let count = 0;
    for (const fp of nodes(board, 'footprint')) {
        const ref = atom(
            nodes(fp, 'property').find((p) => atom(p, 1) === 'Reference'),
            2,
        );
        for (const p of nodes(fp, 'pad')) {
            const anchor = ref + '.' + atom(p, 1);
            if (anchor === from || anchor === to) {
                const code = atom(nodes(p, 'net')[0], 1);
                const name = atom(
                    nodes(board, 'net').find((n) => atom(n, 1) === code),
                    2,
                );
                if (name !== net) throw Error(`${anchor} is not on ${net}.`);
                count++;
            } else p[1] = '""';
        }
    }
    if (count !== 2) throw Error('Expected exactly two real pad anchors.');
    const backend = new GridRoutingBackend();
    const result = backend.route({
        snapshot: { name: path.basename(file, '.kicad_pcb'), components: [], nets: [] },
        boardSource: SExpressionParser.serialize(board),
        padsByNet: new Map(),
        eligibleNets: [net],
        existingCopperNets: new Set(),
        lockedNets: new Set(),
        rerouteNets: new Set(),
        routeHints: [],
        netClasses: [
            {
                name: 'Signal',
                nets: [net],
                width: 0.15,
                clearance: 0.15,
                viaDiameter: 0.4,
                viaDrill: 0.2,
            },
        ],
    });
    if (result.failed.length || !result.completed.length)
        throw Error(JSON.stringify(result.failed));
    const saved = captureRouting(source, path.basename(file, '.kicad_pcb'));
    let route = saved.routes.find((r) => r.net === net);
    if (!route) {
        route = { id: `captured/${net}`, net };
        saved.routes.push(route);
    }
    for (const r of result.completed) {
        route.segments = [...(route.segments ?? []), ...(r.route?.segments ?? [])];
        route.vias = [...(route.vias ?? []), ...(r.route?.vias ?? [])];
    }
    route.vias = (route.vias ?? []).filter(
        (v, i, all) =>
            all.findIndex(
                (q) =>
                    ('x' in v.at && 'x' in q.at
                        ? Math.hypot(v.at.x - q.at.x, v.at.y - q.at.y) < 1e-6
                        : JSON.stringify(v.at) === JSON.stringify(q.at)) &&
                    v.diameter === q.diameter &&
                    v.drill === q.drill,
            ) === i,
    );
    saveRoutingFile(
        path.resolve(opt('--output') || path.join(path.dirname(file), 'routing.json')),
        saved,
    );
    console.log(`Saved routed join ${from} -> ${to}; regenerate and DRC.`);
}
