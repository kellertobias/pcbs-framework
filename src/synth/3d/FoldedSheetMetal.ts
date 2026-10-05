import type { Kicad3DModel } from './Kicad3DModel';

/** Constant-gauge U channel swept along X, with explicit inner/outer bend radii.
 * Dimensions are outer dimensions. baseZ is the outside face of the web;
 * direction +1 folds up and -1 folds down. All dimensions are millimetres.
 */
export function foldedChannel(
    model: Kicad3DModel,
    p: {
        length: number;
        width: number;
        depth: number;
        thickness: number;
        bendRadius: number;
        x?: number;
        baseZ: number;
        direction: 1 | -1;
    },
) {
    const { length, width, depth, thickness: t, bendRadius: r } = p;
    if (!(length > 0 && width > 2 * r && depth > r && t > 0 && r > t))
        throw new Error('Invalid folded channel dimensions');
    const half = width / 2,
        points: number[][] = [
            [-half, depth],
            [-half, r],
        ];
    const arc = (cy: number, cz: number, radius: number, start: number, end: number) => {
        for (let i = 1; i <= 12; i++) {
            const a = start + ((end - start) * i) / 12;
            points.push([cy + radius * Math.cos(a), cz + radius * Math.sin(a)]);
        }
    };
    arc(-half + r, r, r, Math.PI, 1.5 * Math.PI);
    points.push([half - r, 0]);
    arc(half - r, r, r, -Math.PI / 2, 0);
    points.push([half, depth], [half - t, depth], [half - t, r]);
    arc(half - r, r, r - t, 0, -Math.PI / 2);
    points.push([-half + r, t]);
    arc(-half + r, r, r - t, 1.5 * Math.PI, Math.PI);
    points.push([-half + t, depth]);
    return model.loft({
        sections: [-length / 2, length / 2].map((x) =>
            points.map(([y, z]) => ({ x: x + (p.x ?? 0), y, z: p.baseZ + p.direction * z })),
        ),
        ruled: true,
    });
}
