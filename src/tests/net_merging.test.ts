import { describe, it, expect, beforeEach } from "vitest";
import { Net, Component, Registry } from "../synth";
import { registry } from "../synth/Registry";

describe("Net Merging", () => {
    beforeEach(() => {
        registry.start();
    });

    it("should merge two nets when a pin is tied to another net", () => {
        const netA = new Net({ name: "NetA" });
        const netB = new Net({ name: "NetB" });

        const r1 = new Component({
            symbol: "Device:R",
            ref: "R1",
            footprint: "Resistor_SMD:R_0603_1608Metric",
        });

        // Pin 1 starts in NetA
        netA.tie(r1.pins[1]);
        expect(r1.pins[1].net).toBe(netA);
        expect(netA.pins).toContain(r1.pins[1]);

        // Now tie Pin 1 to NetB - this should merge NetA into NetB
        netB.tie(r1.pins[1]);

        expect(r1.pins[1].net).toBe(netB);
        expect(netB.pins).toContain(r1.pins[1]);
        expect(registry.getNets()).toContain(netB);
        expect(registry.getNets()).not.toContain(netA);
    });

    it("should merge all pins from the old net into the new net", () => {
        const netA = new Net({ name: "NetA" });
        const netB = new Net({ name: "NetB" });

        const r1 = new Component({ symbol: "Device:R", ref: "R1", footprint: "Resistor_SMD:R_0603_1608Metric" });
        const r2 = new Component({ symbol: "Device:R", ref: "R2", footprint: "Resistor_SMD:R_0603_1608Metric" });

        netA.tie(r1.pins[1]);
        netA.tie(r1.pins[2]);
        netB.tie(r2.pins[1]);

        // Merge NetA into NetB
        netB.tie(r1.pins[1]);

        expect(r1.pins[1].net).toBe(netB);
        expect(r1.pins[2].net).toBe(netB);
        expect(r2.pins[1].net).toBe(netB);
        expect(netB.pins.length).toBe(3);
        expect(registry.getNets().length).toBe(1);
    });

    it("should handle implicit merging via pin assignment", () => {
        const netA = new Net({ name: "NetA" });
        const netB = new Net({ name: "NetB" });

        const r1 = new Component({ symbol: "Device:R", ref: "R1", footprint: "Resistor_SMD:R_0603_1608Metric" });
        const r2 = new Component({ symbol: "Device:R", ref: "R2", footprint: "Resistor_SMD:R_0603_1608Metric" });

        r1.pins[1] = netA;
        r2.pins[1] = netB;

        // This assignment should trigger a merge because both pins have nets
        r1.pins[1] = r2.pins[1];

        // Note: createPinProxy logic for pin=pin assignment:
        // if (otherPin.net) { otherPin.net.tie(pin); }
        // So netB.tie(r1.pins[1]) happens, which merges netA into netB (since netB is "newer" in the assignment target sense? no, netB is otherPin.net)

        expect(r1.pins[1].net).toBe(netB);
        expect(r2.pins[1].net).toBe(netB);
        expect(registry.getNets()).toContain(netB);
        expect(registry.getNets()).not.toContain(netA);
    });

    it("should respect DNC rules during merge", () => {
        const netA = new Net({ name: "NetA" });
        const r1 = new Component({ symbol: "Device:R", ref: "R1", footprint: "Resistor_SMD:R_0603_1608Metric" });
        netA.tie(r1.pins[1]);
        netA.tie(r1.pins[2]); // NetA has 2 functional pins

        const netDnc = new Net({ name: "DNC_NET" });
        const dnc = new Component({ symbol: "Device:DNC", ref: "D1", footprint: "DNC" });
        netDnc.tie(dnc.pins[1]);

        // Merging a DNC net with a net that have >1 functional pins should fail
        expect(() => netDnc.tie(r1.pins[1])).toThrow(/Cannot merge nets/);
    });

    it("should merge correctly in a Composable-like structure (repro user report)", () => {
        // Mimic DmxNode setup
        const vccVin = new Net({ name: "+VIN" });

        // Mimic BuckConverter internal setup
        const buckRef = "U4";
        const internalVinNet = new Net({ name: `${buckRef}_VIN` });
        const uBuck = new Component({ symbol: "Device:L_Small", ref: buckRef, footprint: "Inductor_SMD:L_0603_1608Metric" });
        const cIn = new Component({ symbol: "Device:C_Small", ref: `C_IN_${buckRef}`, footprint: "Capacitor_SMD:C_0603_1608Metric" });

        internalVinNet.tie(uBuck.pins[1]);
        internalVinNet.tie(cIn.pins[1]);

        // Mimic barrel jack
        const barrelJack = new Component({ symbol: "Connector:Barrel_Jack", ref: "J1", footprint: "Connector_BarrelJack:BarrelJack_Horizontal" });
        barrelJack.pins[1] = vccVin;

        // The "buck.pins.VIN = vccVin" assignment
        const buckVinPin = uBuck.pins[1];
        vccVin.tie(buckVinPin);

        // Assertions
        expect(uBuck.pins[1].net).toBe(vccVin);
        expect(cIn.pins[1].net).toBe(vccVin);
        expect(barrelJack.pins[1].net).toBe(vccVin);
        expect(registry.getNets().map(n => n.name)).toContain("+VIN");
        expect(registry.getNets().map(n => n.name)).not.toContain("U4_VIN");
    });
});
