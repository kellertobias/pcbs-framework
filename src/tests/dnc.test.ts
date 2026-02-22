import { describe, it, expect } from "vitest";
import { Schematic, Net, Component, DNC, TP } from "../synth";
import { Pin } from "../synth/types";

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
    const board = new DncTest();
    // Should not throw
    board._generateWithCapture();
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
    const board = new DncTest();
    board.generate(); // Logic runs immediately in constructor for this test or generate()
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

    // Find R1
    const r1 = snapshot.components.find(c => c.ref === "R1");
    expect(r1).toBeDefined();
    // Check pin 1 is DNC
    const p1 = r1!.pins[1] as Pin;
    expect(p1.isDNC).toBe(true);
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

    const r1 = snapshot.components.find(c => c.ref === "R1");
    expect(r1).toBeDefined();
    const p2 = r1!.pins[2] as Pin;
    expect(p2.isDNC).toBe(true);
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

    // Find TP1
    const tp1 = snapshot.components.find(c => c.ref === "TP1");
    expect(tp1).toBeDefined();
    expect(tp1!.symbol).toBe("Connector:TestPoint");

    // Check connection
    const r1 = snapshot.components.find(c => c.ref === "R1");
    const p1 = r1!.pins[1] as Pin;
    const tpPin = tp1!.pins[1] as Pin;

    // They should share a net (explicit or implicit)
    // tie() logic ensures they are on same net
    expect(p1.net).toBeDefined();
    expect(p1.net).toBe(tpPin.net);
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

    const tp = snapshot.components.find(c => c.ref === "TP_VCC");
    expect(tp).toBeDefined();

    const tpPin = tp!.pins[1] as Pin;
    expect(tpPin.net?.name).toBe("VCC");
  });
});
