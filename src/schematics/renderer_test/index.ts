import { Schematic, Component, Net, Composable, Pin, PinAssignable } from "@tobisk/pcbs";

class DividerModule extends Composable<"IN" | "OUT" | "GND"> {
  constructor(name: string, pos: { x: number; y: number }) {
    super({
      ref: name,
      description: "Voltage Divider Subcircuit",
      schematicPosition: pos,
    });
    this.makeSubschematic({ name: "VoltageDivider" });
  }

  protected defineInterface(): Record<"IN" | "OUT" | "GND", PinAssignable> {
    const r1 = new Component({
      symbol: "Device:R",
      ref: "R1",
      footprint: "Resistor_SMD:R_0603_1608Metric",
      schematicPosition: { x: 100, y: 50, rotation: 90 },
    });

    const r2 = new Component({
      symbol: "Device:R",
      ref: "R2",
      footprint: "Resistor_SMD:R_0603_1608Metric",
      schematicPosition: { x: 100, y: 150, rotation: 90 },
    });

    const mid = new Net({ name: "Internal_Mid" });
    mid.tie(r1.pins[2]);
    mid.tie(r2.pins[1]);

    return {
      IN: r1.pins[1],
      OUT: mid,
      GND: r2.pins[2],
    };
  }
}

class RendererTestSchematic extends Schematic {
  constructor() {
    super({
      name: "RendererTest",
      size: "A4",
      author: "AutoTest",
      revision: "v1.0",
      description: "A schematic designed to test PDF rendering capabilities.",
    });
  }

  generate() {
    // 1. Main Components
    const u1 = new Component({
      symbol: "MCU_Module:Arduino_Nano_v3.x",
      ref: "U1",
      footprint: "Module:Arduino_Nano",
      schematicPosition: { x: 100, y: 100 },
    });

    const led = new Component({
      symbol: "Device:LED",
      ref: "D1",
      footprint: "LED_SMD:LED_0805_2012Metric",
      schematicPosition: { x: 300, y: 100, rotation: 0 },
    });

    const res = new Component({
      symbol: "Device:R",
      ref: "R_LED",
      footprint: "Resistor_SMD:R_0603_1608Metric",
      schematicPosition: { x: 250, y: 100 },
    });

    // 2. Subschematic Instance
    const divider = new DividerModule("DIV1", { x: 200, y: 200 });

    // 3. Power Nets
    const vcc = new Net({ name: "VCC", class: "Power" });
    const gnd = new Net({ name: "GND", class: "Power" });

    // 4. Connections
    vcc.tie(u1.pins[27]); // 5V pin
    vcc.tie(divider.pins.IN);

    gnd.tie(u1.pins[4]); // GND pin
    gnd.tie(u1.pins[29]);
    gnd.tie(led.pins[1]); // Cathode to GND? Wait, check LED symbol... 1 usually K (cathode)
    gnd.tie(divider.pins.GND);

    const sig = new Net({ name: "LED_Control" });
    sig.tie(u1.pins[13]); // D13
    sig.tie(res.pins[1]);

    const ledNet = new Net({ name: "LED_Anode" });
    ledNet.tie(res.pins[2]);
    ledNet.tie(led.pins[2]); // Anode

    const analogIn = new Net({ name: "Analog_Input" });
    analogIn.tie(u1.pins[19]); // A0
    analogIn.tie(divider.pins.OUT);
  }
}

export default new RendererTestSchematic();
