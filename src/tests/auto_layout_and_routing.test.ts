import { describe, it, expect, beforeEach } from "vitest";
import * as path from "path";
import { SymbolLibrary } from "../kicad/SymbolLibrary";
import { UuidManager } from "../kicad/UuidManager";
import { SchematicGenerator } from "../kicad/SchematicGenerator";
import { CircuitSnapshot } from "../synth/types";
import { GravityLayout } from "../synth/Layout";

describe("Auto Layout and Routing", () => {
    const assetsDir = path.join(__dirname, "assets", "symbols");
    const lib = new SymbolLibrary([assetsDir]);

    it("throws an error when manually placed components overlap", () => {
        const c1 = {
            symbol: "Device:R", ref: "R1",
            allPins: new Map(),
            absoluteSchematicPosition: { x: 100, y: 100, rotation: 0 },
            footprint: "R_0603"
        } as any;
        const c2 = {
            symbol: "Device:R", ref: "R2",
            allPins: new Map(),
            absoluteSchematicPosition: { x: 100, y: 100, rotation: 0 },
            footprint: "R_0603"
        } as any;

        const snapshot: CircuitSnapshot = {
            name: "OverlapTest",
            components: [c1, c2],
            nets: [],
            author: "",
            revision: "",
            company: "",
            description: ""
        };

        const gen = new SchematicGenerator(snapshot, lib, new UuidManager());

        gen.generate();
        expect(gen.errors.length).toBeGreaterThan(0);
        expect(gen.errors[0]).toMatch(/overlap/i);
    });

    it("auto-positions components when no position is provided", () => {
        const items: any[] = [
            { ref: "C1", schematicPosition: null, allPins: new Map() },
            { ref: "C2", schematicPosition: null, allPins: new Map() }
        ];

        const layout = new GravityLayout();
        layout.apply(items);

        expect(items[0].schematicPosition).not.toBeNull();
        expect(items[1].schematicPosition).not.toBeNull();

        const p1 = items[0].schematicPosition;
        const p2 = items[1].schematicPosition;
        // Verify they are not at the same position
        expect(p1.x !== p2.x || p1.y !== p2.y).toBe(true);
    });

    it("routes wires around obstacles", () => {
        // Setup: A (0,0) --- Obstacle (200,0) --- B (400,0)
        // Both A and B are connected. Obstacle is not connected to them.
        // Increased spacing to avoid overlap detection triggering (default box size is 100x100)

        const c1 = {
            symbol: "Device:R", ref: "R1",
            allPins: new Map(),
            absoluteSchematicPosition: { x: 0, y: 0, rotation: 0 }
        } as any;

        // Obstacle blocking the direct path
        const cObs = {
            symbol: "Device:R", ref: "OBS",
            allPins: new Map(),
            absoluteSchematicPosition: { x: 200, y: 0, rotation: 0 }
        } as any;

        const c2 = {
            symbol: "Device:R", ref: "R2",
            allPins: new Map(),
            absoluteSchematicPosition: { x: 400, y: 0, rotation: 0 }
        } as any;

        const net = { name: "NET1", class: "Signal" } as any;

        // Connect pin 1 of R1 to pin 1 of R2
        // Assuming pin 1 is at (0, 0) relative to symbol center for simplicity,
        // or we rely on getPinAbsolutePosition using library.
        // Device:R usually has pins at (-2.54, 0) and (2.54, 0) or similar.
        // Let's assume pin 1 is "1" and exists in the library symbol.
        const p1 = { component: c1, name: "1", net: net } as any;
        const p2 = { component: c2, name: "1", net: net } as any;
        c1.allPins.set("1", p1);
        c2.allPins.set("1", p2);

        const snapshot: CircuitSnapshot = {
            name: "RoutingTest",
            components: [c1, cObs, c2],
            nets: [net],
            author: "",
            revision: "",
            company: "",
            description: ""
        };

        const gen = new SchematicGenerator(snapshot, lib, new UuidManager(), { experimentalRouting: true });
        const output = gen.generate();

        // Regex to extract wire segments
        const wireRegex = /\(wire\s+\(pts\s+\(xy\s+([\d.-]+)\s+([\d.-]+)\)\s+\(xy\s+([\d.-]+)\s+([\d.-]+)\)\s*\)/g;
        let match;
        const segments = [];
        while ((match = wireRegex.exec(output)) !== null) {
            segments.push({
                x1: parseFloat(match[1]), y1: parseFloat(match[2]),
                x2: parseFloat(match[3]), y2: parseFloat(match[4])
            });
        }

        expect(segments.length).toBeGreaterThan(0);

        // Identify the path. Since obstacle is at (50,0), a direct line would be y ~ 0 (or pin y).
        // A detour should have some segments with significant Y deviation.
        // Or if it goes above/below, the Y coordinates should reflect that.
        // Device:R is roughly 2.54mm to 5mm tall. 50 units = 1.27mm (if units are mils/steps).
        // Wait, KiCad units in S-Expr are usually mm.
        // If our layout uses mils, we need to check conversion.
        // But here we provided positions 0, 50, 100.
        // If these are interpreted as mm, that's fine.

        // Find if there's any segment that goes "around".
        // A straight line would only have y values close to the pin Y.
        // A routed line should have some vertical segments and horizontal segments at a different Y.

        const yValues = segments.flatMap(s => [s.y1, s.y2]);
        const minY = Math.min(...yValues);
        const maxY = Math.max(...yValues);

        // We expect the range of Y to be significant (e.g. > 1.0mm) to clear the obstacle.
        expect(maxY - minY).toBeGreaterThan(1.0);
    });
});
