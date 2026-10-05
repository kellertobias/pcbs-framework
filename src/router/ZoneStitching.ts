import { SExpr, SExpressionParser } from '../kicad/SExpressionParser';
import { captureRouting, RoutingFile } from '../kicad/RoutingFile';
import { PcbPoint } from '../synth/types';
import { inPolygon, segmentDistance } from './BoardRoutingGeometry';
/** Save physical stitching in persistent framework routing, using native KiCad
 * filled polygons as the clearance envelope. Refill and DRC after regeneration.
 * This deliberately refuses an unfilled board instead of guessing pour shapes. */
export function stitchFilledZones(
    source: string,
    boardName: string,
    net: string,
): { routing: RoutingFile; added: number } {
    const board = SExpressionParser.parse(source).find(
        (n) => Array.isArray(n) && n[0] === 'kicad_pcb',
    ) as SExpr[];
    const children = (n: SExpr[], k: string) =>
        n.filter((v) => Array.isArray(v) && v[0] === k) as SExpr[][];
    const child = (n: SExpr[], k: string) => children(n, k)[0];
    const atom = (n: SExpr[] | undefined, i: number) =>
        SExpressionParser.unquote(String(n?.[i] ?? ''));
    const point = (n: SExpr[]) => ({ x: Number(n[1]), y: Number(n[2]) });
    const zones = children(board, 'zone').filter(
        (z) => atom(child(z, 'net_name'), 1) === net || atom(child(z, 'net'), 1) === net,
    );
    const polygons = zones
        .flatMap((z) =>
            children(z, 'filled_polygon').map((p) => ({
                layer: atom(child(p, 'layer'), 1),
                points: children(child(p, 'pts') ?? [], 'xy').map(point),
            })),
        )
        .filter((p) => p.points.length > 2);
    if (!polygons.length) throw Error(`No filled polygons for ${net}; refill with KiCad first.`);
    const routing = captureRouting(source, boardName);
    let ground = routing.routes.find((r) => r.net === net);
    if (!ground) {
        ground = { id: `captured/${net}`, net };
        routing.routes.push(ground);
    }
    ground.vias ??= [];
    const holes: Array<{ at: PcbPoint; r: number }> = children(board, 'via').map((v) => ({
        at: point(child(v, 'at')),
        r: Number(atom(child(v, 'drill'), 1)) / 2,
    }));
    for (const fp of children(board, 'footprint')) {
        const origin = point(child(fp, 'at')),
            angle = (-Number(atom(child(fp, 'at'), 3) || 0) * Math.PI) / 180;
        for (const p of children(fp, 'pad')) {
            const d = child(p, 'drill');
            if (!d) continue;
            const at = point(child(p, 'at'));
            holes.push({
                at: {
                    x: origin.x + at.x * Math.cos(angle) - at.y * Math.sin(angle),
                    y: origin.y + at.x * Math.sin(angle) + at.y * Math.cos(angle),
                },
                r: Math.max(...d.slice(1).map(Number).filter(Number.isFinite)) / 2,
            });
        }
    }
    const envelope = (p: (typeof polygons)[number]) => ({
        minX: Math.min(...p.points.map((q) => q.x)),
        maxX: Math.max(...p.points.map((q) => q.x)),
        minY: Math.min(...p.points.map((q) => q.y)),
        maxY: Math.max(...p.points.map((q) => q.y)),
    });
    const inside = (q: PcbPoint, p: (typeof polygons)[number]) =>
        inPolygon(q, p.points) &&
        p.points.every(
            (a, i) => segmentDistance(q, q, a, p.points[(i + 1) % p.points.length]) >= 0.22,
        );
    let added = 0;
    for (const front of polygons.filter((p) => p.layer === 'F.Cu'))
        for (const back of polygons.filter((p) => p.layer === 'B.Cu')) {
            if (
                ground.vias.some(
                    (v) =>
                        'x' in v.at &&
                        inPolygon(v.at, front.points) &&
                        inPolygon(v.at, back.points),
                )
            )
                continue;
            const a = envelope(front),
                b = envelope(back);
            let at: PcbPoint | undefined;
            for (
                let y = Math.ceil(Math.max(a.minY, b.minY) * 20) / 20;
                y <= Math.min(a.maxY, b.maxY) && !at;
                y += 0.05
            )
                for (
                    let x = Math.ceil(Math.max(a.minX, b.minX) * 20) / 20;
                    x <= Math.min(a.maxX, b.maxX);
                    x += 0.05
                ) {
                    const q = { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) };
                    if (
                        inside(q, front) &&
                        inside(q, back) &&
                        holes.every((h) => Math.hypot(x - h.at.x, y - h.at.y) >= h.r + 0.1 + 0.25)
                    ) {
                        at = q;
                        break;
                    }
                }
            if (at) {
                ground.vias.push({
                    at,
                    diameter: 0.4,
                    drill: 0.2,
                    fromLayer: 'F.Cu',
                    toLayer: 'B.Cu',
                });
                holes.push({ at, r: 0.1 });
                added++;
            }
        }
    return { routing, added };
}
