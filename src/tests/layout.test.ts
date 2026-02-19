import { describe, it, expect } from "vitest";
import { Component } from "../synth/Component";
import { Composable } from "../synth/Composable";
import { HBoxLayout, VBoxLayout } from "../synth/Layout";
import { registry } from "../synth/Registry";
import { beforeEach } from "vitest";

describe("Layout System", () => {
    beforeEach(() => {
        registry.start();
    });

    it("HBoxLayout arranges components horizontally", () => {
        class HorizontalRow extends Composable {
            c1!: Component;
            c2!: Component;
            constructor() {
                super({
                    ref: "ROW",
                    layout: new HBoxLayout({ spacing: 100 })
                });
            }

            defineInterface() {
                this.c1 = new Component({ ref: "C1", symbol: "Device:C", footprint: "Capacitor_SMD:C_0603_1608Metric" });
                this.c2 = new Component({ ref: "C2", symbol: "Device:C", footprint: "Capacitor_SMD:C_0603_1608Metric" });
                return {};
            }
        }

        const row = new HorizontalRow();
        row.pins; // Initialize

        expect(row.c1.schematicPosition?.x).toBe(0);
        expect(row.c2.schematicPosition?.x).toBe(100);
        expect(row.c1.schematicPosition?.y).toBe(0);
        expect(row.c2.schematicPosition?.y).toBe(0);
    });

    it("VBoxLayout arranges components vertically", () => {
        class VerticalColumn extends Composable {
            c1!: Component;
            c2!: Component;
            constructor() {
                super({
                    ref: "COL",
                    layout: new VBoxLayout({ spacing: 50, x: 10, y: 10 })
                });
            }

            defineInterface() {
                this.c1 = new Component({ ref: "C1", symbol: "Device:C", footprint: "Capacitor_SMD:C_0603_1608Metric" });
                this.c2 = new Component({ ref: "C2", symbol: "Device:C", footprint: "Capacitor_SMD:C_0603_1608Metric" });
                return {};
            }
        }

        const col = new VerticalColumn();
        col.pins; // Initialize

        expect(col.c1.schematicPosition?.x).toBe(10);
        expect(col.c1.schematicPosition?.y).toBe(10);
        expect(col.c2.schematicPosition?.x).toBe(10);
        expect(col.c2.schematicPosition?.y).toBe(60);
    });

    it("Nested layouts work correctly", () => {
        class Nested extends Composable {
            inner!: Composable;
            cOutside!: Component;

            constructor() {
                super({
                    ref: "NEST",
                    layout: new VBoxLayout({ spacing: 200 })
                });
            }

            defineInterface() {
                this.inner = new class extends Composable {
                    c1!: Component;
                    c2!: Component;
                    constructor() {
                        super({ ref: "I", layout: new HBoxLayout({ spacing: 50 }) });
                    }
                    defineInterface() {
                        this.c1 = new Component({ ref: "C1", symbol: "Device:C", footprint: "Capacitor_SMD:C_0603_1608Metric" });
                        this.c2 = new Component({ ref: "C2", symbol: "Device:C", footprint: "Capacitor_SMD:C_0603_1608Metric" });
                        return {};
                    }
                }();
                this.cOutside = new Component({ ref: "CO", symbol: "Device:R", footprint: "Resistor_SMD:R_0603_1608Metric" });
                return {};
            }
        }

        const n = new Nested();
        n.pins; // Init Nested
        n.inner.pins; // Init Inner

        // Inner composable position (set by Nested mapping)
        expect(n.inner.schematicPosition?.y).toBe(0);
        // Outside component position (set by Nested mapping)
        expect(n.cOutside.schematicPosition?.y).toBe(200);

        // Sub-components within inner (set by Inner mapping)
        // These are local positions
        const innerAny = n.inner as any;
        expect(innerAny.c1.schematicPosition?.x).toBe(0);
        expect(innerAny.c2.schematicPosition?.x).toBe(50);
    });
});
