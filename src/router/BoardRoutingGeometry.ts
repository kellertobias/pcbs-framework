import { normalizeBoardNets } from '../kicad/KicadNetFormat';
import { SExpr, SExpressionParser } from '../kicad/SExpressionParser';
import { PcbPoint } from '../synth/types';
export type CopperLayer = 'F.Cu' | 'B.Cu';
export interface CopperObstacle {
    center: PcbPoint;
    width: number;
    height: number;
    layers: CopperLayer[];
    net?: string;
}
export interface BoardTerminal {
    ref: string;
    pad: string;
    net?: string;
    at: PcbPoint;
    layers: CopperLayer[];
}
type Node = SExpr[];
export const children = (node: Node, key: string): Node[] =>
    node.filter((value): value is Node => Array.isArray(value) && value[0] === key);
export const child = (node: Node, key: string) => children(node, key)[0];
export const atom = (node: Node | undefined, index: number) =>
    typeof node?.[index] === 'string' ? SExpressionParser.unquote(node[index] as string) : '';
const point = (node: Node | undefined): PcbPoint => ({
    x: Number(atom(node, 1)),
    y: Number(atom(node, 2)),
});
const layersOf = (node: Node): CopperLayer[] => {
    const layers = child(node, 'layers')
        ?.slice(1)
        .map((value) => (typeof value === 'string' ? SExpressionParser.unquote(value) : '')) ?? [
        atom(child(node, 'layer'), 1),
    ];
    return layers.includes('*.Cu') || layers.includes('F&B.Cu')
        ? ['F.Cu', 'B.Cu']
        : layers.filter((layer): layer is CopperLayer => layer === 'F.Cu' || layer === 'B.Cu');
};
export function rectObstacle(
    points: PcbPoint[],
    padding: number,
    layers: CopperLayer[],
    net?: string,
): CopperObstacle {
    const minX = Math.min(...points.map((p) => p.x)),
        maxX = Math.max(...points.map((p) => p.x)),
        minY = Math.min(...points.map((p) => p.y)),
        maxY = Math.max(...points.map((p) => p.y));
    return {
        center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        width: maxX - minX + 2 * padding,
        height: maxY - minY + 2 * padding,
        layers,
        net,
    };
}
export function boardRoutingGeometry(source: string, replacing: ReadonlySet<string>) {
    const board = SExpressionParser.parse(source).find(
        (value): value is Node => Array.isArray(value) && value[0] === 'kicad_pcb',
    );
    if (!board) throw new Error('Invalid KiCad PCB document.');
    normalizeBoardNets(board);
    const names = new Map(children(board, 'net').map((net) => [atom(net, 1), atom(net, 2)]));
    const obstacles: CopperObstacle[] = [],
        terminals: BoardTerminal[] = [];
    for (const footprint of children(board, 'footprint')) {
        const at = point(child(footprint, 'at')),
            angle = (-Number(atom(child(footprint, 'at'), 3) || 0) * Math.PI) / 180;
        const ref = atom(
            children(footprint, 'property').find((p) => atom(p, 1) === 'Reference'),
            2,
        );
        for (const pad of children(footprint, 'pad')) {
            const local = point(child(pad, 'at'));
            // Back-side geometry is already mirrored in board files.
            const center = {
                x: at.x + local.x * Math.cos(angle) - local.y * Math.sin(angle),
                y: at.y + local.x * Math.sin(angle) + local.y * Math.cos(angle),
            };
            const net = names.get(atom(child(pad, 'net'), 1)) || undefined;
            const layers = layersOf(pad),
                size = point(child(pad, 'size'));
            const padAngle = (Number(atom(child(pad, 'at'), 3) || 0) * Math.PI) / 180;
            const width =
                Math.abs(size.x * Math.cos(padAngle)) + Math.abs(size.y * Math.sin(padAngle));
            const height =
                Math.abs(size.x * Math.sin(padAngle)) + Math.abs(size.y * Math.cos(padAngle));
            obstacles.push({ center, width, height, layers, net });
            if (net && atom(pad, 1))
                terminals.push({ ref, pad: atom(pad, 1), net, at: center, layers });
        }
    }
    for (const kind of ['segment', 'via', 'arc'])
        for (const item of children(board, kind)) {
            const net = names.get(atom(child(item, 'net'), 1));
            if (net && replacing.has(net)) continue;
            const layers = layersOf(item);
            if (kind === 'via') {
                const diameter = Number(atom(child(item, 'size'), 1));
                obstacles.push({
                    center: point(child(item, 'at')),
                    width: diameter,
                    height: diameter,
                    layers,
                    net,
                });
            } else if (kind === 'segment') {
                const a = point(child(item, 'start')),
                    b = point(child(item, 'end')),
                    width = Number(atom(child(item, 'width'), 1));
                // Small conservative rectangles approximate diagonal copper, including its round ends.
                const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1));
                for (let i = 0; i < count; i++)
                    obstacles.push(
                        rectObstacle(
                            [0, 1].map((t) => ({
                                x: a.x + ((b.x - a.x) * (i + t)) / count,
                                y: a.y + ((b.y - a.y) * (i + t)) / count,
                            })),
                            width / 2,
                            layers,
                            net,
                        ),
                    );
            } else {
                const a = point(child(item, 'start')),
                    m = point(child(item, 'mid')),
                    b = point(child(item, 'end'));
                const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
                if (Math.abs(d) < 1e-9)
                    throw new Error('Cannot route around malformed existing copper arc.');
                const aa = a.x * a.x + a.y * a.y,
                    mm = m.x * m.x + m.y * m.y,
                    bb = b.x * b.x + b.y * b.y;
                const center = {
                    x: (aa * (m.y - b.y) + mm * (b.y - a.y) + bb * (a.y - m.y)) / d,
                    y: (aa * (b.x - m.x) + mm * (a.x - b.x) + bb * (m.x - a.x)) / d,
                };
                const diameter =
                    2 * Math.hypot(a.x - center.x, a.y - center.y) +
                    Number(atom(child(item, 'width'), 1));
                obstacles.push({ center, width: diameter, height: diameter, layers, net });
            }
        }
    for (const zone of children(board, 'zone')) {
        const keepout = child(zone, 'keepout');
        if (
            !keepout ||
            (atom(child(keepout, 'tracks'), 1) === 'allowed' &&
                atom(child(keepout, 'vias'), 1) === 'allowed')
        )
            continue;
        const polygon = child(zone, 'polygon'),
            pts = polygon && child(polygon, 'pts');
        if (pts) obstacles.push(rectObstacle(children(pts, 'xy').map(point), 0, layersOf(zone)));
    }
    const edges = children(board, 'gr_line')
        .filter((line) => atom(child(line, 'layer'), 1) === 'Edge.Cuts')
        .map((line) => [point(child(line, 'start')), point(child(line, 'end'))]);
    for (const arc of children(board, 'gr_arc').filter(
        (item) => atom(child(item, 'layer'), 1) === 'Edge.Cuts',
    )) {
        const a = point(child(arc, 'start')),
            m = point(child(arc, 'mid')),
            b = point(child(arc, 'end'));
        const determinant = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
        if (Math.abs(determinant) < 1e-9) throw new Error('Invalid Edge.Cuts arc.');
        const aa = a.x * a.x + a.y * a.y,
            mm = m.x * m.x + m.y * m.y,
            bb = b.x * b.x + b.y * b.y;
        const cx = (aa * (m.y - b.y) + mm * (b.y - a.y) + bb * (a.y - m.y)) / determinant;
        const cy = (aa * (b.x - m.x) + mm * (a.x - b.x) + bb * (m.x - a.x)) / determinant;
        const radius = Math.hypot(a.x - cx, a.y - cy),
            start = Math.atan2(a.y - cy, a.x - cx);
        const positive = (angle: number) => (angle + 2 * Math.PI) % (2 * Math.PI);
        const sweep = positive(Math.atan2(b.y - cy, b.x - cx) - start);
        const delta =
            positive(Math.atan2(m.y - cy, m.x - cx) - start) <= sweep ? sweep : sweep - 2 * Math.PI;
        const count = Math.max(2, Math.ceil((Math.abs(delta) * radius) / 0.2));
        if (count > 10000) throw new Error('Board arc exceeds the routing geometry budget.');
        let previous = a;
        for (let i = 1; i <= count; i++) {
            const next =
                i === count
                    ? b
                    : {
                          x: cx + radius * Math.cos(start + (delta * i) / count),
                          y: cy + radius * Math.sin(start + (delta * i) / count),
                      };
            edges.push([previous, next]);
            previous = next;
        }
    }
    for (const circle of children(board, 'gr_circle').filter(
        (item) => atom(child(item, 'layer'), 1) === 'Edge.Cuts',
    )) {
        const center = point(child(circle, 'center')),
            end = point(child(circle, 'end')),
            radius = Math.hypot(end.x - center.x, end.y - center.y);
        const count = Math.max(16, Math.ceil((2 * Math.PI * radius) / 0.2));
        if (!radius || count > 10000) throw new Error('Invalid or oversized board circle.');
        for (let i = 0; i < count; i++)
            edges.push(
                [i, (i + 1) % count].map((index) => ({
                    x: center.x + radius * Math.cos((index * 2 * Math.PI) / count),
                    y: center.y + radius * Math.sin((index * 2 * Math.PI) / count),
                })),
            );
    }
    const contours: PcbPoint[][] = [];
    for (const rect of children(board, 'gr_rect').filter(
        (item) => atom(child(item, 'layer'), 1) === 'Edge.Cuts',
    )) {
        const a = point(child(rect, 'start')),
            b = point(child(rect, 'end'));
        contours.push([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]);
    }
    const same = (a: PcbPoint, b: PcbPoint) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-5;
    while (edges.length) {
        const edge = edges.shift()!,
            contour = [...edge];
        while (!same(contour[0], contour[contour.length - 1])) {
            const end = contour[contour.length - 1],
                index = edges.findIndex((e) => same(e[0], end) || same(e[1], end));
            if (index < 0) throw new Error('PCB autorouting requires closed Edge.Cuts contours.');
            const next = edges.splice(index, 1)[0];
            contour.push(same(next[0], end) ? next[1] : next[0]);
        }
        contours.push(contour.slice(0, -1));
    }
    if (!contours.length) throw new Error('PCB autorouting requires a board outline.');
    const points = contours.flat();
    return {
        obstacles,
        terminals,
        contours,
        bounds: {
            minX: Math.min(...points.map((p) => p.x)),
            maxX: Math.max(...points.map((p) => p.x)),
            minY: Math.min(...points.map((p) => p.y)),
            maxY: Math.max(...points.map((p) => p.y)),
        },
    };
}
export function inPolygon(point: PcbPoint, polygon: PcbPoint[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i],
            b = polygon[j];
        if (
            a.y > point.y !== b.y > point.y &&
            point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
        )
            inside = !inside;
    }
    return inside;
}
/** Split at every polygon boundary and check interval midpoints, not just route vertices. */
export function segmentInRegions(
    a: PcbPoint,
    b: PcbPoint,
    polygons: PcbPoint[][],
    allowed: (p: PcbPoint) => boolean,
): boolean {
    const cuts = [0, 1],
        dx = b.x - a.x,
        dy = b.y - a.y;
    for (const polygon of polygons)
        for (let i = 0; i < polygon.length; i++) {
            const c = polygon[i],
                d = polygon[(i + 1) % polygon.length],
                ex = d.x - c.x,
                ey = d.y - c.y,
                den = dx * ey - dy * ex;
            if (Math.abs(den) < 1e-12) continue;
            const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / den,
                u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / den;
            if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
        }
    cuts.sort((x, y) => x - y);
    return cuts
        .slice(1)
        .every((t, i) =>
            allowed({ x: a.x + (dx * (t + cuts[i])) / 2, y: a.y + (dy * (t + cuts[i])) / 2 }),
        );
}
export function segmentDistance(a: PcbPoint, b: PcbPoint, c: PcbPoint, d: PcbPoint): number {
    const cross = (p: PcbPoint, q: PcbPoint, r: PcbPoint) =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const pointDistance = (p: PcbPoint, x: PcbPoint, y: PcbPoint) => {
        const dx = y.x - x.x,
            dy = y.y - x.y,
            length = dx * dx + dy * dy;
        const t = length
            ? Math.max(0, Math.min(1, ((p.x - x.x) * dx + (p.y - x.y) * dy) / length))
            : 0;
        return Math.hypot(p.x - x.x - t * dx, p.y - x.y - t * dy);
    };
    if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
    return Math.min(
        pointDistance(a, c, d),
        pointDistance(b, c, d),
        pointDistance(c, a, b),
        pointDistance(d, a, b),
    );
}
