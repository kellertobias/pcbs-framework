import { ShapeUtils, Vector2 } from '../../runtime/three.mjs';
import type { TriangleMesh } from './types';
export interface BentSheetOptions {
    xMin: number;
    xMax: number;
    /** YZ centreline intersections; corners receive tangent circular bends. */
    path: [number, number][];
    thickness: number;
    insideRadius: number;
}
export function bentSheetProfile(p: BentSheetOptions): {
    polygon: [number, number][];
    centrelineLength: number;
    bends: number[];
} {
    const t = p.thickness,
        radius = p.insideRadius + t / 2;
    if (
        !(
            [p.xMin, p.xMax, t, p.insideRadius].every(Number.isFinite) &&
            p.xMax > p.xMin &&
            t > 0 &&
            p.insideRadius > 0
        ) ||
        p.path.length < 2 ||
        p.path.some((v) => v.length !== 2 || !v.every(Number.isFinite))
    )
        throw new Error('Invalid bent sheet dimensions');
    const left: [number, number][] = [],
        right: [number, number][] = [],
        bends: number[] = [];
    const unit = (a: number[], b: number[]) => {
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < 1e-9) throw new Error('Bent sheet has a zero length segment');
        return [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as [number, number];
    };
    const push = (y: number, z: number, dy: number, dz: number) => {
        left.push([y - (dz * t) / 2, z + (dy * t) / 2]);
        right.push([y + (dz * t) / 2, z - (dy * t) / 2]);
    };
    let previous = p.path[0];
    const first = unit(p.path[0], p.path[1]);
    push(...p.path[0], ...first);
    let centrelineLength = 0;
    for (let i = 1; i < p.path.length - 1; i++) {
        const corner = p.path[i],
            incoming = unit(p.path[i - 1], corner),
            outgoing = unit(corner, p.path[i + 1]);
        const turn = Math.atan2(
            incoming[0] * outgoing[1] - incoming[1] * outgoing[0],
            incoming[0] * outgoing[0] + incoming[1] * outgoing[1],
        );
        if (Math.abs(turn) < 1e-9) continue;
        if (Math.abs(turn) > Math.PI - 1e-6) throw new Error('Bent sheet cannot reverse direction');
        const distance = radius * Math.tan(Math.abs(turn) / 2);
        const start: [number, number] = [
            corner[0] - incoming[0] * distance,
            corner[1] - incoming[1] * distance,
        ];
        const end: [number, number] = [
            corner[0] + outgoing[0] * distance,
            corner[1] + outgoing[1] * distance,
        ];
        if (
            (start[0] - previous[0]) * incoming[0] + (start[1] - previous[1]) * incoming[1] <
                -1e-7 ||
            distance > Math.hypot(p.path[i + 1][0] - corner[0], p.path[i + 1][1] - corner[1]) + 1e-7
        )
            throw new Error('Sheet segments are too short for the bend radius');
        centrelineLength +=
            Math.hypot(start[0] - previous[0], start[1] - previous[1]) + radius * Math.abs(turn);
        bends.push(Math.abs(turn));
        const sign = Math.sign(turn),
            cy = start[0] - incoming[1] * radius * sign,
            cz = start[1] + incoming[0] * radius * sign;
        const startAngle = Math.atan2(start[1] - cz, start[0] - cy);
        const count = Math.max(
            2,
            Math.ceil(Math.abs(turn) / (2 * Math.acos(1 - 0.01 / (radius + t / 2)))),
        );
        for (let j = 0; j <= count; j++) {
            const a = startAngle + (turn * j) / count;
            push(
                cy + radius * Math.cos(a),
                cz + radius * Math.sin(a),
                -Math.sin(a) * sign,
                Math.cos(a) * sign,
            );
        }
        previous = end;
    }
    const last = p.path[p.path.length - 1],
        direction = unit(p.path[p.path.length - 2], last);
    centrelineLength += Math.hypot(last[0] - previous[0], last[1] - previous[1]);
    push(...last, ...direction);
    const polygon = [...left, ...right.reverse()].filter(
        (v, i, a) => i === 0 || Math.hypot(v[0] - a[i - 1][0], v[1] - a[i - 1][1]) > 1e-8,
    );
    return { polygon, centrelineLength, bends };
}
export function bentSheetMesh(p: BentSheetOptions): TriangleMesh {
    const { polygon } = bentSheetProfile(p),
        n = polygon.length;
    const cap = ShapeUtils.triangulateShape(
        polygon.map(([y, z]) => new Vector2(y, z)),
        [],
    );
    const vertices = [p.xMin, p.xMax].flatMap((x) => polygon.map(([y, z]) => ({ x, y, z })));
    const triangles: [number, number, number][] = [];
    // Normalize profile orientation so all face normals point outwards.
    const ccw = !ShapeUtils.isClockWise(polygon.map(([y, z]) => new Vector2(y, z)));
    for (const [a, b, c] of cap) {
        triangles.push([c, b, a], [a + n, b + n, c + n]);
    }
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        triangles.push(
            ccw ? [i, j, j + n] : [j, i, i + n],
            ccw ? [i, j + n, i + n] : [j, i + n, j + n],
        );
    }
    return { vertices, triangles };
}
