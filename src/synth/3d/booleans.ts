/**
 * CSG boolean operations on TopoDS_Shape objects.
 */
import type { OC } from "./types";

/** Fuse (union) two shapes. Returns a new shape. */
export function fuseShapes(oc: OC, a: any, b: any): any {
    const pr = new oc.Message_ProgressRange_1();
    const op = new oc.BRepAlgoAPI_Fuse_3(a, b, pr);
    op.Build(pr);
    const result = op.Shape();
    op.delete();
    pr.delete();
    return result;
}

/** Cut shape `b` from shape `a`. Returns a new shape. */
export function cutShapes(oc: OC, a: any, b: any): any {
    const pr = new oc.Message_ProgressRange_1();
    const op = new oc.BRepAlgoAPI_Cut_3(a, b, pr);
    op.Build(pr);
    const result = op.Shape();
    op.delete();
    pr.delete();
    return result;
}

/** Intersect two shapes. Returns their common volume. */
export function intersectShapes(oc: OC, a: any, b: any): any {
    const pr = new oc.Message_ProgressRange_1();
    const op = new oc.BRepAlgoAPI_Common_3(a, b, pr);
    op.Build(pr);
    const result = op.Shape();
    op.delete();
    pr.delete();
    return result;
}
