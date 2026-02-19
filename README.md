# @tobisk/pcb

A strict, type-safe TypeScript framework for designing PCBs, powered by [circuit-synth](https://github.com/circuit-synth/circuit-synth).

This is a framework I have built around circuit-synth to better suit my workflow.

The problem to solve here is that while circuit-synth is awesome, it only manages circuits and since it's python it's not type safe.

I needed a way to also manage custom footprints and ideally generate them by uploading a picture or describing them to the AI.

On top of circuit-synth, we have added:
- Directly export zip files to upload to JLCPCB including the Pick'n'Place csv files
- add a simple command to let an ai agent search for JLC parts (WIP)
- Manage Footprints, Symbols
- Manage 3d visualisations of the footprints
- Type Safety

... and I actually prefer typescript over python.

## Features

- **Type-Safe Design**: leveraging TypeScript to ensure correct connectivity and component logic.
- **Circuit-Synth Integration**: Uses `circuit-synth` internally for the heavy lifting of netlisting and PCB generation.
- **Programmatic Layout**: Define schematic and PCB positions in code.
- **Modular Components**: Reusable `Composable` blocks (e.g., Buck Converters, LED Indicators).

## Usage

```bash
npm install @tobisk/pcb
```

### CLI

```bash
npx @tobisk/pcb synth <schematic-name>
npx @tobisk/pcb export <schematic-name>
npx @tobisk/pcb lib <schematic-name>
```

Once you have `synth`-ethized your schematic, you can open the kicad schematic file and generate a PCB from it. Every time we synth, we update the schematic and the netlist.

It could be that the internal IDs of the kicad symbols drift, so when loading a new netlist in the PCB editor and the positions change, undo the loading and select the "Match by Reference" and re-import the net.

## Project Structure

A typical project using `@tobisk/pcb` is structured into three main directories:

- `src/lib/`: Reusable, technology-independent building blocks (`Composable`).
- `src/module/`: Physical components or sub-assemblies with specific footprints (`Module`).
- `src/schematics/`: The top-level design that wires everything together (`Schematic`).

```text
my-pcb-project/
├── src/
│   ├── lib/            # Reusable Composable blocks
│   │   └── LedIndicator.ts
│   ├── module/         # Physical Modules (Symbols + Footprints)
│   │   └── UsbPowerModule.ts
│   └── schematics/      # Project Schematics
│       └── MyProject.ts
├── package.json
└── tsconfig.json
```

## Examples

### 1. Composable (Logic Block)
`Composable` blocks are reusable circuits that define logic and connectivity without being tied to a single physical package.

```typescript
import { Composable, Net, Component, PinAssignable } from "@tobisk/pcb";

export class LedIndicator extends Composable<"SIGNAL" | "GND"> {
  constructor(options: { ref: string; color?: string }) {
    super({ ref: options.ref });
    
    const resistor = new Component({
      symbol: "Device:R",
      footprint: "Resistor_SMD:R_0603_1608Metric",
      value: "330",
    });
  
    const led = new Component({
      symbol: "Device:LED",
      footprint: "LED_SMD:LED_0603_1608Metric",
      value: options.color ?? "Green",
    });
  
    const internal = new Net();
    internal.tie(resistor.pins[2]);
    internal.tie(led.pins[1]);

    this.resistor = resistor; // Store for defineInterface
    this.led = led;
  }

  protected defineInterface(): Record<string, PinAssignable> {
    return {
      SIGNAL: this.resistor.pins[1],
      GND: this.led.pins[2],
    };
  }
}
```

### 2. Module (Physical Component)
`Module` represents a physical component with a specific KiCad symbol and footprint. It can also define a parametric 3D model.

```typescript
import { KicadFootprint, KicadSymbol, Module, Kicad3DModel } from "@tobisk/pcb";

export class UsbPowerModule extends Module<"VBUS" | "GND"> {
  constructor(options: { ref?: string }) {
    super({
      symbol: "Project_Symbols:USB_Power_Module",
      footprint: "Project_Footprints:USB_Power_Module",
      ref: options.ref ?? "J_PWR",
      pins: (pin) => ({
        GND: pin(1),
        VBUS: pin(2),
      }),
    });
  }

  public static makeFootprint(): KicadFootprint {
     const fp = new KicadFootprint({ name: "USB_Power_Module" });
     // ... define pads and graphics ...
     return fp;
  }

  public static makeSymbol(): KicadSymbol {
     const sym = new KicadSymbol({ name: "USB_Power_Module", reference: "J" });
     // ... define pins and shapes ...
     return sym;
  }

  public static async make3DModel(): Promise<Kicad3DModel> {
    const model = new Kicad3DModel({ unit: "mm" });
    await model.init();

    // Box for the connector body
    model.box({ x: 10, y: 15, z: 5, center: true })
      .color("#c0c0c0") // Silver
      .name("body");

    // Cylindrical pins
    model.cylinder({ r: 0.5, h: 4 })
      .translate({ x: -3, y: 0, z: -2 })
      .color("#ffd700") // Gold
      .name("pin1");

    return model;
  }
}
```

### 3. Schematic (Top-level Project)
`Schematic` is where you instantiate modules and composables and wire them together.

```typescript
import { Schematic, Net } from "@tobisk/pcb";
import { LedIndicator } from "../lib/LedIndicator";
import { UsbPowerModule } from "../module/UsbPowerModule";

export class MyProject extends Schematic {
  constructor() {
    super({ name: "My_Cool_PCB" });
  }

  generate() {
    const gnd = new Net({ name: "GND" });
    const vcc = new Net({ name: "+5V" });

    const pwr = new UsbPowerModule();
    const statusLed = new LedIndicator({ ref: "STATUS" });

    // Wiring
    pwr.pins.VBUS = vcc;
    pwr.pins.GND = gnd;

    statusLed.pins.SIGNAL = vcc;
    statusLed.pins.GND = gnd;
  }
}

export default new MyProject();
```
