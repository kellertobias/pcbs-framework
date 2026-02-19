/**
 * 3D Model Generation Pipeline — public API surface.
 */
export { Kicad3DModel, SolidBuilder, type Kicad3DModelOptions } from "./Kicad3DModel";
export { initOCC } from "./occ";
export type {
    OC,
    Vec3,
    ColorRGBA,
    SolidHandle,
    ExportOptions,
    ExportResult,
    Model3DLink,
} from "./types";
export { parseHexColor } from "./types";
