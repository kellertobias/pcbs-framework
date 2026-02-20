/**
 * Kicad3DModel — High-level fluent API for building parametric 3D models.
 *
 * Usage:
 * ```ts
 * const model = new Kicad3DModel({ unit: "mm" });
 * const body = model.box({ x: 68.6, y: 53.4, z: 1.6, center: true }).color("#1f4fa3");
 * const usb = model.box({ x: 12, y: 16, z: 11, center: true })
 *   .translate({ x: 30, y: 0, z: 5.5 })
 *   .fillet({ radius: 1.0, edges: "all" })
 *   .color("#c0c0c0");
 * model.union(body, usb);
 * await model.export({ outDir: "./3d", baseName: "Arduino_Uno", formats: ["wrl"] });
 * ```
 */
import * as path from "path";
import { initOCC } from "./occ";
import { makeBox, makeSphere, makeCylinder, type BoxOptions, type SphereOptions, type CylinderOptions } from "./primitives";
import { translateShape, rotateShape, scaleShape } from "./transforms";
import { fuseShapes, cutShapes, intersectShapes } from "./booleans";
import { filletAllEdges, filletEdgesByIndex } from "./fillet";
import { writeVRML } from "./vrmlWriter";
import { writeSTEP } from "./stepWriter";
import type { OC, Vec3, ColorRGBA, SolidHandle, ExportOptions, ExportResult, Model3DLink } from "./types";
import { parseHexColor } from "./types";

// ── SolidBuilder ──────────────────────────────────────────────────────

/**
 * Fluent wrapper around a SolidHandle.
 * Returned by Kicad3DModel primitive constructors.
 */
export class SolidBuilder {
    /** @internal */
    _handle: SolidHandle;
    /** @internal */
    private _oc: OC;

    constructor(oc: OC, handle: SolidHandle) {
        this._oc = oc;
        this._handle = handle;
    }

    /** Translate the solid by (x, y, z) mm. */
    translate(v: Partial<Vec3>): this {
        const vec: Vec3 = { x: v.x ?? 0, y: v.y ?? 0, z: v.z ?? 0 };
        this._handle.shape = translateShape(this._oc, this._handle.shape, vec);
        return this;
    }

    /** Rotate the solid around X, Y, Z axes (degrees). */
    rotate(v: Partial<Vec3>): this {
        const angles: Vec3 = { x: v.x ?? 0, y: v.y ?? 0, z: v.z ?? 0 };
        this._handle.shape = rotateShape(this._oc, this._handle.shape, angles);
        return this;
    }

    /** Scale the solid (uniform or per-axis). */
    scale(s: number | Partial<Vec3>): this {
        const vec: Vec3 = typeof s === "number"
            ? { x: s, y: s, z: s }
            : { x: s.x ?? 1, y: s.y ?? 1, z: s.z ?? 1 };
        this._handle.shape = scaleShape(this._oc, this._handle.shape, vec);
        return this;
    }

    /** Apply a fillet to edges. */
    fillet(opts: { radius: number; edges?: "all" | number[] }): this {
        const edges = opts.edges ?? "all";
        if (edges === "all") {
            this._handle.shape = filletAllEdges(this._oc, this._handle.shape, opts.radius);
        } else {
            this._handle.shape = filletEdgesByIndex(this._oc, this._handle.shape, edges, opts.radius);
        }
        return this;
    }

    /** Set the solid color (hex string like "#c0c0c0" or ColorRGBA object). */
    color(c: string | ColorRGBA): this {
        this._handle.color = typeof c === "string" ? parseHexColor(c) : c;
        return this;
    }

    /** Set a name for this solid (used as comment in VRML). */
    name(n: string): this {
        this._handle.name = n;
        return this;
    }
}

// ── Kicad3DModel ──────────────────────────────────────────────────────

export interface Kicad3DModelOptions {
    /** Unit for all dimensions (currently only "mm" is supported). */
    unit?: "mm";
    /** Rotate the entire model around X axis (degrees). */
    rotX?: number;
    /** Rotate the entire model around Y axis (degrees). */
    rotY?: number;
    /** Rotate the entire model around Z axis (degrees). */
    rotZ?: number;
}

export class Kicad3DModel {
    private _oc: OC | null = null;
    private _solids: SolidHandle[] = [];
    private _options: Kicad3DModelOptions;
    private _rotation: Vec3;

    /** Metadata for linking into footprint (set after export). */
    public modelLink?: Model3DLink;

    constructor(options?: Kicad3DModelOptions) {
        this._options = options ?? { unit: "mm" };
        this._rotation = {
            x: options?.rotX ?? 0,
            y: options?.rotY ?? 0,
            z: options?.rotZ ?? 0,
        };
    }

    /** @internal Ensure OCC is initialized. */
    private async _ensureOC(): Promise<OC> {
        if (!this._oc) {
            this._oc = await initOCC();
        }
        return this._oc!;
    }

    /** Set the OCC instance directly (useful in tests to avoid re-init). */
    setOC(oc: OC): void {
        this._oc = oc;
    }

    /** Get the current OCC instance (must have been set or init'd). */
    get oc(): OC {
        if (!this._oc) throw new Error("OCC not initialized. Call await model.init() or model.setOC().");
        return this._oc;
    }

    /** Explicitly initialize OCC. Alternatively, export() will auto-init. */
    async init(): Promise<this> {
        await this._ensureOC();
        return this;
    }

    /** All solids currently in the model. */
    get solids(): ReadonlyArray<SolidHandle> {
        return this._solids;
    }

    // ── Primitives ────────────────────────────────────────────────────

    /** Create a box primitive. */
    box(opts: BoxOptions): SolidBuilder {
        const shape = makeBox(this.oc, opts);
        const handle: SolidHandle = { shape };
        this._solids.push(handle);
        return new SolidBuilder(this.oc, handle);
    }

    /** Create a sphere primitive. */
    sphere(opts: SphereOptions): SolidBuilder {
        const shape = makeSphere(this.oc, opts);
        const handle: SolidHandle = { shape };
        this._solids.push(handle);
        return new SolidBuilder(this.oc, handle);
    }

    /** Create a cylinder primitive. */
    cylinder(opts: CylinderOptions): SolidBuilder {
        const shape = makeCylinder(this.oc, opts);
        const handle: SolidHandle = { shape };
        this._solids.push(handle);
        return new SolidBuilder(this.oc, handle);
    }

    /**
     * Create a pipe (a cylinder with a concentric hole).
     */
    pipe(opts: { r: number; wallThickness: number; h: number; center?: boolean }): SolidBuilder {
        const outer = makeCylinder(this.oc, { r: opts.r, h: opts.h, center: opts.center });
        // Make the inner cylinder slightly longer to avoid Z-fighting/coplanar faces during cut
        const inner = makeCylinder(this.oc, { r: opts.r - opts.wallThickness, h: opts.h + 0.1, center: opts.center });
        const shape = cutShapes(this.oc, outer, inner);
        const handle: SolidHandle = { shape };
        this._solids.push(handle);
        return new SolidBuilder(this.oc, handle);
    }

    /**
     * Create a box with rounded edges (box + fillet on all edges).
     */
    roundedBox(opts: BoxOptions & { r: number }): SolidBuilder {
        const shape = makeBox(this.oc, opts);
        const rounded = filletAllEdges(this.oc, shape, opts.r);
        const handle: SolidHandle = { shape: rounded };
        this._solids.push(handle);
        return new SolidBuilder(this.oc, handle);
    }

    // ── Boolean operations ────────────────────────────────────────────

    /** Fuse (union) two solids. Replaces both with the result, returns new builder. */
    union(a: SolidBuilder, b: SolidBuilder): SolidBuilder {
        const fused = fuseShapes(this.oc, a._handle.shape, b._handle.shape);
        a._handle.shape = fused;

        // Remove the original handles
        this._removeSolid(b._handle);

        return a;
    }

    /** Subtract solid `b` from solid `a`. Removes `b` from model, replaces `a`. */
    subtract(a: SolidBuilder, b: SolidBuilder): SolidBuilder {
        const cut = cutShapes(this.oc, a._handle.shape, b._handle.shape);
        a._handle.shape = cut;

        this._removeSolid(b._handle);

        return a;
    }

    /** Intersect two solids. Returns their common volume. */
    intersect(a: SolidBuilder, b: SolidBuilder): SolidBuilder {
        const common = intersectShapes(this.oc, a._handle.shape, b._handle.shape);
        a._handle.shape = common;

        this._removeSolid(b._handle);

        return a;
    }

    // ── Export ─────────────────────────────────────────────────────────

    /**
     * Export the model to disk.
     * Generates WRL (and optionally STEP) files.
     */
    async export(opts: ExportOptions): Promise<ExportResult> {
        await this._ensureOC();

        // Apply whole-model rotation if specified
        const needsRotation = this._rotation.x !== 0 || this._rotation.y !== 0 || this._rotation.z !== 0;
        const exportSolids: SolidHandle[] = needsRotation
            ? this._solids.map(s => ({
                ...s,
                shape: rotateShape(this.oc, s.shape, this._rotation),
            }))
            : this._solids;

        const formats = opts.formats ?? ["wrl"];
        const result: ExportResult = {};

        if (formats.includes("wrl")) {
            const wrlPath = path.join(opts.outDir, `${opts.baseName}.wrl`);
            writeVRML(this.oc, exportSolids, wrlPath);
            result.wrlPath = wrlPath;
        }

        if (formats.includes("step")) {
            const stepPath = path.join(opts.outDir, `${opts.baseName}.step`);
            const ok = writeSTEP(this.oc, exportSolids, stepPath);
            if (ok) result.stepPath = stepPath;
        }

        return result;
    }

    // ── Private helpers ───────────────────────────────────────────────

    private _removeSolid(handle: SolidHandle): void {
        const idx = this._solids.indexOf(handle);
        if (idx !== -1) this._solids.splice(idx, 1);
    }
}
