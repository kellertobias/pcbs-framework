/**
 * Primitive solid constructors (all dimensions in mm).
 *
 * Each function returns a TopoDS_Shape ready for boolean ops / transforms.
 */
import type { OC } from "./types";

export interface BoxOptions {
    x: number;
    y: number;
    z: number;
    /** If true, center the box on the origin (default false → corner at origin) */
    center?: boolean;
}

export interface SphereOptions {
    r: number;
    /** Ignored — sphere is always centered at origin. Provided for API symmetry. */
    center?: boolean;
}

export interface CylinderOptions {
    r: number;
    h: number;
    /** If true, center the cylinder on the origin (default false → base at Z=0) */
    center?: boolean;
}

/**
 * Create a box. When `center` is true the box is centered on the origin,
 * otherwise corner 0 sits at the origin.
 */
export function makeBox(oc: OC, opts: BoxOptions): any {
    const { x, y, z, center } = opts;

    let maker: any;
    if (center) {
        const corner = new oc.gp_Pnt_3(-x / 2, -y / 2, -z / 2);
        maker = new oc.BRepPrimAPI_MakeBox_3(corner, x, y, z);
        corner.delete();
    } else {
        maker = new oc.BRepPrimAPI_MakeBox_2(x, y, z);
    }

    const shape = (maker as any).Shape();
    maker.delete();
    return shape;
}

/**
 * Create a sphere centered at the origin.
 */
export function makeSphere(oc: OC, opts: SphereOptions): any {
    const maker = new oc.BRepPrimAPI_MakeSphere_1(opts.r);
    const shape = (maker as any).Shape();
    maker.delete();
    return shape;
}

/**
 * Create a cylinder. When `center` is true the cylinder's midpoint
 * is at the origin; otherwise the base sits at Z = 0.
 */
export function makeCylinder(oc: OC, opts: CylinderOptions): any {
    const { r, h, center } = opts;
    const maker = new oc.BRepPrimAPI_MakeCylinder_1(r, h);
    let shape = (maker as any).Shape();
    maker.delete();

    if (center) {
        // Shift down by h/2
        const trsf = new oc.gp_Trsf_1();
        const vec = new oc.gp_Vec_4(0, 0, -h / 2);
        trsf.SetTranslation_1(vec);
        const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
        const moved = transformer.Shape();
        transformer.delete();
        trsf.delete();
        vec.delete();
        shape.delete();
        shape = moved;
    }

    return shape;
}
