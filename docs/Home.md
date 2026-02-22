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

## Documentation

Full documentation is available in the Wiki:

*   **[Quick Start Guide](QuickStart.md)**: Build your first "Blinky" circuit in minutes.
*   **[API Documentation](Schematic.md)**: Explore the detailed API reference.
*   **[CLI Reference](CLI.md)**: Usage of `synth`, `parts`, `lib`, and `export`.

## Installation

```bash
npm install @tobisk/pcbs
```

## License

This project is licensed under the **MIT License**.
