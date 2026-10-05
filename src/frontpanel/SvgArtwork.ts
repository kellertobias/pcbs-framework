import * as fs from 'node:fs';
import { parseSync, type INode } from 'svgson';

import type { FrontPanelPoint } from './types';

export type Matrix = [number, number, number, number, number, number];
export const identity: Matrix = [1, 0, 0, 1, 0, 0];
export const multiply = (a: Matrix, b: Matrix): Matrix => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
];
export const transformPoint = (m: Matrix, p: FrontPanelPoint): FrontPanelPoint => ({
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
});
export const rotationMatrix = (degrees: number): Matrix => {
    const angle = (degrees * Math.PI) / 180;
    return [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
};

function numbers(text: string): number[] {
    const tokens = text.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
    if (text.replace(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g, '').replace(/[\s,]/g, ''))
        throw new Error(`Invalid SVG numbers: ${text}`);
    const values = tokens.map(Number);
    if (values.some((value) => !Number.isFinite(value)))
        throw new Error('SVG coordinates must be finite');
    return values;
}

function svgTransform(text = ''): Matrix {
    let matrix = identity;
    const expression = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
    if (text.replace(expression, '').trim()) throw new Error(`Invalid SVG transform: ${text}`);
    for (const match of text.matchAll(expression)) {
        const v = numbers(match[2]);
        let next: Matrix;
        switch (match[1]) {
            case 'matrix':
                if (v.length !== 6) throw new Error('SVG matrix requires six values');
                next = v as Matrix;
                break;
            case 'translate':
                if (v.length < 1 || v.length > 2) throw new Error('Invalid SVG translate');
                next = [1, 0, 0, 1, v[0], v[1] ?? 0];
                break;
            case 'scale':
                if (v.length < 1 || v.length > 2) throw new Error('Invalid SVG scale');
                next = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
                break;
            case 'rotate':
                if (v.length !== 1 && v.length !== 3) throw new Error('Invalid SVG rotate');
                next = rotationMatrix(v[0]);
                if (v.length === 3)
                    next = multiply(multiply([1, 0, 0, 1, v[1], v[2]], next), [
                        1,
                        0,
                        0,
                        1,
                        -v[1],
                        -v[2],
                    ]);
                break;
            case 'skewX':
            case 'skewY':
                if (v.length !== 1) throw new Error('Invalid SVG skew');
                next =
                    match[1] === 'skewX'
                        ? [1, 0, Math.tan((v[0] * Math.PI) / 180), 1, 0, 0]
                        : [1, Math.tan((v[0] * Math.PI) / 180), 0, 1, 0, 0];
                break;
            default:
                throw new Error(`Unsupported SVG transform: ${match[1]}`);
        }
        matrix = multiply(matrix, next);
    }
    if (matrix.some((value) => !Number.isFinite(value)))
        throw new Error('Invalid SVG transform matrix');
    return matrix;
}

export interface SvgContour {
    points: FrontPanelPoint[];
    closed: boolean;
}

/** Import vector contours, with curves flattened to a physical millimetre tolerance. */
export function importSvgContours(
    file: string,
    width: number,
    height: number | undefined,
    matrix: Matrix,
    tolerance: number,
): SvgContour[] {
    const source = fs.readFileSync(file, 'utf8');
    if (Buffer.byteLength(source) > 5 * 1024 * 1024) throw new Error('SVG artwork exceeds 5 MiB');
    const root = parseSync(source);
    if (root.name !== 'svg') throw new Error(`Not an SVG: ${file}`);
    const box = root.attributes.viewBox
        ? numbers(root.attributes.viewBox)
        : [0, 0, Number(root.attributes.width), Number(root.attributes.height)];
    if (
        box.length !== 4 ||
        box.some((value) => !Number.isFinite(value)) ||
        box[2] <= 0 ||
        box[3] <= 0
    )
        throw new Error('SVG artwork needs a finite, positive viewBox (or unitless width/height)');
    const targetHeight = height ?? (width * box[3]) / box[2];
    const scale = Math.min(width / box[2], targetHeight / box[3]);
    const viewport: Matrix = [
        scale,
        0,
        0,
        -scale,
        (-box[2] * scale) / 2 - box[0] * scale,
        (box[3] * scale) / 2 + box[1] * scale,
    ];
    const contours: SvgContour[] = [],
        ids = new Map<string, INode>();
    let vertexCount = 0;
    const collect = (node: INode) => {
        if (node.attributes.id) ids.set(node.attributes.id, node);
        for (const child of node.children) collect(child);
    };
    collect(root);
    const append = (points: FrontPanelPoint[], p: FrontPanelPoint) => {
        if (++vertexCount > 100000) throw new Error('SVG artwork exceeds 100000 contour vertices');
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
            throw new Error('SVG produced nonfinite coordinates');
        points.push(p);
    };
    const mid = (a: FrontPanelPoint, b: FrontPanelPoint): FrontPanelPoint => ({
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
    });
    const flatten = (
        points: FrontPanelPoint[],
        p0: FrontPanelPoint,
        p1: FrontPanelPoint,
        p2: FrontPanelPoint,
        p3: FrontPanelPoint,
        depth = 0,
    ): void => {
        // Distance to the chord *segment* also detects collinear curves that double back.
        const distance = (p: FrontPanelPoint) => {
            const dx = p3.x - p0.x,
                dy = p3.y - p0.y,
                length = dx * dx + dy * dy;
            const t = length
                ? Math.max(0, Math.min(1, ((p.x - p0.x) * dx + (p.y - p0.y) * dy) / length))
                : 0;
            return Math.hypot(p.x - p0.x - t * dx, p.y - p0.y - t * dy);
        };
        if (Math.max(distance(p1), distance(p2)) <= tolerance) {
            append(points, p3);
            return;
        }
        if (depth >= 20) throw new Error('SVG curve could not meet the requested tolerance');
        const a = mid(p0, p1),
            b = mid(p1, p2),
            c = mid(p2, p3),
            d = mid(a, b),
            e = mid(b, c),
            f = mid(d, e);
        flatten(points, p0, a, d, f, depth + 1);
        flatten(points, f, e, c, p3, depth + 1);
    };
    const visit = (
        node: INode,
        parent: Matrix,
        inherited: Record<string, string>,
        references = new Set<string>(),
    ): void => {
        if (node.type !== 'element') return;
        const a = { ...inherited, ...node.attributes };
        for (const rule of (node.attributes.style ?? '').split(';')) {
            const colon = rule.indexOf(':');
            if (colon >= 0) a[rule.slice(0, colon).trim()] = rule.slice(colon + 1).trim();
        }
        if (a.display === 'none' || a.visibility === 'hidden' || Number(a.opacity) === 0) return;
        if (['clip-path', 'mask', 'filter'].some((key) => a[key] && a[key] !== 'none'))
            throw new Error('Flatten SVG clipping, masks, and filters before engraving');
        const m = multiply(parent, svgTransform(node.attributes.transform));
        const style = Object.fromEntries(
            ['fill', 'stroke', 'display', 'visibility']
                .filter((key) => a[key] !== undefined)
                .map((key) => [key, a[key]]),
        );
        if (['defs', 'metadata', 'title', 'desc'].includes(node.name)) return;
        if (['svg', 'g'].includes(node.name)) {
            if (node !== root && node.name === 'svg')
                throw new Error('Flatten nested SVG viewports before engraving');
            for (const child of node.children) visit(child, m, style, references);
            return;
        }
        if (node.name === 'use') {
            const href = a.href ?? a['xlink:href'];
            if (!href?.startsWith('#') || !ids.has(href.slice(1)))
                throw new Error('SVG use must reference a local vector element');
            if (references.has(href)) throw new Error('Circular SVG use reference');
            const next = new Set(references);
            next.add(href);
            visit(
                ids.get(href.slice(1))!,
                multiply(m, [1, 0, 0, 1, Number(a.x ?? 0), Number(a.y ?? 0)]),
                style,
                next,
            );
            return;
        }
        const n = (key: string, fallback = 0): number => {
            const value = a[key] === undefined ? fallback : Number(a[key]);
            if (!Number.isFinite(value))
                throw new Error(`SVG ${node.name}.${key} must be a unitless finite coordinate`);
            return value;
        };
        let data: string;
        switch (node.name) {
            case 'path':
                data = a.d ?? '';
                break;
            case 'line':
                data = `M${n('x1')} ${n('y1')} L${n('x2')} ${n('y2')}`;
                break;
            case 'polyline':
            case 'polygon': {
                const p = numbers(a.points ?? '');
                if (p.length < 4 || p.length % 2)
                    throw new Error('Invalid SVG polygon/polyline points');
                data =
                    `M${p[0]} ${p[1]} ` +
                    p
                        .slice(2)
                        .reduce((s, value, i) => s + (i % 2 ? `${value} ` : `L${value} `), '') +
                    (node.name === 'polygon' ? 'Z' : '');
                break;
            }
            case 'circle':
            case 'ellipse': {
                const x = n('cx'),
                    y = n('cy'),
                    rx = node.name === 'circle' ? n('r') : n('rx'),
                    ry = node.name === 'circle' ? rx : n('ry');
                if (rx < 0 || ry < 0) throw new Error('SVG radius must be nonnegative');
                if (!rx || !ry) return;
                data = `M${x + rx} ${y} A${rx} ${ry} 0 1 0 ${x - rx} ${y} A${rx} ${ry} 0 1 0 ${x + rx} ${y} Z`;
                break;
            }
            case 'rect': {
                const x = n('x'),
                    y = n('y'),
                    w = n('width'),
                    h = n('height');
                if (w < 0 || h < 0) throw new Error('SVG rectangle size must be nonnegative');
                if (!w || !h) return;
                const rx = Math.min(w / 2, n('rx', n('ry'))),
                    ry = Math.min(h / 2, n('ry', n('rx')));
                if (rx < 0 || ry < 0) throw new Error('SVG corner radius must be nonnegative');
                data =
                    rx && ry
                        ? `M${x + rx} ${y} H${x + w - rx} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H${x + rx} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V${y + ry} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`
                        : `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
                break;
            }
            case 'text':
                throw new Error('Convert SVG logo text to paths before engraving');
            case 'style':
                throw new Error('Inline SVG CSS styles before engraving');
            default:
                throw new Error(`Unsupported SVG artwork element: ${node.name}`);
        }
        if (
            !data.trim() ||
            (a.fill === 'none' && (!a.stroke || a.stroke === 'none')) ||
            (node.name === 'line' && (!a.stroke || a.stroke === 'none'))
        )
            return;
        const SVGPathCommander: typeof import('svg-path-commander').default =
            require('svg-path-commander').default;
        const normalized = SVGPathCommander.normalizePath(data);
        const subpaths: (typeof normalized)[] = [];
        for (const segment of normalized) {
            if (segment[0] === 'M') {
                subpaths.push([segment]);
                continue;
            }
            if (!subpaths.length) throw new Error('SVG path must start with M');
            subpaths[subpaths.length - 1].push(segment);
        }
        for (const subpath of subpaths) {
            const points: FrontPanelPoint[] = [];
            const closed =
                subpath[subpath.length - 1][0] === 'Z' ||
                (node.name === 'path' && a.fill !== 'none');
            let previous: FrontPanelPoint | undefined;
            for (const segment of SVGPathCommander.pathToCurve(subpath)) {
                if (segment[0] === 'M') {
                    previous = transformPoint(m, { x: segment[1], y: segment[2] });
                    append(points, previous);
                } else {
                    if (!previous) throw new Error('Invalid SVG curve');
                    const end = transformPoint(m, { x: segment[5], y: segment[6] });
                    flatten(
                        points,
                        previous,
                        transformPoint(m, { x: segment[1], y: segment[2] }),
                        transformPoint(m, { x: segment[3], y: segment[4] }),
                        end,
                    );
                    previous = end;
                }
            }
            if (
                closed &&
                points.length > 1 &&
                Math.hypot(
                    points[0].x - points[points.length - 1].x,
                    points[0].y - points[points.length - 1].y,
                ) < 1e-9
            )
                points.pop();
            if (points.length >= (closed ? 3 : 2)) contours.push({ points, closed });
        }
    };
    visit(root, multiply(matrix, viewport), {});
    if (!contours.length)
        throw new Error('SVG artwork contains no supported visible vector contours');
    return contours;
}
