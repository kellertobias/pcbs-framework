/**
 * CSG boolean operations on TopoDS_Shape objects.
 */
import type { OC } from "./types";

/** Fuse (union) two shapes. Returns a new shape. */
export function fuseShapes(oc: OC, a: any, b: any): any {
    const op = new (oc as any).BRepAlgoAPI_Fuse_3(a, b);
    (op as any).Build();
    const result = (op as any).Shape();
    op.delete();
    return result;
}

/** Cut shape `b` from shape `a`. Returns a new shape. */
export function cutShapes(oc: OC, a: any, b: any): any {
    const op = new (oc as any).BRepAlgoAPI_Cut_3(a, b);
    (op as any).Build();
    const result = (op as any).Shape();
    op.delete();
    return result;
}

/** Intersect two shapes. Returns their common volume. */
export function intersectShapes(oc: OC, a: any, b: any): any {
    const op = new (oc as any).BRepAlgoAPI_Common_3(a, b);
    (op as any).Build();
    const result = (op as any).Shape();
    op.delete();
    return result;
}
