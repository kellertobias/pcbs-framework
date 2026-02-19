/**
 * Geometric transforms applied to TopoDS_Shape objects.
 * All angles are in degrees. All distances are in mm.
 */
import type { OC, Vec3 } from "./types";

const DEG_TO_RAD = Math.PI / 180;

/** Translate a shape by (x, y, z). Returns a new shape. */
export function translateShape(oc: OC, shape: any, v: Vec3): any {
    const trsf = new oc.gp_Trsf_1();
    const vec = new oc.gp_Vec_4(v.x, v.y, v.z);
    trsf.SetTranslation_1(vec);
    const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
    const result = transformer.Shape();
    transformer.delete();
    trsf.delete();
    vec.delete();
    return result;
}

/**
 * Rotate a shape around X, Y, Z axes (applied in that order).
 * Angles are in degrees.
 */
export function rotateShape(oc: OC, shape: any, angles: Vec3): any {
    let current = shape;

    const axes = [
        { dir: [1, 0, 0], angle: angles.x },
        { dir: [0, 1, 0], angle: angles.y },
        { dir: [0, 0, 1], angle: angles.z },
    ];

    for (const { dir, angle } of axes) {
        if (Math.abs(angle) < 1e-9) continue;

        const origin = new oc.gp_Pnt_3(0, 0, 0);
        const direction = new oc.gp_Dir_4(dir[0], dir[1], dir[2]);
        const axis = new oc.gp_Ax1_2(origin, direction);

        const trsf = new oc.gp_Trsf_1();
        trsf.SetRotation_1(axis, angle * DEG_TO_RAD);

        const transformer = new oc.BRepBuilderAPI_Transform_2(current, trsf, true);
        const next = transformer.Shape();
        transformer.delete();
        trsf.delete();
        axis.delete();
        direction.delete();
        origin.delete();

        if (current !== shape) current.delete();
        current = next;
    }

    return current;
}

/**
 * Uniform or per-axis scale. Returns a new shape.
 * Note: OCC gp_Trsf only supports uniform scale directly.
 * For non-uniform, we use SetValues on the matrix.
 */
export function scaleShape(oc: OC, shape: any, s: Vec3): any {
    const trsf = new oc.gp_Trsf_1();
    if (Math.abs(s.x - s.y) < 1e-9 && Math.abs(s.y - s.z) < 1e-9) {
        // Uniform scale
        const origin = new oc.gp_Pnt_3(0, 0, 0);
        trsf.SetScale(origin, s.x);
        origin.delete();
    } else {
        // Non-uniform scale via affine matrix
        trsf.SetValues(
            s.x, 0, 0, 0,
            0, s.y, 0, 0,
            0, 0, s.z, 0,
        );
    }

    const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
    const result = transformer.Shape();
    transformer.delete();
    trsf.delete();
    return result;
}
