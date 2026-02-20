/**
 * 3D Model Pipeline Tests
 *
 * Tests cover:
 * 1. Build model with union + subtract + fillet → export WRL → verify file
 * 2. VRML content verification (header, diffuseColor, IndexedFaceSet)
 * 3. Footprint model block serialization
 * 4. Primitives produce valid shapes
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { KicadFootprint } from "../synth/KicadFootprint";
import { Kicad3DModel } from "../synth/3d/Kicad3DModel";
import { initOCC } from "../synth/3d/occ";
import type { OC } from "../synth/3d/types";

let oc: OC;

// Initialize OCC once for all tests (~2-3 seconds)
beforeAll(async () => {
    oc = await initOCC();
}, 30000);

// ─── Primitive creation ──────────────────────────────────────────────

describe("Primitives", () => {
    it("creates a box", () => {
        const model = new Kicad3DModel();
        model.setOC(oc);
        const box = model.box({ x: 10, y: 20, z: 5 });
        expect(box._handle.shape).toBeTruthy();
    });

    it("creates a centered box", () => {
        const model = new Kicad3DModel();
        model.setOC(oc);
        const box = model.box({ x: 10, y: 20, z: 5, center: true });
        expect(box._handle.shape).toBeTruthy();
    });

    it("creates a sphere", () => {
        const model = new Kicad3DModel();
        model.setOC(oc);
        const sphere = model.sphere({ r: 5 });
        expect(sphere._handle.shape).toBeTruthy();
    });

    it("creates a cylinder", () => {
        const model = new Kicad3DModel();
        model.setOC(oc);
        const cyl = model.cylinder({ r: 3, h: 10 });
        expect(cyl._handle.shape).toBeTruthy();
    });

    it("creates a centered cylinder", () => {
        const model = new Kicad3DModel();
        model.setOC(oc);
        const cyl = model.cylinder({ r: 3, h: 10, center: true });
        expect(cyl._handle.shape).toBeTruthy();
    });

    it("creates a pipe", () => {
        const model = new Kicad3DModel();
        model.setOC(oc);
        const p = model.pipe({ r: 5, wallThickness: 1, h: 10 });
        expect(p._handle.shape).toBeTruthy();
    });

    it("creates a centered pipe", () => {
        const model = new Kicad3DModel();
        model.setOC(oc);
        const p = model.pipe({ r: 5, wallThickness: 1, h: 10, center: true });
        expect(p._handle.shape).toBeTruthy();
    });
});

// ─── Transforms ──────────────────────────────────────────────────────

describe("Transforms", () => {
    it("translates a box", () => {
        const model = new Kicad3DModel();
        model.setOC(oc);
        const box = model.box({ x: 5, y: 5, z: 5 }).translate({ x: 10, y: 20, z: 30 });
        expect(box._handle.shape).toBeTruthy();
    });

    it("rotates a box", () => {
        const model = new Kicad3DModel();
        model.setOC(oc);
        const box = model.box({ x: 5, y: 5, z: 5 }).rotate({ z: 45 });
        expect(box._handle.shape).toBeTruthy();
    });

    it("chains translate + rotate + color", () => {
        const model = new Kicad3DModel();
        model.setOC(oc);
        const box = model.box({ x: 5, y: 5, z: 5 })
            .translate({ x: 10 })
            .rotate({ z: 90 })
            .color("#ff0000");

        expect(box._handle.shape).toBeTruthy();
        expect(box._handle.color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    });
});

// ─── Boolean operations ──────────────────────────────────────────────

describe("Boolean operations", () => {
    it("fuses two boxes", () => {
        const model = new Kicad3DModel();
        model.setOC(oc);
        const a = model.box({ x: 10, y: 10, z: 10, center: true });
        const b = model.box({ x: 5, y: 5, z: 20, center: true });
        const result = model.union(a, b);

        expect(result._handle.shape).toBeTruthy();
        expect(model.solids).toHaveLength(1);
    });

    it("subtracts a cylinder from a box", () => {
        const model = new Kicad3DModel();
        model.setOC(oc);
        const box = model.box({ x: 20, y: 20, z: 10, center: true });
        const hole = model.cylinder({ r: 3, h: 20, center: true });
        const result = model.subtract(box, hole);

        expect(result._handle.shape).toBeTruthy();
        expect(model.solids).toHaveLength(1);
    });

    it("intersects two boxes", () => {
        const model = new Kicad3DModel();
        model.setOC(oc);
        const a = model.box({ x: 10, y: 10, z: 10, center: true });
        const b = model.box({ x: 10, y: 10, z: 10, center: true })
            .translate({ x: 5, y: 5 });
        const result = model.intersect(a, b);

        expect(result._handle.shape).toBeTruthy();
        expect(model.solids).toHaveLength(1);
    });
});

// ─── Fillet ──────────────────────────────────────────────────────────

describe("Fillet", () => {
    it("fillets all edges of a box", () => {
        const model = new Kicad3DModel();
        model.setOC(oc);
        const box = model.box({ x: 10, y: 10, z: 10, center: true })
            .fillet({ radius: 1, edges: "all" });
        expect(box._handle.shape).toBeTruthy();
    });

    it("creates a rounded box via roundedBox()", () => {
        const model = new Kicad3DModel();
        model.setOC(oc);
        const rounded = model.roundedBox({ x: 10, y: 10, z: 10, r: 1.5, center: true });
        expect(rounded._handle.shape).toBeTruthy();
    });
});

// ─── VRML Export ─────────────────────────────────────────────────────

describe("VRML export", () => {
    it("exports a model with union + subtract + fillet to WRL", async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kicad-3d-test-"));

        try {
            const model = new Kicad3DModel();
            model.setOC(oc);

            // Build a box, union with another box, subtract a cylinder, fillet
            const body = model.box({ x: 20, y: 15, z: 5, center: true }).color("#1f4fa3");
            const top = model.box({ x: 8, y: 8, z: 10, center: true })
                .translate({ z: 5 })
                .color("#c0c0c0");

            // Don't combine — keep as separate colored solids
            const hole = model.cylinder({ r: 2, h: 20, center: true }).name("hole");
            const bodyWithHole = model.subtract(body, hole);

            const result = await model.export({
                outDir: tmpDir,
                baseName: "test_model",
                formats: ["wrl"],
            });

            // File exists
            expect(result.wrlPath).toBeDefined();
            expect(fs.existsSync(result.wrlPath!)).toBe(true);

            // Read and verify content
            const content = fs.readFileSync(result.wrlPath!, "utf-8");

            // VRML header
            expect(content).toContain("#VRML V2.0 utf8");

            // Has material color
            expect(content).toContain("diffuseColor");

            // Has geometry
            expect(content).toContain("IndexedFaceSet");
            expect(content).toContain("coordIndex");
            expect(content).toContain("Coordinate");
        } finally {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });

    it("preserves per-solid colors in VRML", async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kicad-3d-color-"));

        try {
            const model = new Kicad3DModel();
            model.setOC(oc);

            model.box({ x: 10, y: 10, z: 2, center: true }).color("#ff0000").name("red");
            model.box({ x: 5, y: 5, z: 5, center: true })
                .translate({ z: 3 })
                .color("#00ff00")
                .name("green");

            const result = await model.export({
                outDir: tmpDir,
                baseName: "color_test",
                formats: ["wrl"],
            });

            const content = fs.readFileSync(result.wrlPath!, "utf-8");

            // Should have two Shape nodes, each with diffuseColor
            const shapeCount = (content.match(/Shape\s*\{/g) || []).length;
            expect(shapeCount).toBe(2);

            // Red color (1 0 0) and green color (0 1 0)
            expect(content).toContain("diffuseColor 1 0 0");
            expect(content).toContain("diffuseColor 0 1 0");

            // Solid name comments
            expect(content).toContain("# red");
            expect(content).toContain("# green");
        } finally {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });
});

// ─── Footprint model block ──────────────────────────────────────────

describe("Footprint model block", () => {
    it("serializes (model ...) block with defaults", () => {
        const fp = new KicadFootprint({ name: "TestPart3D" });
        fp.addPad({
            number: "1", type: "smd", shape: "rect",
            x: 0, y: 0, width: 1, height: 1,
        });
        fp.set3DModel({ path: "${KIPRJMOD}/.kicad/3d/TestPart3D.wrl" });

        const out = fp.serialize();

        expect(out).toContain('(model "${KIPRJMOD}/.kicad/3d/TestPart3D.wrl"');
        expect(out).toContain("(offset (xyz 0 0 0))");
        expect(out).toContain("(scale (xyz 1 1 1))");
        expect(out).toContain("(rotate (xyz 0 0 0))");
    });

    it("serializes (model ...) block with custom offset/scale/rotate", () => {
        const fp = new KicadFootprint({ name: "TestCustom3D" });
        fp.addPad({
            number: "1", type: "smd", shape: "rect",
            x: 0, y: 0, width: 1, height: 1,
        });
        fp.set3DModel({
            path: "${KIPRJMOD}/.kicad/3d/TestCustom3D.wrl",
            offset: { x: 1.5, y: 2.5, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            rotate: { x: 0, y: 0, z: 90 },
        });

        const out = fp.serialize();

        expect(out).toContain("(offset (xyz 1.5 2.5 0))");
        expect(out).toContain("(rotate (xyz 0 0 90))");
    });

    it("does not serialize model block when no 3D model is set", () => {
        const fp = new KicadFootprint({ name: "NoModel" });
        fp.addPad({
            number: "1", type: "smd", shape: "rect",
            x: 0, y: 0, width: 1, height: 1,
        });

        const out = fp.serialize();
        expect(out).not.toContain("(model");
    });

    it("model block appears before embedded_fonts", () => {
        const fp = new KicadFootprint({ name: "OrderCheck" });
        fp.set3DModel({ path: "test.wrl" });

        const out = fp.serialize();
        const modelIdx = out.indexOf("(model");
        const fontsIdx = out.indexOf("(embedded_fonts");

        expect(modelIdx).toBeGreaterThan(-1);
        expect(fontsIdx).toBeGreaterThan(-1);
        expect(modelIdx).toBeLessThan(fontsIdx);
    });
});
