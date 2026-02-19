/**
 * Edge filleting (rounding) via BRepFilletAPI_MakeFillet.
 */
import type { OC } from "./types";

/**
 * Apply a fillet of `radius` mm to all edges of the shape.
 * Returns a new shape with rounded edges.
 */
export function filletAllEdges(oc: OC, shape: any, radius: number): any {
    const mkFillet = new oc.BRepFilletAPI_MakeFillet(
        shape,
        oc.ChFi3d_FilletShape.ChFi3d_Rational as any,
    );

    // Iterate all edges in the shape
    const explorer = new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE as any,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any,
    );

    while (explorer.More()) {
        const edge = oc.TopoDS.Edge_1(explorer.Current());
        mkFillet.Add_2(radius, edge);
        explorer.Next();
    }
    explorer.delete();

    
    (mkFillet as any).Build();
    

    const result = (mkFillet as any).Shape();
    mkFillet.delete();
    return result;
}

/**
 * Apply a fillet of `radius` mm to specific edges (by index, 0-based).
 * Useful when you only want to round certain edges.
 */
export function filletEdgesByIndex(
    oc: OC,
    shape: any,
    edgeIndices: number[],
    radius: number,
): any {
    const mkFillet = new oc.BRepFilletAPI_MakeFillet(
        shape,
        oc.ChFi3d_FilletShape.ChFi3d_Rational as any,
    );

    const explorer = new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE as any,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any,
    );

    const indexSet = new Set(edgeIndices);
    let idx = 0;
    while (explorer.More()) {
        if (indexSet.has(idx)) {
            const edge = oc.TopoDS.Edge_1(explorer.Current());
            mkFillet.Add_2(radius, edge);
        }
        idx++;
        explorer.Next();
    }
    explorer.delete();

    
    (mkFillet as any).Build();
    

    const result = (mkFillet as any).Shape();
    mkFillet.delete();
    return result;
}
