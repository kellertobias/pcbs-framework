import fs from 'node:fs';
import path from 'node:path';
export type Expr = (string | Expr)[];
export function parseSexpr(text: string): Expr {
    const tokens = text.match(/"(?:\\.|[^"\\])*"|[()]|[^\s()]+/g) || [];
    let i = 0;
    function read(): string | Expr {
        const token = tokens[i++];
        if (token !== '(') return token?.startsWith('"') ? JSON.parse(token) : token;
        const node: Expr = [];
        while (tokens[i] !== ')') {
            if (i >= tokens.length) throw new Error('Unclosed KiCad expression');
            node.push(read());
        }
        i++;
        return node;
    }
    return read() as Expr;
}
export function children(e: Expr, name: string) {
    return e.filter((v): v is Expr => Array.isArray(v) && v[0] === name);
}
export function child(e: Expr, name: string): Expr | undefined {
    return children(e, name)[0];
}
export interface Rect {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}
export function bounds(points: { x: number; y: number }[]): Rect {
    return {
        x1: Math.min(...points.map((p) => p.x)),
        y1: Math.min(...points.map((p) => p.y)),
        x2: Math.max(...points.map((p) => p.x)),
        y2: Math.max(...points.map((p) => p.y)),
    };
}
export function transformRect(
    r: Rect,
    p: { x: number; y: number; rotation?: number; side?: string },
): Rect {
    const a = (-(p.rotation ?? 0) * Math.PI) / 180,
        c = Math.cos(a),
        s = Math.sin(a);
    return bounds(
        [
            [r.x1, r.y1],
            [r.x2, r.y1],
            [r.x2, r.y2],
            [r.x1, r.y2],
        ].map(([x, y]) => {
            if (p.side === 'back') x = -x;
            return { x: p.x + x * c - y * s, y: p.y + x * s + y * c };
        }),
    );
}
const cache = new Map<string, { modified: number; size: number; expression: Expr }>();
/** Resolve project libraries first, then shared workspace and installed KiCad libraries. */
export function footprint(name: string, libraryDirectories: readonly string[] = []): Expr {
    const [lib, part] = name.split(':');
    if (!lib || !part) throw new Error(`Invalid footprint name ${name}`);
    const candidates = [
        ...libraryDirectories.map((directory) =>
            path.resolve(directory, `${lib}.pretty`, `${part}.kicad_mod`),
        ),
        path.resolve('.kicad', `${lib}.pretty`, `${part}.kicad_mod`),
        ...(process.env.KICAD_FOOTPRINT_DIR?.split(path.delimiter) ?? []).map((directory) =>
            path.join(directory, `${lib}.pretty`, `${part}.kicad_mod`),
        ),
        path.join('/usr/share/kicad/footprints', `${lib}.pretty`, `${part}.kicad_mod`),
        path.join(
            '/Applications/KiCad/KiCad.app/Contents/SharedSupport/footprints',
            `${lib}.pretty`,
            `${part}.kicad_mod`,
        ),
    ];
    const file = candidates.find((candidate) => fs.existsSync(candidate));
    if (!file) throw new Error(`Cannot place unresolved footprint ${name}`);
    const stat = fs.statSync(file);
    const saved = cache.get(file);
    if (saved && saved.modified === stat.mtimeMs && saved.size === stat.size)
        return saved.expression;
    const expression = parseSexpr(fs.readFileSync(file, 'utf8'));
    cache.set(file, { modified: stat.mtimeMs, size: stat.size, expression });
    return expression;
}
export function padRects(fp: Expr, backOnly = false): Rect[] {
    return children(fp, 'pad')
        .filter(
            (p) =>
                !backOnly || (child(p, 'layers') || []).some((v) => v === '*.Cu' || v === 'B.Cu'),
        )
        .map((p) => {
            const at = child(p, 'at')!,
                size = child(p, 'size')!;
            const x = Number(at[1]),
                y = Number(at[2]);
            return {
                x1: x - Number(size[1]) / 2,
                y1: y - Number(size[2]) / 2,
                x2: x + Number(size[1]) / 2,
                y2: y + Number(size[2]) / 2,
            };
        });
}
export function contourRects(fp: Expr, layer: string): Rect[] {
    const points: { x: number; y: number }[] = [];
    for (const e of fp)
        if (Array.isArray(e) && String(child(e, 'layer')?.[1]) === layer) {
            if (e[0] === 'fp_circle') {
                const c = child(e, 'center')!,
                    end = child(e, 'end')!;
                const r = Math.hypot(Number(end[1]) - Number(c[1]), Number(end[2]) - Number(c[2]));
                points.push(
                    { x: Number(c[1]) - r, y: Number(c[2]) - r },
                    { x: Number(c[1]) + r, y: Number(c[2]) + r },
                );
            } else
                for (const name of ['start', 'mid', 'end']) {
                    const v = child(e, name);
                    if (v) points.push({ x: Number(v[1]), y: Number(v[2]) });
                }
        }
    return points.length ? [bounds(points)] : [];
}
export function footprintBounds(fp: Expr): Rect {
    const courtyard = [...contourRects(fp, 'F.CrtYd'), ...contourRects(fp, 'B.CrtYd')];
    const all = courtyard.length
        ? courtyard
        : [...padRects(fp), ...contourRects(fp, 'F.Fab'), ...contourRects(fp, 'F.SilkS')];
    if (!all.length) throw new Error('Footprint has no physical geometry');
    return bounds(
        all.flatMap((r) => [
            { x: r.x1, y: r.y1 },
            { x: r.x2, y: r.y2 },
        ]),
    );
}
