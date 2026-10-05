import { deflateSync } from 'zlib';
import { Resvg } from '@resvg/resvg-js';
import { renderFootprint, xml } from './FootprintRenderer';
import type { KicadFootprint } from '../synth/KicadFootprint';
type Vec = [number, number, number];
export type ModelView = 'isometric' | 'top' | 'bottom' | 'side' | 'end';
export interface ModelRenderOptions {
    view?: ModelView;
    width?: number;
    height?: number;
    footprint?: string | KicadFootprint;
    measurements?: boolean;
    title?: string;
}
const dot = (a: Vec, b: Vec) => a.reduce((n, v, i) => n + v * b[i], 0);
const normalise = (a: Vec): Vec => a.map((v) => v / Math.hypot(...a)) as Vec;
const axes: Record<ModelView, [Vec, Vec, Vec]> = {
    isometric: [
        [0.94, -0.34, 0],
        [0.12, 0.33, 0.94],
        [-0.32, -0.88, 0.35],
    ],
    top: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
    ],
    bottom: [
        [1, 0, 0],
        [0, -1, 0],
        [0, 0, -1],
    ],
    side: [
        [1, 0, 0],
        [0, 0, 1],
        [0, -1, 0],
    ],
    end: [
        [0, 1, 0],
        [0, 0, 1],
        [1, 0, 0],
    ],
};
function crc(data: Buffer) {
    let c = 0xffffffff;
    for (const byte of data) {
        c ^= byte;
        for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
    const t = Buffer.from(type),
        n = Buffer.alloc(4),
        c = Buffer.alloc(4);
    n.writeUInt32BE(data.length);
    c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([n, t, data, c]);
}
function rgbPng(width: number, height: number, rgb: Buffer) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2;
    const rows = Buffer.alloc(height * (width * 3 + 1));
    for (let y = 0; y < height; y++)
        rgb.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(rows)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}
/** Render the coloured IndexedFaceSet WRL written by Kicad3DModel, in mm.
 * A depth buffer hides rear faces; this is not a general VRML scene interpreter.
 */
export function renderModel(wrl: string, options: ModelRenderOptions = {}) {
    if (/\bTransform\s*\{/.test(wrl))
        throw new Error('Transformed VRML scenes are unsupported; use Kicad3DModel WRL');
    const triangles: Array<{ p: Vec[]; color: Vec }> = [],
        vertices: Vec[] = [];
    for (const block of wrl.match(/Shape\s*\{[\s\S]*?(?=Shape\s*\{|$)/g) ?? []) {
        const points = /point\s*\[([\s\S]*?)\]/.exec(block),
            indices = /coordIndex\s*\[([\s\S]*?)\]/.exec(block),
            colour = /diffuseColor\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/.exec(block);
        if (!points || !indices) continue;
        const values = points[1]
                .trim()
                .split(/[\s,]+/)
                .map(Number),
            ps: Vec[] = [];
        for (let i = 0; i < values.length; i += 3)
            ps.push(values.slice(i, i + 3).map((n) => n * 2.54) as Vec);
        if (ps.some((p) => p.length !== 3 || p.some((n) => !Number.isFinite(n))))
            throw new Error('Invalid WRL vertices');
        vertices.push(...ps);
        const color = (colour ? colour.slice(1).map(Number) : [0.6, 0.6, 0.6]) as Vec;
        for (const face of indices[1].split(/-1\s*,?/)) {
            const ids = face
                .trim()
                .split(/[\s,]+/)
                .filter(Boolean)
                .map(Number);
            for (let i = 1; i < ids.length - 1; i++) {
                const p = [ps[ids[0]], ps[ids[i]], ps[ids[i + 1]]];
                if (p.some((v) => !v)) throw new Error('Invalid WRL index');
                triangles.push({ p, color });
            }
        }
    }
    if (!triangles.length) throw new Error('No IndexedFaceSet model geometry');
    const width = options.width ?? 1600,
        height = options.height ?? 650;
    if (!(width >= 200 && height >= 200 && width * height <= 16000000))
        throw new Error('Invalid model image size');
    const view = options.view ?? 'isometric',
        [u, v, d] = axes[view].map(normalise),
        project = (p: Vec): Vec => [dot(p, u), -dot(p, v), dot(p, d)];
    const pv = vertices.map(project),
        lo = [0, 1].map((i) => Math.min(...pv.map((p) => p[i]))),
        hi = [0, 1].map((i) => Math.max(...pv.map((p) => p[i])));
    const modelBounds = { minX: lo[0], minY: lo[1], maxX: hi[0], maxY: hi[1] };
    let footprint: ReturnType<typeof renderFootprint> | undefined;
    if (options.footprint) {
        if (view !== 'bottom') throw new Error('Footprint overlays require bottom view');
        footprint = renderFootprint(options.footprint, {
            side: 'bottom',
            overlay: true,
            transparent: true,
            padding: 2,
            labelPosition: 'right',
        });
        lo[0] = Math.min(lo[0], footprint.bounds.minX);
        lo[1] = Math.min(lo[1], footprint.bounds.minY);
        hi[0] = Math.max(hi[0], footprint.bounds.maxX);
        hi[1] = Math.max(hi[1], footprint.bounds.maxY);
    }
    const scale = Math.min((width - 160) / (hi[0] - lo[0]), (height - 170) / (hi[1] - lo[1])),
        ox = (width - scale * (hi[0] + lo[0])) / 2,
        oy = (height - scale * (hi[1] + lo[1])) / 2;
    const screen = (p: Vec): Vec => [ox + p[0] * scale, oy + p[1] * scale, p[2]];
    const rgb = Buffer.alloc(width * height * 3, 255),
        depth = new Float64Array(width * height).fill(-Infinity);
    for (const tri of triangles) {
        const p = tri.p.map((q) => screen(project(q))),
            [a, b, c] = p,
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (Math.abs(den) < 1e-8) continue;
        const minX = Math.max(0, Math.floor(Math.min(...p.map((t) => t[0])))),
            maxX = Math.min(width - 1, Math.ceil(Math.max(...p.map((t) => t[0])))),
            minY = Math.max(0, Math.floor(Math.min(...p.map((t) => t[1])))),
            maxY = Math.min(height - 1, Math.ceil(Math.max(...p.map((t) => t[1]))));
        const e = tri.p[1].map((q, i) => q - tri.p[0][i]),
            f = tri.p[2].map((q, i) => q - tri.p[0][i]),
            n = normalise([
                e[1] * f[2] - e[2] * f[1],
                e[2] * f[0] - e[0] * f[2],
                e[0] * f[1] - e[1] * f[0],
            ]),
            shade = 0.55 + 0.4 * Math.abs(dot(n, [-0.2, -0.4, 0.85]));
        for (let y = minY; y <= maxY; y++)
            for (let x = minX; x <= maxX; x++) {
                const px = x + 0.5,
                    py = y + 0.5,
                    wa = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den,
                    wb = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den,
                    wc = 1 - wa - wb;
                if (wa < 0 || wb < 0 || wc < 0) continue;
                const z = wa * a[2] + wb * b[2] + wc * c[2],
                    idx = y * width + x;
                if (z <= depth[idx]) continue;
                depth[idx] = z;
                for (let i = 0; i < 3; i++)
                    rgb[idx * 3 + i] = Math.max(
                        0,
                        Math.min(255, Math.round(tri.color[i] * 255 * shade)),
                    );
            }
    }
    const png = rgbPng(width, height, rgb);
    let extras = `<text x="25" y="32" font-family="sans-serif" font-size="23" fill="#243442">${xml(options.title ?? `${view} view${footprint ? ' + footprint overlay' : ''}`)}</text>`;
    if (footprint)
        extras += `<g transform="translate(${ox} ${oy}) scale(${scale})">${footprint.body}</g><text x="25" y="${height - 20}" font-family="sans-serif" font-size="18" fill="#96274e">Pink: PCB pads. Green: drills. Blue: footprint geometry. Pad numbers are library numbers; wired lands may be outside the body.</text>`;
    if (options.measurements !== false && view !== 'isometric') {
        const x1 = ox + modelBounds.minX * scale,
            x2 = ox + modelBounds.maxX * scale,
            y = height - 65;
        extras += `<path d="M${x1} ${y - 7}v14 M${x1} ${y}H${x2} M${x2} ${y - 7}v14" stroke="#29618c" fill="none"/><text x="${(x1 + x2) / 2}" y="${y - 10}" text-anchor="middle" font-family="sans-serif" font-size="19" fill="#29618c">Model span ${(modelBounds.maxX - modelBounds.minX).toFixed(2)} mm</text>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" href="data:image/png;base64,${png.toString('base64')}"/>${extras}</svg>`;
    const bounds = {
        min: [0, 1, 2].map((i) => Math.min(...vertices.map((p) => p[i]))),
        max: [0, 1, 2].map((i) => Math.max(...vertices.map((p) => p[i]))),
    };
    return {
        svg,
        png: Buffer.from(new Resvg(svg).render().asPng()),
        bounds,
        modelBounds,
        view,
        footprintPads: footprint?.pads,
    };
}
