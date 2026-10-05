import type {
    FrontPanelDrawing,
    FrontPanelDrawingAnchor,
    FrontPanelDrawingGroup,
    FrontPanelLayer,
    FrontPanelPoint,
} from './types';
import {
    identity,
    multiply,
    rotationMatrix,
    transformPoint,
    importSvgContours,
    type Matrix,
} from './SvgArtwork';
export type ArtworkEntity = { layer: FrontPanelLayer; strokeWidth: number } & (
    | { type: 'line'; start: FrontPanelPoint; end: FrontPanelPoint }
    | { type: 'circle'; center: FrontPanelPoint; radius: number }
    | {
          type: 'arc';
          center: FrontPanelPoint;
          radius: number;
          startAngle: number;
          endAngle: number;
      }
    | { type: 'polyline'; points: FrontPanelPoint[]; closed: boolean }
    | {
          type: 'text';
          at: FrontPanelPoint;
          text: string;
          fontSize: number;
          bold?: boolean;
          rotation: number;
      }
);
const finite = (n: number) => {
    if (!Number.isFinite(n)) throw new Error('Artwork coordinates must be finite');
    return n;
};
const positive = (n: number) => {
    finite(n);
    if (n <= 0) throw new Error('Artwork sizes must be positive');
    return n;
};
export function compileArtwork(
    drawings: readonly FrontPanelDrawing[],
    resolve: (anchor: FrontPanelDrawingAnchor) => FrontPanelPoint,
): ArtworkEntity[] {
    const result: ArtworkEntity[] = [];
    function visit(
        items: readonly FrontPanelDrawing[],
        matrix: Matrix,
        layer: FrontPanelLayer,
        stroke: number,
    ): void {
        for (const d of items) {
            const style = {
                layer: d.layer ?? layer,
                strokeWidth: positive(d.strokeWidth ?? stroke),
            };
            if (!['OUTLINE', 'ENGRAVING', 'CUTOUT', 'ANNOTATIONS'].includes(style.layer))
                throw new Error('Unknown artwork layer');
            const point = (p: FrontPanelPoint) =>
                transformPoint(matrix, { x: finite(p.x), y: finite(p.y) });
            const scale = Math.hypot(matrix[0], matrix[1]);
            const angle = (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI;
            if (d.type === 'group') {
                if (d.anchor && d.at) throw new Error('Drawing groups use either at or anchor');
                const at = d.anchor ? resolve(d.anchor) : (d.at ?? { x: 0, y: 0 });
                const size = positive(d.scale ?? 1);
                const local = multiply(
                    [size, 0, 0, size, finite(at.x), finite(at.y)],
                    rotationMatrix(finite(d.rotation ?? 0)),
                );
                visit(d.drawings, multiply(matrix, local), style.layer, style.strokeWidth);
            } else if (d.type === 'svg') {
                const at = { x: finite(d.at.x), y: finite(d.at.y) };
                const local = multiply(
                    matrix,
                    multiply([1, 0, 0, 1, at.x, at.y], rotationMatrix(finite(d.rotation ?? 0))),
                );
                for (const contour of importSvgContours(
                    d.file,
                    positive(d.width),
                    d.height === undefined ? undefined : positive(d.height),
                    local,
                    positive(d.tolerance ?? 0.02),
                ))
                    result.push({ ...style, type: 'polyline', ...contour });
            } else if (d.type === 'line')
                result.push({
                    ...style,
                    type: 'line',
                    start: point(d.start),
                    end: point(d.end),
                });
            else if (d.type === 'circle')
                result.push({
                    ...style,
                    type: 'circle',
                    center: point(d.center),
                    radius: positive(d.radius) * scale,
                });
            else if (d.type === 'arc') {
                const startAngle = finite(d.startAngle) + angle,
                    endAngle = finite(d.endAngle) + angle;
                if (
                    Math.abs(endAngle - startAngle) < 1e-9 ||
                    Math.abs(endAngle - startAngle) >= 360
                )
                    throw new Error(
                        'Arc angles must describe a nonzero sweep smaller than 360 degrees',
                    );
                result.push({
                    ...style,
                    type: 'arc',
                    center: point(d.center),
                    radius: positive(d.radius) * scale,
                    startAngle,
                    endAngle,
                });
            } else if (d.type === 'polyline') {
                if (d.points.length < (d.closed ? 3 : 2))
                    throw new Error('Artwork polyline has too few points');
                result.push({
                    ...style,
                    type: 'polyline',
                    points: d.points.map(point),
                    closed: d.closed ?? false,
                });
            } else if (d.type === 'text') {
                if (d.bold !== undefined && typeof d.bold !== 'boolean')
                    throw new Error('Text bold must be a boolean');
                if (typeof d.text !== 'string' || /[\r\n]/.test(d.text))
                    throw new Error('Artwork text must be single-line');
                result.push({
                    ...style,
                    type: 'text',
                    at: point(d.at),
                    text: d.text,
                    fontSize: positive(d.fontSize) * scale,
                    bold: d.bold,
                    rotation: finite(d.rotation ?? 0) + angle,
                });
            } else throw new Error('Unsupported artwork drawing');
        }
    }
    visit(drawings, identity, 'ENGRAVING', 0.2);
    return result;
}
export function artworkPoints(e: ArtworkEntity): FrontPanelPoint[] {
    if (e.type === 'line') return [e.start, e.end];
    if (e.type === 'polyline') return e.points;
    if (e.type === 'text') {
        const matrix = multiply([1, 0, 0, 1, e.at.x, e.at.y], rotationMatrix(e.rotation));
        return [-1, 1].flatMap((x) =>
            [-1, 1].map((y) =>
                transformPoint(matrix, {
                    x: x * e.text.length * e.fontSize * 0.4,
                    y: (y * e.fontSize) / 2,
                }),
            ),
        );
    }
    if (e.type === 'circle')
        return [
            { x: e.center.x - e.radius, y: e.center.y - e.radius },
            { x: e.center.x + e.radius, y: e.center.y + e.radius },
        ];
    const norm = (n: number) => ((n % 360) + 360) % 360;
    const sweep = norm(e.endAngle - e.startAngle);
    const angles = [
        e.startAngle,
        e.endAngle,
        ...[0, 90, 180, 270].filter((a) => norm(a - e.startAngle) <= sweep),
    ];
    return angles.map((a) => ({
        x: e.center.x + e.radius * Math.cos((a * Math.PI) / 180),
        y: e.center.y + e.radius * Math.sin((a * Math.PI) / 180),
    }));
}
/** Standard barrel-jack centre/sleeve polarity mark, 12 mm wide by default. */
export function barrelPolaritySymbol(options: {
    polarity: 'center-positive' | 'center-negative';
    at?: FrontPanelPoint;
    anchor?: FrontPanelDrawingAnchor;
    size?: number;
    rotation?: number;
    layer?: FrontPanelLayer;
}): FrontPanelDrawingGroup {
    const plusX = options.polarity === 'center-positive' ? 5 : -5;
    return {
        type: 'group',
        at: options.at,
        anchor: options.anchor,
        scale: (options.size ?? 12) / 12,
        rotation: options.rotation,
        layer: options.layer,
        drawings: [
            { type: 'circle', center: { x: -5, y: 0 }, radius: 1 },
            { type: 'circle', center: { x: 5, y: 0 }, radius: 1 },
            {
                type: 'arc',
                center: { x: 0, y: 0 },
                radius: 1.6,
                startAngle: 50,
                endAngle: 310,
            },
            { type: 'circle', center: { x: 0, y: 0 }, radius: 0.22 },
            { type: 'line', start: { x: -4, y: 0 }, end: { x: -1.6, y: 0 } },
            { type: 'line', start: { x: 0.22, y: 0 }, end: { x: 4, y: 0 } },
            { type: 'line', start: { x: -5.45, y: 0 }, end: { x: -4.55, y: 0 } },
            { type: 'line', start: { x: 4.55, y: 0 }, end: { x: 5.45, y: 0 } },
            {
                type: 'line',
                start: { x: plusX, y: -0.45 },
                end: { x: plusX, y: 0.45 },
            },
        ],
    };
}
