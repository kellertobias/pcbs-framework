# Quick Start Guide

Welcome to **@tobisk/pcbs**! This guide will help you get started with creating your first PCB design using our code-first framework.

## Prerequisites

Before you begin, ensure you have the following installed:

*   **Node.js** (v18 or later recommended)
*   **KiCad** (v7 or v8 recommended)
*   **npm** (comes with Node.js)

## Installation

1.  **Initialize a new project**:

    ```bash
    mkdir my-pcb-project
    cd my-pcb-project
    npm init -y
    ```

2.  **Install the framework**:

    ```bash
    npm install @tobisk/pcbs typescript ts-node
    ```

3.  **Initialize TypeScript configuration**:

    Create a `tsconfig.json` file:

    ```json
    {
      "compilerOptions": {
        "target": "ES2020",
        "module": "commonjs",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true
      }
    }
    ```

## Your First Circuit: Blinky

Let's create a simple LED circuit.

1.  **Create the project structure**:

    ```bash
    mkdir -p src/schematics
    ```

2.  **Create a schematic file**:

    Create `src/schematics/Blinky.ts`:

    ```typescript
    import { Schematic, Net, Component } from "@tobisk/pcbs";

    export class BlinkySchematic extends Schematic {
      constructor() {
        super({ name: "Blinky_Project", size: "A4" });
      }

      generate() {
        // Define Nets
        const vcc = new Net({ name: "+5V", class: "Power" });
        const gnd = new Net({ name: "GND", class: "Power" });

        // Define Components
        const resistor = new Component({
          symbol: "Device:R",
          footprint: "Resistor_SMD:R_0603_1608Metric",
          ref: "R1",
          value: "330",
        });

        const led = new Component({
          symbol: "Device:LED",
          footprint: "LED_SMD:LED_0603_1608Metric",
          ref: "D1",
          value: "Green",
        });

        const connector = new Component({
          symbol: "Connector:Conn_01x02_Male",
          footprint: "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical",
          ref: "J1",
        });

        // Wire them up
        // Connect Connector to Power Rails
        connector.pins[1].tie(vcc);
        connector.pins[2].tie(gnd);

        // Connect Resistor and LED
        resistor.pins[1].tie(vcc);
        resistor.pins[2].tie(led.pins[1]); // Series connection
        led.pins[2].tie(gnd);
      }
    }

    export default new BlinkySchematic();
    ```

## Generating Files

Now that we have our schematic defined in code, let's generate the KiCad files.

1.  **Synthesize the Schematic**:

    Run the `synth` command to generate the `.kicad_sch` and `.net` files.

    ```bash
    npx pcbs synth src/schematics/Blinky.ts
    ```

    You should see output indicating successful generation. A folder named `Blinky_Project` (based on the schematic name) will be created inside `src/schematics/`.

2.  **Open in KiCad**:

    Open the generated `.kicad_sch` file in KiCad. You will see your components placed and wired up!

3.  **Layout the PCB**:

    Open the `.kicad_pcb` file (create one if it doesn't exist, or import the netlist from the schematic editor to the PCB editor). Place your components and route your tracks as usual in KiCad.

## Next Steps

*   Explore **[API Documentation](Schematic.md)** to learn about `Composable` blocks and `Modules`.
*   Check out **[CLI Documentation](CLI.md)** for advanced usage like exporting fabrication files.
