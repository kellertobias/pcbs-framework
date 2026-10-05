import type { Kicad3DModel } from './Kicad3DModel';

/** Rounded XY contour sampled with eight segments per quadrant.
 * The library loft joins matching contours into ONE continuous solid, rather
 * than stacking overlapping boxes. zTilt gives a sloping plane along Y.
 */
export function roundedContour(width: number, depth: number, radius: number, z: number, zTilt = 0) {
    if (width <= 0 || depth <= 0 || radius <= 0 || radius >= Math.min(width, depth) / 2)
        throw new Error('Invalid rounded contour dimensions');
    const points: { x: number; y: number; z: number }[] = [];
    for (let corner = 0; corner < 4; corner++) {
        const angle = (corner * Math.PI) / 2;
        const cx = (corner === 0 || corner === 3 ? 1 : -1) * (width / 2 - radius);
        const cy = (corner < 2 ? 1 : -1) * (depth / 2 - radius);
        for (let step = 0; step <= 8; step++) {
            const theta = angle + (step * Math.PI) / 16;
            const x = cx + radius * Math.cos(theta),
                y = cy + radius * Math.sin(theta);
            points.push({ x, y, z: z + y * zTilt });
        }
    }
    return points;
}

export type ProfilePoint = { x: number; y: number };
export type ProfileMap = (p: ProfilePoint, normal: number) => { x: number; y: number; z: number };
/** Common fabrication profiles are used for BOTH exported CAD and interference checks. */
export function profileSolid(
    m: Kicad3DModel,
    points: ProfilePoint[],
    map: ProfileMap,
    half: number,
) {
    return m.loft({
        sections: [-half, half].map((n) => points.map((p) => map(p, n))),
        ruled: true,
    });
}
export function capsulePoints(x: number, y: number, width: number, height: number) {
    const radius = width / 2,
        offset = (height - width) / 2;
    const points: ProfilePoint[] = [];
    for (const [angle, center] of [
        [0, y + offset],
        [Math.PI, y - offset],
    ])
        for (let i = 0; i <= 16; i++) {
            const a = angle + (Math.PI * i) / 16;
            points.push({ x: x + radius * Math.cos(a), y: center + radius * Math.sin(a) });
        }
    return points;
}
