import { describe, it, expect } from "vitest";
import { Component, Composable } from "../synth";

describe("Component and Composable Placement", () => {
    it("calculates absolute schematic position for a single component", () => {
        const c1 = new Component({
            ref: "C1",
            symbol: "Device:C",
            footprint: "Capacitor_SMD:C_0603_1608Metric",
            schematicPosition: { x: 10, y: 20, rotation: 90 },
        });

        const pos = c1.absoluteSchematicPosition;
        expect(pos).not.toBeNull();
        if (pos) {
            expect(pos.x).toBe(10);
            expect(pos.y).toBe(20);
            expect(pos.rotation).toBe(90);
        }
    });

    it("calculates absolute pcb position for a single component", () => {
        const c1 = new Component({
            ref: "C1",
            symbol: "Device:C",
            footprint: "Capacitor_SMD:C_0603_1608Metric",
            pcbPosition: { x: 50, y: 60, rotation: 180, side: "back" },
        });

        const pos = c1.absolutePcbPosition;
        expect(pos.x).toBe(50);
        expect(pos.y).toBe(60);
        expect(pos.rotation).toBe(180);
        expect(pos.side).toBe("back");
    });

    it("offsets component position within a Composable", () => {
        class MyComposable extends Composable {
            comp!: Component;
            constructor() {
                super({
                    ref: "MY",
                    schematicPosition: { x: 100, y: 100 },
                    pcbPosition: { x: 200, y: 200, side: "back" },
                });
            }

            defineInterface() {
                this.comp = new Component({
                    ref: "R1",
                    symbol: "Device:R",
                    footprint: "Resistor_SMD:R_0603_1608Metric",
                    schematicPosition: { x: 10, y: 20, rotation: 45 },
                    pcbPosition: { x: 5, y: 5 },
                });
                return {};
            }
        }

        const my = new MyComposable();
        // Trigger lazy initialization
        my.pins;

        const sPos = my.comp.absoluteSchematicPosition;
        expect(sPos).not.toBeNull();
        if (sPos) {
            expect(sPos.x).toBe(110);
            expect(sPos.y).toBe(120);
            expect(sPos.rotation).toBe(45);
        }

        const pPos = my.comp.absolutePcbPosition;
        expect(pPos.x).toBe(205);
        expect(pPos.y).toBe(205);
        expect(pPos.side).toBe("back"); // Inherited from parent
    });

    it("handles nested Composables with recursive offsetting", () => {
        class Inner extends Composable {
            comp!: Component;
            constructor() {
                super({
                    ref: "INNER",
                    schematicPosition: { x: 10, y: 10 },
                    pcbPosition: { x: 5, y: 5 },
                });
            }
            defineInterface() {
                this.comp = new Component({
                    ref: "C1",
                    symbol: "Device:C",
                    footprint: "Capacitor_SMD:C_0603_1608Metric",
                    schematicPosition: { x: 1, y: 1 },
                    pcbPosition: { x: 2, y: 2 },
                });
                return {};
            }
        }

        class Outer extends Composable {
            inner!: Inner;
            constructor() {
                super({
                    ref: "OUTER",
                    schematicPosition: { x: 100, y: 100 },
                    pcbPosition: { x: 200, y: 200, side: "back" },
                });
            }
            defineInterface() {
                this.inner = new Inner();
                // Trigger inner initialization
                this.inner.pins;
                return {};
            }
        }

        const outer = new Outer();
        outer.pins;

        const sPos = outer.inner.comp.absoluteSchematicPosition;
        expect(sPos).not.toBeNull();
        if (sPos) {
            expect(sPos.x).toBe(111); // 100 (outer) + 10 (inner) + 1 (comp)
            expect(sPos.y).toBe(111);
        }

        const pPos = outer.inner.comp.absolutePcbPosition;
        expect(pPos.x).toBe(207); // 200 + 5 + 2
        expect(pPos.side).toBe("back"); // Inherited from outer
    });

    it("allows overriding inherited PCB side", () => {
        class MyComposable extends Composable {
            comp!: Component;
            constructor() {
                super({
                    ref: "MY",
                    pcbPosition: { x: 0, y: 0, side: "back" },
                });
            }
            defineInterface() {
                this.comp = new Component({
                    ref: "R1",
                    symbol: "Device:R",
                    footprint: "Resistor_SMD:R_0603_1608Metric",
                    pcbPosition: { x: 10, y: 10, side: "front" },
                });
                return {};
            }
        }

        const my = new MyComposable();
        my.pins;

        expect(my.comp.absolutePcbPosition.side).toBe("front");
    });
});
