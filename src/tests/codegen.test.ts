import { describe, it, expect, beforeEach } from "vitest";
import { Net, Component } from "../synth";
import { generatePython, CircuitSnapshot } from "../cli/codegen";

// ─── Helpers ─────────────────────────────────────────────────────────

function gen(name: string, components: Component<any>[], nets: Net[]): string {
    return generatePython({ name, components, nets });
}

describe("Python Code Generation", () => {
    it("should generate basic component instantiation", () => {
        const r1 = new Component({
            symbol: "Device:R",
            ref: "R1",
            footprint: "Resistor_SMD:R_0603_1608Metric",
        });
        const code = gen("Test", [r1], []);

        expect(code).toContain('r1 = Component(symbol="Device:R", ref="R1", footprint="Resistor_SMD:R_0603_1608Metric")');
    });

    it("should generate nets and ties", () => {
        const r1 = new Component({
            symbol: "Device:R",
            ref: "R1",
            footprint: "Resistor_SMD:R_0603_1608Metric",
        });
        const vcc = new Net({ name: "VCC" });
        vcc.tie(r1.pins[1]);

        const code = gen("Test", [r1], [vcc]);

        expect(code).toContain('net_vcc = Net("VCC")');
        expect(code).toContain('r1[1] += net_vcc');
    });

    it("should handle multiple components and nets", () => {
        const r1 = new Component({
            symbol: "Device:R",
            ref: "R1",
            footprint: "Resistor_SMD:R_0603_1608Metric",
        });
        const r2 = new Component({
            symbol: "Device:R",
            ref: "R2",
            footprint: "Resistor_SMD:R_0603_1608Metric",
        });
        const gnd = new Net({ name: "GND" });

        gnd.tie(r1.pins[2]);
        gnd.tie(r2.pins[2]);

        const code = gen("Test", [r1, r2], [gnd]);

        expect(code).toContain('net_gnd = Net("GND")');
        expect(code).toContain('r1[2] += net_gnd');
        expect(code).toContain('r2[2] += net_gnd');
    });

    it("should include component properties like value and partNo", () => {
        const r1 = new Component({
            symbol: "Device:R",
            ref: "R1",
            footprint: "Resistor_SMD:R_0603_1608Metric",
            value: "10k",
            partNo: "C123456",
        });
        const code = gen("Test", [r1], []);

        expect(code).toContain('value="10k"');
        expect(code).toContain('LCSC_Number="C123456"');
    });

    it("should handle pin mapping shorthand", () => {
        const vcc = new Net({ name: "VCC" });
        const gnd = new Net({ name: "GND" });

        const timer = new Component({
            symbol: "Timer:NE555D",
            ref: "U1",
            footprint: "Package_DIP:DIP-8_W7.62mm",
            pins: (pin: (n: number) => any) => ({
                GND: pin(1),
                OUT: pin(3),
                VCC: pin(8), // Added VCC pin definition
            }),
        });
        timer.pins.VCC.tie(vcc); // Added this line
        timer.pins.GND.tie(gnd); // Modified this line

        const code = gen("Test", [timer], [vcc, gnd]);
        expect(code).toContain('u1[1] += net_gnd');
    });
});
