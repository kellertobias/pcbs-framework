/**
 * Shared types for the 3D model generation pipeline.
 * All dimensions are in millimeters.
 */

import type { initOpenCascade } from "opencascade.js";
export type OpenCascadeInstance = Awaited<ReturnType<typeof initOpenCascade>>;

// Re-export for convenience
export type OC = OpenCascadeInstance;

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export interface ColorRGBA {
    /** Red 0–1 */
    r: number;
    /** Green 0–1 */
    g: number;
    /** Blue 0–1 */
    b: number;
    /** Alpha 0–1 (default 1) */
    a?: number;
}

/**
 * Wraps an OpenCascade TopoDS_Shape with color and name metadata.
 */
export interface SolidHandle {
    shape: any; // TopoDS_Shape
    color?: ColorRGBA;
    name?: string;
}

export interface ExportOptions {
    /** Output directory for generated files */
    outDir: string;
    /** Base filename without extension */
    baseName: string;
    /** Formats to export (default: ["wrl"]) */
    formats?: ("wrl" | "step")[];
}

export interface ExportResult {
    wrlPath?: string;
    stepPath?: string;
}

/** Options for the model link in the KiCad footprint */
export interface Model3DLink {
    /** Relative path to the 3D model file */
    path: string;
    offset?: Vec3;
    scale?: Vec3;
    rotate?: Vec3;
}

/**
 * Parse a hex color string (#RRGGBB or #RGB) to ColorRGBA.
 */
export function parseHexColor(hex: string): ColorRGBA {
    let h = hex.replace(/^#/, "");
    if (h.length === 3) {
        h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    const r = parseInt(h.substring(0, 2), 16) / 255;
    const g = parseInt(h.substring(2, 4), 16) / 255;
    const b = parseInt(h.substring(4, 6), 16) / 255;
    return { r, g, b, a: 1 };
}
