import { describe, it, expect } from "vitest";
import { Schematic, Net, Component, DNC, TP } from "../synth";
import { generatePython } from "../cli/codegen";

describe("DNC Component and Validation", () => {
  it("allows connecting exactly one functional pin to a DNC component", () => {
    class DncTest extends Schematic {
      constructor() { super({ name: "DncTest" }); }
      generate() {
        const dnc = new DNC();
        const r1 = new Component({
          symbol: "Device:R", ref: "R1",
          footprint: "Resistor_SMD:R_0603_1608Metric",
        });
        const net = new Net({ name: "TEST_NET" });
        net.tie(dnc.pins[1]);
        net.tie(r1.pins[1]);
      }
    }
    new DncTest().generate();
  });

  it("throws when connecting two functional pins to a DNC net", () => {
    class DncTest extends Schematic {
      constructor() { super({ name: "DncTest" }); }
      generate() {
        const dnc = new DNC();
        const r1 = new Component({ symbol: "Device:R", ref: "R1", footprint: "Resistor_SMD:R_0603_1608Metric" });
        const r2 = new Component({ symbol: "Device:R", ref: "R2", footprint: "Resistor_SMD:R_0603_1608Metric" });
        const net = new Net({ name: "TEST_NET" });
        net.tie(dnc.pins[1]);
        net.tie(r1.pins[1]);
        expect(() => net.tie(r2.pins[1])).toThrow(/already has a functional connection and is marked as DNC/);
      }
    }
    new DncTest().generate();
  });

  it("marks a pin as NC by assigning null", () => {
    class NullTest extends Schematic {
      constructor() { super({ name: "NullTest" }); }
      generate() {
        const r1 = new Component({ symbol: "Device:R", ref: "R1", footprint: "Resistor_SMD:R_0603_1608Metric" });
        r1.pins[1].tie(null);
      }
    }
    const board = new NullTest();
    const snapshot = board._generateWithCapture();
    const python = generatePython(snapshot);
    expect(python).toContain('r1[1] += Net("NC_R1_1")');
  });

  it("marks a pin as NC by assigning DNC directly", () => {
    class DirectTest extends Schematic {
      constructor() { super({ name: "DirectTest" }); }
      generate() {
        const r1 = new Component({ symbol: "Device:R", ref: "R1", footprint: "Resistor_SMD:R_0603_1608Metric" });
        r1.pins[2].tie(new DNC());
      }
    }
    const board = new DirectTest();
    const snapshot = board._generateWithCapture();
    const python = generatePython(snapshot);
    expect(python).toContain('r1[2] += Net("NC_R1_2")');
  });
});

describe("TP (TestPoint) Component", () => {
  it("assigns a test point directly to a pin", () => {
    class TpTest extends Schematic {
      constructor() { super({ name: "TpTest" }); }
      generate() {
        const r1 = new Component({ symbol: "Device:R", ref: "R1", footprint: "Resistor_SMD:R_0603_1608Metric" });
        r1.pins[1].tie(new TP({ ref: "TP1" }));
      }
    }
    const board = new TpTest();
    const snapshot = board._generateWithCapture();
    const python = generatePython(snapshot);
    // TP should be a registered component and connected to R1's pin
    expect(python).toContain('tp1 = Component(');
    expect(python).toContain('symbol="Connector:TestPoint"');
  });

  it("connects TP pin to a shared net", () => {
    class TpNetTest extends Schematic {
      constructor() { super({ name: "TpNetTest" }); }
      generate() {
        const r1 = new Component({ symbol: "Device:R", ref: "R1", footprint: "Resistor_SMD:R_0603_1608Metric" });
        const vcc = new Net({ name: "VCC" });
        vcc.tie(r1.pins[1]);
        // Assign TP to R1 pin 1 — should also be on VCC net
        r1.pins[1].tie(new TP({ ref: "TP_VCC" }));
      }
    }
    const board = new TpNetTest();
    const snapshot = board._generateWithCapture();
    const python = generatePython(snapshot);
    // Both R1 pin 1 and TP should be on VCC
    expect(python).toContain('tp_vcc = Component(');
    expect(python).toContain('tp_vcc[1] += net_vcc');
  });
});
