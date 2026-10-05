import { Resvg } from '@resvg/resvg-js';
import { SExpr, SExpressionParser } from '../kicad/SExpressionParser';
import type { KicadFootprint } from '../synth/KicadFootprint';
export type Bounds2D = { minX: number; minY: number; maxX: number; maxY: number };
export interface FootprintRenderOptions {
    side?: 'top' | 'bottom';
    layers?: string[];
    width?: number;
    padding?: number;
    bounds?: Bounds2D;
    transparent?: boolean;
    labels?: boolean;
    overlay?: boolean;
    labelPosition?: 'above' | 'right';
}
type Node = SExpr[];
const child = (n: Node, key: string) => n.find((v): v is Node => Array.isArray(v) && v[0] === key);
const value = (n: Node | undefined, i: number) =>
    typeof n?.[i] === 'string' ? SExpressionParser.unquote(n[i] as string) : '';
const number = (n: Node | undefined, i: number, fallback = 0) =>
    n?.[i] === undefined ? fallback : Number(value(n, i));
export const xml = (s: string) =>
    s.replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
    );
export function renderFootprint(
    input: string | KicadFootprint,
    options: FootprintRenderOptions = {},
) {
    const source = typeof input === 'string' ? input : input.serialize();
    const root = SExpressionParser.parse(source).find(
        (n): n is Node => Array.isArray(n) && ['footprint', 'module'].includes(String(n[0])),
    );
    if (!root) throw new Error('Expected a KiCad footprint');
    const sign = options.side === 'bottom' ? -1 : 1,
        elements: string[] = [],
        labels: string[] = [],
        points: number[][] = [];
    const layers = options.layers ?? [
        'F.Cu',
        'B.Cu',
        '*.Cu',
        'F.Fab',
        'B.Fab',
        'F.SilkS',
        'B.SilkS',
        'Edge.Cuts',
        'Dwgs.User',
        'Cmts.User',
        'User.Drawings',
    ];
    const keep = (n: Node) => layers.includes(value(child(n, 'layer'), 1));
    const addPoint = (x: number, y: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y))
            throw new Error('Invalid footprint coordinate');
        points.push([x, sign * y]);
    };
    const color = '#d54872',
        stroke = '#216fa0';
    const labelPads: Array<{ id: string; x: number; y: number; hw: number; hh: number }> = [];
    const pads: Array<{
        number: string;
        x: number;
        y: number;
        drill?: number | { x: number; y: number };
    }> = [];
    for (const n of root.filter((v): v is Node => Array.isArray(v))) {
        const tag = value(n, 0),
            at = child(n, 'at');
        if (tag === 'pad') {
            const padLayers =
                child(n, 'layers')
                    ?.slice(1)
                    .map((v) => SExpressionParser.unquote(String(v))) ?? [];
            if (!padLayers.some((l) => layers.includes(l))) continue;
            const x = number(at, 1),
                y = number(at, 2),
                angle = number(at, 3),
                size = child(n, 'size'),
                w = number(size, 1),
                h = number(size, 2);
            if (!(w > 0 && h > 0)) throw new Error('Pad requires positive size');
            const radius = Math.hypot(w, h) / 2;
            addPoint(x - radius, y - radius);
            addPoint(x + radius, y + radius);
            const shape = value(n, 3);
            if (!['circle', 'rect', 'oval', 'roundrect'].includes(shape))
                throw new Error(`Unsupported pad shape: ${shape}`);
            const drill = child(n, 'drill'),
                oval = value(drill, 1) === 'oval';
            const d = number(drill, oval ? 2 : 1),
                dh = oval ? number(drill, 3) : d,
                offset = child(drill ?? [], 'offset');
            pads.push({
                number: value(n, 1),
                x,
                y,
                drill: d ? (oval ? { x: d, y: dh } : d) : undefined,
            });
            const opacity = options.overlay ? '.35' : '1';
            elements.push(`<g transform="translate(${x} ${sign * y}) rotate(${-sign * angle})">`);
            if (shape === 'circle')
                elements.push(
                    `<ellipse rx="${w / 2}" ry="${h / 2}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width=".12"/>`,
                );
            else {
                const r =
                    shape === 'oval'
                        ? Math.min(w, h) / 2
                        : shape === 'roundrect'
                          ? Math.min(w, h) * number(child(n, 'roundrect_rratio'), 1, 0.25)
                          : 0;
                elements.push(
                    `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${r}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width=".12"/>`,
                );
            }
            if (d > 0)
                elements.push(
                    `<ellipse cx="${number(offset, 1)}" cy="${sign * number(offset, 2)}" rx="${d / 2}" ry="${dh / 2}" fill="white" fill-opacity="${options.overlay ? '.3' : '1'}" stroke="#218762" stroke-width=".1"/>`,
                );
            elements.push('</g>');
            const theta = (angle * Math.PI) / 180;
            labelPads.push({
                id: value(n, 1),
                x,
                y: sign * y,
                hw: (Math.abs(w * Math.cos(theta)) + Math.abs(h * Math.sin(theta))) / 2,
                hh: (Math.abs(w * Math.sin(theta)) + Math.abs(h * Math.cos(theta))) / 2,
            });
        } else if (tag === 'fp_text' && value(n, 1) === 'user' && keep(n) && !n.includes('hide')) {
            const effects = child(n, 'effects'),
                font = child(effects ?? [], 'font'),
                size = number(child(font ?? [], 'size'), 1, 1),
                text = value(n, 2);
            const x = number(at, 1),
                y = number(at, 2),
                angle = number(at, 3);
            const justify = value(child(effects ?? [], 'justify'), 1),
                anchor = justify === 'left' ? 'start' : justify === 'right' ? 'end' : 'middle';
            addPoint(x - text.length * size * 0.35, y - size);
            addPoint(x + text.length * size * 0.35, y + size);
            labels.push(
                `<text x="${x}" y="${sign * y}" transform="rotate(${-sign * angle} ${x} ${sign * y})" text-anchor="${anchor}" font-family="sans-serif" font-size="${size}" fill="${stroke}">${xml(text)}</text>`,
            );
        } else if (
            ['fp_line', 'fp_rect', 'fp_arc', 'fp_circle', 'fp_poly'].includes(tag) &&
            keep(n)
        ) {
            const width = number(
                child(child(n, 'stroke') ?? [], 'width'),
                1,
                number(child(n, 'width'), 1, 0.12),
            );
            let pts: number[][] = [];
            if (tag === 'fp_poly')
                pts = (child(n, 'pts') ?? [])
                    .filter((v): v is Node => Array.isArray(v) && v[0] === 'xy')
                    .map((v) => [number(v, 1), number(v, 2)]);
            else {
                for (const key of ['start', 'mid', 'end', 'center']) {
                    const p = child(n, key);
                    if (p) pts.push([number(p, 1), number(p, 2)]);
                }
            }
            pts.forEach(([x, y]) => addPoint(x, y));
            if (tag === 'fp_rect') {
                const [a, b] = pts;
                elements.push(
                    `<rect x="${Math.min(a[0], b[0])}" y="${Math.min(sign * a[1], sign * b[1])}" width="${Math.abs(a[0] - b[0])}" height="${Math.abs(a[1] - b[1])}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`,
                );
            } else if (tag === 'fp_circle') {
                const e = child(n, 'end')!,
                    c = child(n, 'center')!,
                    x = number(c, 1),
                    y = number(c, 2),
                    r = Math.hypot(number(e, 1) - x, number(e, 2) - y);
                addPoint(x - r, y - r);
                addPoint(x + r, y + r);
                elements.push(
                    `<circle cx="${x}" cy="${sign * y}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`,
                );
            } else {
                if (tag === 'fp_arc' && pts.length !== 3)
                    throw new Error('Legacy two-point footprint arcs are unsupported');
                if (tag === 'fp_arc' && pts.length === 3) {
                    const [a, b, c] = pts;
                    const det =
                        2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
                    if (Math.abs(det) < 1e-10) throw new Error('Degenerate footprint arc');
                    const q = pts.map((p) => p[0] ** 2 + p[1] ** 2),
                        cx =
                            (q[0] * (b[1] - c[1]) + q[1] * (c[1] - a[1]) + q[2] * (a[1] - b[1])) /
                            det,
                        cy =
                            (q[0] * (c[0] - b[0]) + q[1] * (a[0] - c[0]) + q[2] * (b[0] - a[0])) /
                            det,
                        r = Math.hypot(a[0] - cx, a[1] - cy);
                    const angles = pts.map((p) => Math.atan2(p[1] - cy, p[0] - cx)),
                        norm = (t: number) => (t + 2 * Math.PI) % (2 * Math.PI);
                    let sweep = norm(angles[2] - angles[0]);
                    if (norm(angles[1] - angles[0]) > sweep) sweep -= 2 * Math.PI;
                    pts = Array.from({ length: 65 }, (_, i) => {
                        const t = angles[0] + (sweep * i) / 64;
                        return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
                    });
                    pts.forEach(([x, y]) => addPoint(x, y));
                }
                elements.push(
                    `<${tag === 'fp_poly' ? 'polygon' : 'polyline'} points="${pts.map((p) => `${p[0]},${sign * p[1]}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`,
                );
            }
        }
    }
    // Keep numbers legible on dense rows: prefer the requested side, then try
    // other sides and increasing separation, avoiding every pad and prior label.
    if (options.labels !== false) {
        type Box = { x: number; y: number; w: number; h: number };
        const occupied: Box[] = labelPads.map((p) => ({
            x: p.x - p.hw,
            y: p.y - p.hh,
            w: p.hw * 2,
            h: p.hh * 2,
        }));
        const intersects = (a: Box, b: Box) =>
            a.x < b.x + b.w + 0.2 &&
            a.x + a.w + 0.2 > b.x &&
            a.y < b.y + b.h + 0.2 &&
            a.y + a.h + 0.2 > b.y;
        for (const p of labelPads.filter((p) => p.id)) {
            const w = Math.max(0.95, p.id.length * 0.95),
                h = 1.7;
            let box: Box | undefined;
            const order =
                options.labelPosition === 'right'
                    ? ['right', 'left', 'above', 'below']
                    : ['above', 'below', 'right', 'left'];
            for (let ring = 0; ring < 25 && !box; ring++)
                for (const side of order) {
                    const gap = 0.55 + ring * 1.5;
                    const candidate: Box =
                        side === 'right'
                            ? { x: p.x + p.hw + gap, y: p.y - h / 2, w, h }
                            : side === 'left'
                              ? { x: p.x - p.hw - gap - w, y: p.y - h / 2, w, h }
                              : side === 'above'
                                ? { x: p.x - w / 2, y: p.y - p.hh - gap - h, w, h }
                                : { x: p.x - w / 2, y: p.y + p.hh + gap, w, h };
                    if (!occupied.some((b) => intersects(candidate, b))) {
                        box = candidate;
                        break;
                    }
                }
            if (!box) throw new Error(`Unable to place pad label: ${p.id}`);
            occupied.push(box);
            addPoint(box.x, sign * box.y);
            addPoint(box.x + box.w, sign * (box.y + box.h));
            const endX = Math.max(box.x, Math.min(p.x, box.x + box.w)),
                endY = Math.max(box.y, Math.min(p.y, box.y + box.h));
            labels.push(
                `<line x1="${p.x}" y1="${p.y}" x2="${endX}" y2="${endY}" stroke="#96274e" stroke-width=".06"/>`,
            );
            labels.push(
                `<text x="${box.x}" y="${box.y + 1.35}" font-family="sans-serif" font-size="1.5" fill="#96274e" stroke="white" stroke-width=".12" paint-order="stroke fill">${xml(p.id)}</text>`,
            );
        }
    }
    if (!points.length) throw new Error('No supported footprint geometry on selected layers');
    const margin = options.padding ?? 3,
        b = options.bounds ?? {
            minX: Math.min(...points.map((p) => p[0])) - margin,
            maxX: Math.max(...points.map((p) => p[0])) + margin,
            minY: Math.min(...points.map((p) => p[1])) - margin,
            maxY: Math.max(...points.map((p) => p[1])) + margin,
        };
    const w = b.maxX - b.minX,
        h = b.maxY - b.minY;
    if (!(w > 0 && h > 0)) throw new Error('Invalid render bounds');
    const width = options.width ?? 1600,
        height = Math.ceil((width * h) / w);
    const body = elements.join('') + labels.join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${b.minX} ${b.minY} ${w} ${h}">${options.transparent ? '' : `<rect x="${b.minX}" y="${b.minY}" width="${w}" height="${h}" fill="white"/>`}${body}</svg>`;
    const png = Buffer.from(new Resvg(svg).render().asPng());
    return { svg, png, bounds: b, pads, body, width, height, side: options.side ?? 'top' };
}

/** Crop a PNG illustration without an external image tool. */
export function cropPng(
    source: Buffer,
    crop: { x: number; y: number; width: number; height: number },
): Buffer {
    if (!source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new Error('Expected PNG image');
    const width = source.readUInt32BE(16),
        height = source.readUInt32BE(20);
    if (
        !Object.values(crop).every(Number.isInteger) ||
        crop.x < 0 ||
        crop.y < 0 ||
        crop.width <= 0 ||
        crop.height <= 0 ||
        crop.x + crop.width > width ||
        crop.y + crop.height > height
    )
        throw new Error('Crop outside image');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${crop.width}" height="${crop.height}" viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}"><image width="${width}" height="${height}" href="data:image/png;base64,${source.toString('base64')}"/></svg>`;
    return Buffer.from(new Resvg(svg).render().asPng());
}
