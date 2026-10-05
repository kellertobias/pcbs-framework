import { compileArtwork, artworkPoints, type ArtworkEntity } from './FrontPanelArtwork';
import type { FrontPanelDrawing, FrontPanelDrawingAnchor } from './types';
import * as fs from 'fs';
import * as path from 'path';
import { SExpressionParser, SExpr } from '../kicad/SExpressionParser';
import type {
    FrontPanelCutout,
    FrontPanelExportResult,
    FrontPanelLabelAnchor,
    FrontPanelEdge,
    VerticalFrontPanelInterface,
    VerticalFrontPanelOptions,
    VerticalFrontPanelExportResult,
} from './types';

type Point = { x: number; y: number };
type Segment = { start: Point; end: Point };
type PanelShape =
    | { type: 'circle'; center: Point; radius: number }
    | { type: 'polygon'; points: Point[] };
type PanelAnnotations = { segments: Segment[]; labels: PanelLabel[] };
export interface NamedVerticalPanelOptions {
    name: string;
    nameHeight?: number;
    textStyle?: import('./types').FrontPanelTextStyle;
    drawings?: readonly FrontPanelDrawing[];
    extends: { left: number; right: number; top: number; bottom: number };
    selections: ReadonlyMap<
        string,
        {
            footprint: string;
            face?: VerticalFrontPanelInterface;
            name?: string;
            placement: 'above' | 'below';
            nameStyle?: import('./types').FrontPanelTextStyle;
        }
    >;
}

type PanelLabel = {
    bold?: boolean;
    text: string;
    at: Point;
    rotation: number;
    fontSize: number;
};

const child = (node: SExpr[], keyword: string): SExpr[] | undefined =>
    node.find((entry): entry is SExpr[] => Array.isArray(entry) && entry[0] === keyword);
const children = (node: SExpr[], keyword: string): SExpr[][] =>
    node.filter((entry): entry is SExpr[] => Array.isArray(entry) && entry[0] === keyword);
const atom = (value: SExpr | undefined): string =>
    typeof value === 'string' ? SExpressionParser.unquote(value) : '';
const numberAt = (node: SExpr[] | undefined, index: number): number => Number(atom(node?.[index]));

function rotate(point: Point, degrees: number): Point {
    // KiCad board coordinates have Y pointing down, so footprint rotation is
    // the inverse of the conventional Cartesian transform used by Math.sin.
    const radians = (-degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function place(point: Point, origin: Point, rotation: number): Point {
    const local = rotate(point, rotation);
    return { x: origin.x + local.x, y: origin.y + local.y };
}

function roundedRectPoints(width: number, height: number, radius: number): Point[] {
    const rx = Math.max(0, Math.min(radius, width / 2));
    const ry = Math.max(0, Math.min(radius, height / 2));
    if (rx === 0 || ry === 0)
        return [
            { x: -width / 2, y: -height / 2 },
            { x: width / 2, y: -height / 2 },
            { x: width / 2, y: height / 2 },
            { x: -width / 2, y: height / 2 },
        ];
    const result: Point[] = [];
    for (const [cx, cy, start] of [
        [width / 2 - rx, -height / 2 + ry, -90],
        [width / 2 - rx, height / 2 - ry, 0],
        [-width / 2 + rx, height / 2 - ry, 90],
        [-width / 2 + rx, -height / 2 + ry, 180],
    ] as Array<[number, number, number]>) {
        for (let step = 0; step <= 6; step++) {
            const angle = ((start + step * 15) * Math.PI) / 180;
            result.push({
                x: cx + rx * Math.cos(angle),
                y: cy + ry * Math.sin(angle),
            });
        }
    }
    return result;
}

function property(node: SExpr[], name: string): string | undefined {
    const match = children(node, 'property').find((item) => atom(item[1]) === name);
    return match ? atom(match[2]) : undefined;
}

function parseJson<T>(value: string | undefined, description: string): T | undefined {
    if (!value) return undefined;
    try {
        return JSON.parse(value) as T;
    } catch {
        throw new Error(`Invalid ${description} metadata in PCB: ${value}`);
    }
}

function convertCutout(
    cutout: FrontPanelCutout,
    origin: Point,
    footprintRotation: number,
): PanelShape {
    if (cutout.type === 'circle') {
        return {
            type: 'circle',
            center: place({ x: cutout.x ?? 0, y: cutout.y ?? 0 }, origin, footprintRotation),
            radius: cutout.diameter / 2,
        };
    }
    const localRotation = cutout.rotation ?? 0;
    const offset =
        cutout.type === 'roundedRect' ? { x: cutout.x ?? 0, y: cutout.y ?? 0 } : { x: 0, y: 0 };
    const localPoints =
        cutout.type === 'roundedRect'
            ? roundedRectPoints(cutout.width, cutout.height, cutout.radius ?? 0)
            : cutout.points;
    return {
        type: 'polygon',
        points: localPoints.map((point) =>
            place(
                {
                    x: rotate(point, localRotation).x + offset.x,
                    y: rotate(point, localRotation).y + offset.y,
                },
                origin,
                footprintRotation,
            ),
        ),
    };
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function dxfStyles(): Array<string | number> {
    const out: Array<string | number> = [0, 'TABLE', 2, 'STYLE', 100, 'AcDbSymbolTable', 70, 2];
    for (const [name, font] of [
        ['STANDARD', 'arial.ttf'],
        ['PCBS_BOLD', 'arialbd.ttf'],
    ])
        out.push(
            0,
            'STYLE',
            100,
            'AcDbSymbolTableRecord',
            100,
            'AcDbTextStyleTableRecord',
            2,
            name,
            70,
            0,
            40,
            0,
            41,
            1,
            50,
            0,
            71,
            0,
            42,
            2.5,
            3,
            font,
            4,
            '',
        );
    out.push(0, 'ENDTAB');
    return out;
}
function dxf(
    segments: Segment[],
    shapes: PanelShape[],
    labels: PanelLabel[],
    annotations?: PanelAnnotations,
    artwork: ArtworkEntity[] = [],
): string {
    const out: Array<string | number> = [
        0,
        'SECTION',
        2,
        'HEADER',
        9,
        '$ACADVER',
        1,
        'AC1015',
        9,
        '$INSUNITS',
        70,
        4,
        0,
        'ENDSEC',
    ];
    if (annotations) {
        out.push(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 100, 'AcDbSymbolTable', 70, 4);
        for (const [layer, color] of [
            ['OUTLINE', 7],
            ['ENGRAVING', 5],
            ['CUTOUT', 1],
            ['ANNOTATIONS', 30],
        ])
            out.push(
                0,
                'LAYER',
                100,
                'AcDbSymbolTableRecord',
                100,
                'AcDbLayerTableRecord',
                2,
                layer,
                70,
                0,
                62,
                color,
                6,
                'CONTINUOUS',
            );
        out.push(0, 'ENDTAB');
        out.push(...dxfStyles(), 0, 'ENDSEC');
    }
    if (!annotations && labels.some((l) => l.bold))
        out.push(0, 'SECTION', 2, 'TABLES', ...dxfStyles(), 0, 'ENDSEC');
    out.push(0, 'SECTION', 2, 'ENTITIES');
    for (const line of segments)
        out.push(
            0,
            'LINE',
            100,
            'AcDbEntity',
            8,
            'OUTLINE',
            100,
            'AcDbLine',
            10,
            line.start.x,
            20,
            line.start.y,
            11,
            line.end.x,
            21,
            line.end.y,
        );
    for (const shape of shapes) {
        if (shape.type === 'circle')
            out.push(
                0,
                'CIRCLE',
                100,
                'AcDbEntity',
                8,
                'CUTOUT',
                100,
                'AcDbCircle',
                10,
                shape.center.x,
                20,
                shape.center.y,
                40,
                shape.radius,
            );
        else {
            out.push(
                0,
                'LWPOLYLINE',
                100,
                'AcDbEntity',
                8,
                'CUTOUT',
                100,
                'AcDbPolyline',
                90,
                shape.points.length,
                70,
                1,
            );
            for (const point of shape.points) out.push(10, point.x, 20, point.y);
        }
    }
    for (const label of labels)
        out.push(
            0,
            'TEXT',
            100,
            'AcDbEntity',
            8,
            annotations ? 'ENGRAVING' : 'MARKING',
            100,
            'AcDbText',
            10,
            label.at.x,
            20,
            label.at.y,
            40,
            label.fontSize,
            1,
            label.text,
            7,
            label.bold ? 'PCBS_BOLD' : 'STANDARD',
            50,
            label.rotation,
            72,
            1,
            11,
            label.at.x,
            21,
            label.at.y,
            100,
            'AcDbText',
            73,
            2,
        );
    if (annotations) {
        for (const line of annotations.segments)
            out.push(
                0,
                'LINE',
                100,
                'AcDbEntity',
                8,
                'ANNOTATIONS',
                100,
                'AcDbLine',
                10,
                line.start.x,
                20,
                line.start.y,
                11,
                line.end.x,
                21,
                line.end.y,
            );
        for (const label of annotations.labels)
            out.push(
                0,
                'TEXT',
                100,
                'AcDbEntity',
                8,
                'ANNOTATIONS',
                100,
                'AcDbText',
                10,
                label.at.x,
                20,
                label.at.y,
                40,
                label.fontSize,
                1,
                label.text.replace(/⌀/g, '%%c'),
                7,
                label.bold ? 'PCBS_BOLD' : 'STANDARD',
                72,
                1,
                11,
                label.at.x,
                21,
                label.at.y,
                100,
                'AcDbText',
                73,
                2,
            );
    }
    for (const e of artwork) {
        const base = [
            0,
            e.type === 'polyline' ? 'LWPOLYLINE' : e.type.toUpperCase(),
            100,
            'AcDbEntity',
            8,
            e.layer,
        ];
        out.push(...base);
        if (e.type === 'line')
            out.push(100, 'AcDbLine', 10, e.start.x, 20, e.start.y, 11, e.end.x, 21, e.end.y);
        else if (e.type === 'circle' || e.type === 'arc') {
            out.push(100, 'AcDbCircle', 10, e.center.x, 20, e.center.y, 40, e.radius);
            if (e.type === 'arc')
                out.push(
                    100,
                    'AcDbArc',
                    50,
                    ((e.startAngle % 360) + 360) % 360,
                    51,
                    ((e.endAngle % 360) + 360) % 360,
                );
        } else if (e.type === 'polyline') {
            out.push(100, 'AcDbPolyline', 90, e.points.length, 70, e.closed ? 1 : 0);
            for (const p of e.points) out.push(10, p.x, 20, p.y);
        } else
            out.push(
                100,
                'AcDbText',
                10,
                e.at.x,
                20,
                e.at.y,
                40,
                e.fontSize,
                1,
                e.text,
                7,
                e.bold ? 'PCBS_BOLD' : 'STANDARD',
                50,
                e.rotation,
                72,
                1,
                11,
                e.at.x,
                21,
                e.at.y,
                100,
                'AcDbText',
                73,
                2,
            );
    }
    out.push(0, 'ENDSEC', 0, 'EOF');
    return (
        out
            .map((v) =>
                typeof v === 'string'
                    ? v.replace(
                          /[^\x00-\x7F]/g,
                          (c) =>
                              '\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'),
                      )
                    : v,
            )
            .join('\n') + '\n'
    );
}

function svg(
    segments: Segment[],
    shapes: PanelShape[],
    labels: PanelLabel[],
    annotations?: PanelAnnotations,
    artwork: ArtworkEntity[] = [],
): string {
    const points = [
        ...segments.flatMap((line) => [line.start, line.end]),
        ...shapes.flatMap((shape) =>
            shape.type === 'circle'
                ? [
                      {
                          x: shape.center.x - shape.radius,
                          y: shape.center.y - shape.radius,
                      },
                      {
                          x: shape.center.x + shape.radius,
                          y: shape.center.y + shape.radius,
                      },
                  ]
                : shape.points,
        ),
    ];
    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxY = Math.max(...points.map((point) => point.y));
    const body: string[] = [];
    body.push(`<g id="OUTLINE" fill="none" stroke="#111" stroke-width="0.35">`);
    for (const line of segments)
        body.push(
            `<line x1="${line.start.x}" y1="${line.start.y}" x2="${line.end.x}" y2="${line.end.y}"/>`,
        );
    body.push(`</g><g id="CUTOUT" fill="none" stroke="#d22" stroke-width="0.3">`);
    for (const shape of shapes) {
        if (shape.type === 'circle')
            body.push(
                `<circle cx="${shape.center.x}" cy="${shape.center.y}" r="${shape.radius}"/>`,
            );
        else
            body.push(
                `<polygon points="${shape.points.map((point) => `${point.x},${point.y}`).join(' ')}"/>`,
            );
    }
    body.push(
        `</g><g id="${annotations ? 'ENGRAVING' : 'MARKING'}" fill="#1464b4" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">`,
    );
    for (const label of labels)
        body.push(
            `<text x="${label.at.x}" y="${label.at.y}" font-size="${label.fontSize}" font-weight="${label.bold ? 'bold' : 'normal'}" transform="rotate(${label.rotation} ${label.at.x} ${label.at.y})">${escapeXml(label.text)}</text>`,
        );
    body.push(`</g>`);
    if (annotations) {
        body.push(`<g id="ANNOTATIONS" stroke="#a1660a" fill="none" stroke-width="0.12">`);
        for (const line of annotations.segments)
            body.push(
                `<line x1="${line.start.x}" y1="${line.start.y}" x2="${line.end.x}" y2="${line.end.y}"/>`,
            );
        body.push(
            `<g stroke="none" fill="#a1660a" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">`,
        );
        for (const label of annotations.labels)
            body.push(
                `<text x="${label.at.x}" y="${label.at.y}" font-size="${label.fontSize}" font-weight="${label.bold ? 'bold' : 'normal'}">${escapeXml(label.text)}</text>`,
            );
        body.push(`</g></g>`);
    }
    for (const layer of ['OUTLINE', 'CUTOUT', 'ENGRAVING', 'ANNOTATIONS']) {
        const content = artwork
            .filter((e) => e.layer === layer)
            .map((e) => {
                const style = `fill="none" stroke="${layer === 'ENGRAVING' ? '#1464b4' : layer === 'CUTOUT' ? '#d22' : layer === 'ANNOTATIONS' ? '#a1660a' : '#111'}" stroke-width="${e.strokeWidth}"`;
                if (e.type === 'line')
                    return `<line ${style} x1="${e.start.x}" y1="${-e.start.y}" x2="${e.end.x}" y2="${-e.end.y}"/>`;
                if (e.type === 'circle')
                    return `<circle ${style} cx="${e.center.x}" cy="${-e.center.y}" r="${e.radius}"/>`;
                if (e.type === 'polyline')
                    return `<${e.closed ? 'polygon' : 'polyline'} ${style} points="${e.points.map((p) => `${p.x},${-p.y}`).join(' ')}"/>`;
                if (e.type === 'text')
                    return `<text fill="${layer === 'ENGRAVING' ? '#1464b4' : layer === 'CUTOUT' ? '#d22' : layer === 'ANNOTATIONS' ? '#a1660a' : '#111'}" stroke="none" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" x="${e.at.x}" y="${-e.at.y}" font-size="${e.fontSize}" font-weight="${e.bold ? 'bold' : 'normal'}" transform="rotate(${-e.rotation} ${e.at.x} ${-e.at.y})">${escapeXml(e.text)}</text>`;
                const point = (a: number) => ({
                    x: e.center.x + e.radius * Math.cos((a * Math.PI) / 180),
                    y: -(e.center.y + e.radius * Math.sin((a * Math.PI) / 180)),
                });
                const a = point(e.startAngle),
                    b = point(e.endAngle),
                    sweep = (e.endAngle - e.startAngle + 360) % 360;
                return `<path ${style} d="M ${a.x} ${a.y} A ${e.radius} ${e.radius} 0 ${sweep > 180 ? 1 : 0} 0 ${b.x} ${b.y}"/>`;
            })
            .join('\n');
        // Insert into the existing layer group, preserving the four-layer contract.
        if (content) {
            const markup = body.join('\n');
            const start = markup.indexOf(`<g id="${layer}"`);
            const end = markup.indexOf('>', start) + 1;
            body.splice(0, body.length, markup.slice(0, end) + content + markup.slice(end));
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX - minX}mm" height="${maxY - minY}mm" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}">${body.join('\n')}</svg>\n`;
}

export function exportFrontPanel(
    pcbFile: string,
    outputDir = path.join(path.dirname(pcbFile), 'front-panel'),
): FrontPanelExportResult {
    const parsed = SExpressionParser.parse(fs.readFileSync(pcbFile, 'utf8'));
    const board = parsed.find(
        (entry): entry is SExpr[] => Array.isArray(entry) && entry[0] === 'kicad_pcb',
    );
    if (!board) throw new Error(`Not a KiCad PCB: ${pcbFile}`);

    const segments: Segment[] = [];
    for (const line of children(board, 'gr_line')) {
        if (atom(child(line, 'layer')?.[1]) !== 'Edge.Cuts') continue;
        const start = child(line, 'start');
        const end = child(line, 'end');
        segments.push({
            start: { x: numberAt(start, 1), y: numberAt(start, 2) },
            end: { x: numberAt(end, 1), y: numberAt(end, 2) },
        });
    }
    if (segments.length === 0) throw new Error(`PCB has no Edge.Cuts gr_line outline: ${pcbFile}`);

    const shapes: PanelShape[] = [];
    const labels: PanelLabel[] = [];
    for (const footprint of children(board, 'footprint')) {
        const at = child(footprint, 'at');
        const origin = { x: numberAt(at, 1), y: numberAt(at, 2) };
        const rotation = Number(atom(at?.[3]) || 0);
        const cutouts =
            parseJson<FrontPanelCutout[]>(
                property(footprint, 'FrontPanelCutouts'),
                'FrontPanelCutouts',
            ) ?? [];
        for (const cutout of cutouts) shapes.push(convertCutout(cutout, origin, rotation));

        const text = property(footprint, 'FrontPanelText');
        const anchor = parseJson<FrontPanelLabelAnchor>(
            property(footprint, 'FrontPanelLabelAnchor'),
            'FrontPanelLabelAnchor',
        );
        if (text && anchor)
            labels.push({
                text,
                at: place(anchor, origin, rotation),
                rotation: -(rotation + (anchor.rotation ?? 0)),
                fontSize: anchor.fontSize ?? 3,
                bold: anchor.bold,
            });
    }

    fs.mkdirSync(outputDir, { recursive: true });
    const base = path.basename(pcbFile, '.kicad_pcb');
    const dxfFile = path.join(outputDir, `${base}-front-panel.dxf`);
    const svgFile = path.join(outputDir, `${base}-front-panel.svg`);
    fs.writeFileSync(dxfFile, dxf(segments, shapes, labels));
    fs.writeFileSync(svgFile, svg(segments, shapes, labels));
    return {
        pcbFile,
        dxfFile,
        svgFile,
        outlineSegments: segments.length,
        cutouts: shapes.length,
        labels: labels.length,
    };
}

const edgeNormal: Record<FrontPanelEdge, Point> = {
    top: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    bottom: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
};

function finite(value: number, context: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error(`${context} must be finite`);
    return value;
}

function validateFace(face: VerticalFrontPanelInterface, ref: string): void {
    if (!face || !face.anchor || !Object.hasOwnProperty.call(edgeNormal, face.facing))
        throw new Error(`${ref}: invalid vertical front-panel interface`);
    for (const axis of ['x', 'y', 'z'] as const)
        finite(face.anchor[axis], `${ref}: anchor.${axis}`);
    if (!Array.isArray(face.cutouts) || face.cutouts.length === 0)
        throw new Error(`${ref}: interface needs cutouts`);
    for (const cutout of face.cutouts) {
        if (!cutout || !['circle', 'roundedRect', 'polygon'].includes(cutout.type))
            throw new Error(`${ref}: invalid cutout type`);
        if (cutout.type === 'polygon') {
            if (!Array.isArray(cutout.points) || cutout.points.length < 3)
                throw new Error(`${ref}: polygon needs at least three points`);
            for (const point of cutout.points) {
                finite(point.x, `${ref}: polygon.x`);
                finite(point.y, `${ref}: polygon.y`);
            }
        } else {
            finite(cutout.x ?? 0, `${ref}: cutout.x`);
            finite(cutout.y ?? 0, `${ref}: cutout.y`);
            const sizes =
                cutout.type === 'circle' ? [cutout.diameter] : [cutout.width, cutout.height];
            if (sizes.some((size) => finite(size, `${ref}: cutout size`) <= 0))
                throw new Error(`${ref}: cutout sizes must be positive`);
            if (
                cutout.type === 'roundedRect' &&
                (finite(cutout.radius ?? 0, `${ref}: radius`) < 0 ||
                    (cutout.radius ?? 0) > Math.min(cutout.width, cutout.height) / 2)
            )
                throw new Error(`${ref}: invalid corner radius`);
        }
        if (cutout.type !== 'circle') finite(cutout.rotation ?? 0, `${ref}: cutout rotation`);
    }
    for (const anchor of [face.labelAnchor, face.labelAnchors?.above, face.labelAnchors?.below]) {
        if (!anchor) continue;
        finite(anchor.x, `${ref}: label.x`);
        finite(anchor.y, `${ref}: label.y`);
        finite(anchor.rotation ?? 0, `${ref}: label rotation`);
        if (finite(anchor.fontSize ?? 3, `${ref}: label font size`) <= 0)
            throw new Error(`${ref}: label font size must be positive`);
    }
}

/** Project explicitly selected connector faces onto an orthogonal plate. */
export function exportVerticalFrontPanel(
    pcbFile: string,
    options: VerticalFrontPanelOptions,
    named?: NamedVerticalPanelOptions,
): VerticalFrontPanelExportResult & { annotations: number; drawings: number } {
    if (!Object.hasOwnProperty.call(edgeNormal, options.edge))
        throw new Error('Choose top, right, bottom, or left PCB edge');
    if (
        !Array.isArray(options.components) ||
        !options.components.length ||
        options.components.some((ref) => typeof ref !== 'string' || !ref.trim())
    )
        throw new Error('Select at least one component reference');
    if (new Set(options.components).size !== options.components.length)
        throw new Error('Component references must be unique');
    if (finite(options.height, 'Panel height') <= 0)
        throw new Error('Panel height must be positive');
    const bottomZ = finite(options.bottomZ ?? 0, 'Panel bottomZ');
    const board = SExpressionParser.parse(fs.readFileSync(pcbFile, 'utf8')).find(
        (entry): entry is SExpr[] => Array.isArray(entry) && entry[0] === 'kicad_pcb',
    );
    if (!board) throw new Error(`Not a KiCad PCB: ${pcbFile}`);
    const outlinePoints: Point[] = [];
    for (const item of board) {
        if (!Array.isArray(item) || atom(child(item, 'layer')?.[1]) !== 'Edge.Cuts') continue;
        if (item[0] !== 'gr_line' && item[0] !== 'gr_rect')
            throw new Error(
                'Vertical panels currently require a straight Edge.Cuts outline (gr_line or gr_rect)',
            );
        for (const key of ['start', 'end']) {
            const point = child(item, key);
            if (!point) throw new Error('Invalid Edge.Cuts outline');
            outlinePoints.push({
                x: finite(numberAt(point, 1), 'Outline x'),
                y: finite(numberAt(point, 2), 'Outline y'),
            });
        }
    }
    if (!outlinePoints.length) throw new Error('PCB has no Edge.Cuts outline');
    const minX = Math.min(...outlinePoints.map((p) => p.x)),
        minY = Math.min(...outlinePoints.map((p) => p.y));
    const maxX = Math.max(...outlinePoints.map((p) => p.x)),
        maxY = Math.max(...outlinePoints.map((p) => p.y));
    const horizontal = options.edge === 'top' || options.edge === 'bottom';
    const width = horizontal ? maxX - minX : maxY - minY;
    if (width <= 0) throw new Error('PCB edge span must be positive');
    if (named) {
        for (const key of ['left', 'right', 'top', 'bottom'] as const)
            if (finite(named.extends[key], `Panel extends.${key}`) < 0)
                throw new Error(`Panel extends.${key} must be nonnegative`);
        if (named.extends.top + named.extends.bottom <= 0)
            throw new Error('Panel vertical extent must be positive');
    }
    const left = named ? -named.extends.left : 0;
    const right = width + (named?.extends.right ?? 0);
    const bottom = named ? -named.extends.bottom : 0;
    const top = named ? named.extends.top : options.height;
    const corners = [
        { x: left, y: bottom },
        { x: right, y: bottom },
        { x: right, y: top },
        { x: left, y: top },
    ];
    const segments = corners.map((start, index) => ({
        start,
        end: corners[(index + 1) % 4],
    }));
    const shapes: PanelShape[] = [],
        labels: PanelLabel[] = [];
    const annotations: PanelAnnotations = { segments: [], labels: [] };
    const footprints = children(board, 'footprint');
    const drawingAnchors = new Map<string, { interface: Point; above?: Point; below?: Point }>();
    for (const ref of options.components) {
        const matches = footprints.filter(
            (fp) =>
                property(fp, 'Reference') === ref ||
                children(fp, 'fp_text').some(
                    (text) => text[1] === 'reference' && atom(text[2]) === ref,
                ),
        );
        if (matches.length !== 1)
            throw new Error(`${ref}: expected one PCB footprint, found ${matches.length}`);
        const footprint = matches[0];
        if (atom(child(footprint, 'layer')?.[1]) !== 'F.Cu')
            throw new Error(`${ref}: vertical interfaces currently require a front-side footprint`);
        const selection = named?.selections.get(ref);
        if (selection && atom(footprint[1]) !== selection.footprint)
            throw new Error(
                `${ref}: saved footprint does not match the schematic's ${selection.footprint}`,
            );
        const face =
            selection?.face ??
            parseJson<VerticalFrontPanelInterface>(
                property(footprint, 'VerticalFrontPanelInterface'),
                `${ref}: VerticalFrontPanelInterface`,
            );
        if (!face) throw new Error(`${ref}: no vertical front-panel interface defined`);
        validateFace(face, ref);
        const at = child(footprint, 'at');
        if (!at) throw new Error(`${ref}: missing PCB position`);
        const origin = {
            x: finite(numberAt(at, 1), `${ref}: PCB x`),
            y: finite(numberAt(at, 2), `${ref}: PCB y`),
        };
        const rotation = finite(Number(atom(at[3]) || 0), `${ref}: PCB rotation`);
        const normal = rotate(edgeNormal[face.facing], rotation),
            expected = edgeNormal[options.edge];
        if (Math.hypot(normal.x - expected.x, normal.y - expected.y) > 1e-6)
            throw new Error(
                `${ref}: connector face does not face the selected ${options.edge} edge`,
            );
        const anchor = place(face.anchor, origin, rotation);
        const tangent = rotate(
            { x: -edgeNormal[face.facing].y, y: edgeNormal[face.facing].x },
            rotation,
        );
        const direction = horizontal ? tangent.x : tangent.y;
        const x = horizontal ? anchor.x - minX : anchor.y - minY;
        const project = (point: Point): Point => ({
            x: x + direction * point.x,
            y: face.anchor.z - (named ? 0 : bottomZ) + point.y,
        });
        drawingAnchors.set(ref, {
            interface: project({ x: 0, y: 0 }),
            above: face.labelAnchors?.above
                ? project(face.labelAnchors.above)
                : face.labelAnchor
                  ? project(face.labelAnchor)
                  : undefined,
            below: face.labelAnchors?.below ? project(face.labelAnchors.below) : undefined,
        });
        for (const cutout of face.cutouts) {
            // Face rotations are conventional, counterclockwise in the X/Z plane.
            const shape = convertCutout(
                cutout.type === 'circle'
                    ? cutout
                    : { ...cutout, rotation: -(cutout.rotation ?? 0) },
                { x: 0, y: 0 },
                0,
            );
            const projected: PanelShape =
                shape.type === 'circle'
                    ? { ...shape, center: project(shape.center) }
                    : { ...shape, points: shape.points.map(project) };
            const extents =
                projected.type === 'circle'
                    ? [
                          {
                              x: projected.center.x - projected.radius,
                              y: projected.center.y - projected.radius,
                          },
                          {
                              x: projected.center.x + projected.radius,
                              y: projected.center.y + projected.radius,
                          },
                      ]
                    : projected.points;
            if (
                extents.some(
                    (p) =>
                        p.x < left - 1e-6 ||
                        p.x > right + 1e-6 ||
                        p.y < bottom - 1e-6 ||
                        p.y > top + 1e-6,
                )
            )
                throw new Error(
                    `${ref}: cutout extends outside the plate; adjust height or bottomZ`,
                );
            shapes.push(projected);
            if (named) {
                const minX = Math.min(...extents.map((p) => p.x)),
                    maxX = Math.max(...extents.map((p) => p.x));
                const minY = Math.min(...extents.map((p) => p.y)),
                    maxY = Math.max(...extents.map((p) => p.y));
                const center =
                    projected.type === 'circle'
                        ? projected.center
                        : { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
                annotations.segments.push(
                    {
                        start: { x: center.x - 1, y: center.y },
                        end: { x: center.x + 1, y: center.y },
                    },
                    {
                        start: { x: center.x, y: center.y - 1 },
                        end: { x: center.x, y: center.y + 1 },
                    },
                );
                const mm = (value: number) => String(Number(value.toFixed(3)));
                const text =
                    projected.type === 'circle'
                        ? `⌀${mm(projected.radius * 2)}`
                        : `${mm(maxX - minX)} x ${mm(maxY - minY)}`;
                const below =
                    projected.type === 'circle' && projected.radius < 3 && center.y < face.anchor.z;
                const annotationY = below
                    ? Math.max(minY - 2.5, bottom + 1.5)
                    : Math.min(maxY + 2.5, top - 1.5);
                annotations.labels.push({
                    text,
                    at: { x: center.x, y: annotationY },
                    rotation: 0,
                    fontSize: 1.5,
                    bold: named?.textStyle?.bold,
                });
            }
        }
        const text = selection ? selection.name : property(footprint, 'FrontPanelText');
        const labelAnchor = selection
            ? (face.labelAnchors?.[selection.placement] ??
              (selection.placement === 'above' ? face.labelAnchor : undefined))
            : face.labelAnchor;
        if (text && !labelAnchor)
            throw new Error(
                `${ref}: no ${selection?.placement ?? 'default'} name placement defined on its front-panel interface`,
            );
        if (text && labelAnchor) {
            const at = project(labelAnchor);
            if (named?.nameHeight !== undefined) at.y = finite(named.nameHeight, 'Name height');
            if (named && (at.x < left || at.x > right || at.y < bottom || at.y > top))
                throw new Error(`${ref}: name anchor extends outside the panel`);
            labels.push({
                text,
                at,
                rotation: direction * (labelAnchor.rotation ?? 0),
                fontSize: labelAnchor.fontSize ?? 3,
                bold: selection?.nameStyle?.bold ?? labelAnchor.bold ?? named?.textStyle?.bold,
            });
        }
    }
    const artwork = compileArtwork(named?.drawings ?? [], (anchor: FrontPanelDrawingAnchor) => {
        const at = drawingAnchors.get(anchor.component.ref)?.[anchor.placement ?? 'interface'];
        if (!at)
            throw new Error(
                `${anchor.component.ref}: missing artwork anchor ${anchor.placement ?? 'interface'}`,
            );
        return {
            x: at.x + (anchor.offset?.x ?? 0),
            y: at.y + (anchor.offset?.y ?? 0),
        };
    });
    for (const e of artwork) if (e.type === 'text') e.bold ??= named?.textStyle?.bold;
    for (const e of artwork)
        if (artworkPoints(e).some((p) => p.x < left || p.x > right || p.y < bottom || p.y > top))
            throw new Error('Artwork extends outside the plate');
    const outputDir = options.outputDir ?? path.join(path.dirname(pcbFile), 'front-panel');
    const base = named
        ? `${path.basename(pcbFile, '.kicad_pcb')}-${named.name}-front-panel`
        : `${path.basename(pcbFile, '.kicad_pcb')}-vertical-${options.edge}-front-panel`;
    const dxfFile = path.join(outputDir, `${base}.dxf`),
        svgFile = path.join(outputDir, `${base}.svg`);
    // DXF uses Y up; SVG uses Y down. Keep the preview visually equivalent.
    const previewPoint = (p: Point): Point => ({
        x: p.x,
        y: named ? -p.y : options.height - p.y,
    });
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
        dxfFile,
        dxf(segments, shapes, labels, named ? annotations : undefined, artwork),
    );
    fs.writeFileSync(
        svgFile,
        svg(
            segments.map((s) => ({
                start: previewPoint(s.start),
                end: previewPoint(s.end),
            })),
            shapes.map((s) =>
                s.type === 'circle'
                    ? { ...s, center: previewPoint(s.center) }
                    : { ...s, points: s.points.map(previewPoint) },
            ),
            labels.map((l) => ({
                ...l,
                at: previewPoint(l.at),
                rotation: -l.rotation,
            })),
            named
                ? {
                      segments: annotations.segments.map((s) => ({
                          start: previewPoint(s.start),
                          end: previewPoint(s.end),
                      })),
                      labels: annotations.labels.map((l) => ({
                          ...l,
                          at: previewPoint(l.at),
                      })),
                  }
                : undefined,
            artwork,
        ),
    );
    return {
        pcbFile,
        dxfFile,
        svgFile,
        outlineSegments: 4,
        cutouts: shapes.length,
        labels: labels.length,
        edge: options.edge,
        components: [...options.components],
        annotations: annotations.segments.length + annotations.labels.length,
        drawings: artwork.length,
    };
}
