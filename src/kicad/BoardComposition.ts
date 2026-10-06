import { normalizeBoardNets } from './KicadNetFormat';
import path from 'node:path';
import { SExpressionParser as Parser, type SExpr } from './SExpressionParser';
import { transformPcbPoint } from '../synth/PcbPosition';
import type { BoardPlacement } from '../synth/BoardReference';
import { UuidManager } from './UuidManager';

export function boardRoot(content: string): SExpr[] {
    const root = Parser.parse(content)[0];
    if (!Array.isArray(root) || root[0] !== 'kicad_pcb') throw new Error('Invalid source board');
    normalizeBoardNets(root);
    return root;
}
export function child(node: SExpr[], key: string): SExpr[] | undefined {
    return node.find((item): item is SExpr[] => Array.isArray(item) && item[0] === key);
}
export const quote = (text: string): string => JSON.stringify(text);
export const value = (atom: SExpr): string => Parser.unquote(String(atom));

/** Copy generated board objects; footprint geometry remains local to its transformed anchor. */
export function appendBoard(
    parent: SExpr[],
    source: SExpr[],
    placement: BoardPlacement,
    uuids: UuidManager,
): void {
    const parentThickness = child(child(parent, 'general') ?? [], 'thickness')?.[1];
    const sourceThickness = child(child(source, 'general') ?? [], 'thickness')?.[1];
    if (parentThickness !== sourceThickness)
        throw new Error('Panel boards must have the same thickness');
    if (
        Parser.serialize(child(parent, 'layers') ?? []) !==
        Parser.serialize(child(source, 'layers') ?? [])
    )
        throw new Error('Panel boards must use the same copper layer stack');
    if (
        Parser.serialize(child(child(parent, 'setup') ?? [], 'stackup') ?? []) !==
        Parser.serialize(child(child(source, 'setup') ?? [], 'stackup') ?? [])
    )
        throw new Error('Panel boards must use the same physical stackup');
    const codes = new Map<string, { code: string; name: string }>();
    let next =
        Math.max(
            0,
            ...parent
                .filter((item): item is SExpr[] => Array.isArray(item) && item[0] === 'net')
                .map((item) => Number(item[1])),
        ) + 1;
    for (const net of source.filter(
        (item): item is SExpr[] => Array.isArray(item) && item[0] === 'net',
    )) {
        if (Number(net[1]) === 0) continue;
        const name = `${placement.id}/${value(net[2])}`;
        const code = String(next++);
        codes.set(String(net[1]), { code, name });
        parent.push(['net', code, quote(name)]);
    }
    const allowed = new Set([
        'footprint',
        'segment',
        'arc',
        'via',
        'zone',
        'gr_line',
        'gr_arc',
        'gr_circle',
        'gr_rect',
        'gr_poly',
        'gr_text',
        'dimension',
    ]);
    const headers = new Set([
        'version',
        'generator',
        'generator_version',
        'general',
        'paper',
        'title_block',
        'layers',
        'setup',
        'net',
        'embedded_fonts',
    ]);
    for (const entry of source.slice(1)) {
        if (!Array.isArray(entry)) continue;
        if (headers.has(String(entry[0]))) continue;
        if (!allowed.has(String(entry[0])))
            throw new Error(`Unsupported panel object '${entry[0]}'`);
        const node = structuredClone(entry);
        const footprint = node[0] === 'footprint';
        const walk = (item: SExpr[], local: boolean): void => {
            const key = String(item[0]);
            if (key === 'model' && placement.sourceDirectory) {
                const model = value(item[1]);
                const local = model.startsWith('${KIPRJMOD}/') ? model.slice(12) : model;
                if (!local.startsWith('$') && !path.isAbsolute(local)) {
                    item[1] = quote(path.resolve(placement.sourceDirectory, local));
                }
            }
            if (key === 'uuid')
                item[1] = quote(uuids.getOrGenerate(`panel:${placement.id}:${value(item[1])}`));
            if (key === 'net' && codes.has(String(item[1]))) {
                const net = codes.get(String(item[1]))!;
                item[1] = net.code;
                if (item.length > 2) item[2] = quote(net.name);
            }
            if (key === 'net_name') item[1] = quote(`${placement.id}/${value(item[1])}`);
            if (key === 'property' && item[1] === '"Reference"')
                item[2] = quote(`${placement.id}_${value(item[2])}`);
            if (key === 'property' && item[1] === '"TSPCB.ManagedId"')
                item[2] = quote(`panel:${placement.id}:${value(item[2])}`);
            if (key === 'path')
                item[1] = quote(
                    `/${uuids.getOrGenerate(`panel:${placement.id}:path:${value(item[1])}`)}`,
                );
            if (!local && ['at', 'start', 'end', 'mid', 'center', 'xy'].includes(key)) {
                const point = transformPcbPoint(
                    {
                        x: Number(item[1]) - (placement.origin?.x ?? 0),
                        y: Number(item[2]) - (placement.origin?.y ?? 0),
                    },
                    placement,
                );
                item[1] = String(point.x);
                item[2] = String(point.y);
                if (key === 'at' && node[0] !== 'via')
                    item[3] = String(Number(item[3] ?? 0) + (placement.rotation ?? 0));
            } else if (local && key === 'at') {
                // KiCad pad orientations are absolute, unlike their local positions.
                item[3] = String(Number(item[3] ?? 0) + (placement.rotation ?? 0));
            }
            for (const sub of item.slice(1)) if (Array.isArray(sub)) walk(sub, local);
        };
        if (footprint) {
            for (const sub of node.slice(1))
                if (Array.isArray(sub)) walk(sub, !['at', 'uuid', 'path'].includes(String(sub[0])));
        } else walk(node, false);
        parent.push(node);
    }
}

/** Remove only the specified straight outer perimeter; retain all internal cutouts. */
export function removeBoardOutline(source: SExpr[], points: { x: number; y: number }[]): void {
    if (points.length < 3) throw new Error('Panel source outline needs at least three points');
    const matches = new Set<SExpr[]>();
    const near = (a: SExpr[] | undefined, b: { x: number; y: number }) =>
        !!a && Math.abs(Number(a[1]) - b.x) < 0.00001 && Math.abs(Number(a[2]) - b.y) < 0.00001;
    points.forEach((start, index) => {
        const end = points[(index + 1) % points.length];
        const lines = source.filter(
            (item): item is SExpr[] =>
                Array.isArray(item) &&
                item[0] === 'gr_line' &&
                value(child(item, 'layer')?.[1] ?? '') === 'Edge.Cuts' &&
                ((near(child(item, 'start'), start) && near(child(item, 'end'), end)) ||
                    (near(child(item, 'start'), end) && near(child(item, 'end'), start))),
        );
        if (lines.length !== 1)
            throw new Error(
                'Saved PCB perimeter differs from panel source outline; resynthesize or update panel layout',
            );
        matches.add(lines[0]);
    });
    for (let i = source.length - 1; i > 0; i--) {
        if (matches.has(source[i] as SExpr[])) source.splice(i, 1);
    }
}
