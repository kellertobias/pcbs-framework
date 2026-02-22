# @tobisk/pcbs

**The Code-First PCB Design Framework for Hobbyist Engineers.**

> **Note:** We no longer use `circuit-synth`, but this project is still deeply inspired by it.

`@tobisk/pcbs` is a TypeScript framework that brings the power of modern software development to electronics engineering. It allows you to design circuits using code, ensuring type safety, modularity, and easy version control.

This application was developed and tested with the help of AI, and it is specifically designed to support **AI-assisted electronics development**. By defining circuits in code, you can leverage AI tools (like GitHub Copilot or Cursor) to generate schematics, suggest components, and even write library definitions for you.

## Features

### 🔌 Schematic Generation
Define your connections in TypeScript and generate native **KiCad Schematics (`.kicad_sch`)** and Netlists (`.net`). The framework handles the boring parts of netlist generation so you can focus on the logic.

### 🔍 Parts Search
Includes a simple command-line tool to search the **JLCPCB Parts Library**.
*   Find available parts directly from your terminal.
*   Designed to be easily used by AI agents and tools like Cursor to find the right component for your design.

### 📚 Library Management
Manage your component library with code.
*   **Composable Subschematics**: Create reusable circuit blocks (e.g., a "5V Regulator" or "Microcontroller Minimal Setup") that can be instantiated multiple times.
*   **Modules**: Define physical components including **Symbols**, **Footprints**, and **3D Models** programmatically. No more drawing boxes in a GUI!

### 🏭 Export for Fabrication
One command to rule them all. The `export` tool generates everything you need for manufacturing at **JLCPCB**:
*   Gerber & Drill Files
*   BOM (Bill of Materials) with LCSC Part Numbers
*   CPL (Component Placement List) for PCBA
*   3D Renders of your board
*   Zips it all up ready for upload.

## Quick Start

Get up and running in less than 5 minutes.

### 1. Setup

```bash
mkdir my-project && cd my-project
npm init -y
npm install @tobisk/pcbs typescript ts-node
```

Create a `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

### 2. Create Your First Schematic

Create `src/schematics/MyBoard.ts`:

```typescript
import { Schematic, Component, Net } from "@tobisk/pcbs";

export class MyBoard extends Schematic {
  constructor() {
    super({ name: "MyBoard" });
  }

  generate() {
    const vcc = new Net({ name: "+5V", class: "Power" });
    const gnd = new Net({ name: "GND", class: "Power" });

    const led = new Component({
      symbol: "Device:LED",
      footprint: "LED_SMD:LED_0603_1608Metric",
      ref: "D1",
      value: "Green",
    });

    const resistor = new Component({
      symbol: "Device:R",
      footprint: "Resistor_SMD:R_0603_1608Metric",
      ref: "R1",
      value: "330",
    });

    // Wire it up
    resistor.pins[1].tie(vcc);
    resistor.pins[2].tie(led.pins[1]);
    led.pins[2].tie(gnd);
  }
}

export default new MyBoard();
```

### 3. Generate, Search, and Export

**Generate KiCad Files:**
```bash
npx pcbs synth src/schematics/MyBoard.ts
```
This creates `src/schematics/MyBoard/MyBoard.kicad_sch`. Open it in KiCad!

**Search for Parts:**
Need a specific part number?
```bash
npx pcbs parts --footprint "SOIC-8" --value "10k"
```

**Export for Manufacturing:**
Ready to order?
```bash
npx pcbs export src/schematics/MyBoard.ts
```
Generates a ZIP file with Gerbers, BOM, and CPL ready for JLCPCB.

## Documentation

Full documentation is available in the **[Wiki](docs/Home.md)**:

*   **[Quick Start Guide](docs/QuickStart.md)**: Detailed guide.
*   **[API Documentation](docs/Schematic.md)**: Learn about `Schematic`, `Component`, `Net`, and `Composable`.
*   **[CLI Reference](docs/CLI.md)**: detailed usage of `synth`, `parts`, `lib`, and `export`.

## Installation

```bash
npm install @tobisk/pcbs
```

## License

This project is licensed under the **MIT License**.
