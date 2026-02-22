# API Documentation

This section provides detailed documentation for the core classes and methods available in the `@tobisk/pcbs` framework.

## Schematic

The `Schematic` class is the entry point for your design. It represents a single PCB project.

### Usage

Extend the `Schematic` class and implement the `generate()` method.

```typescript
import { Schematic } from "@tobisk/pcbs";

class MyBoard extends Schematic {
  constructor() {
    super({
      name: "My_Board",
      size: "A4", // "A4", "A3", etc.
      author: "Your Name",
      revision: "v1.0"
    });
  }

  generate() {
    // Define your circuit here
  }
}

export default new MyBoard();
```

### Properties

*   `name`: The name of the project.
*   `size`: Paper size for the schematic (default: "A4").
*   `author`: Author name.
*   `revision`: Revision string.

## Component

Represents a generic electronic component (resistor, capacitor, IC, etc.).

### Usage

```typescript
import { Component } from "@tobisk/pcbs";

const r1 = new Component({
  symbol: "Device:R",
  footprint: "Resistor_SMD:R_0603_1608Metric",
  ref: "R1",
  value: "10k",
});
```

### Options

*   `symbol`: The KiCad symbol identifier (e.g., `Device:R`).
*   `footprint`: The KiCad footprint identifier.
*   `ref`: Reference designator (e.g., `R1`, `U1`).
*   `value`: Component value (e.g., `10k`, `100nF`).
*   `pins`: Optional mapping for named pins.

### Connecting Pins

You can access pins by number or name.

```typescript
// By number (1-based index)
r1.pins[1].tie(someNet);

// By name (if defined in options)
// component.pins.VCC.tie(powerNet);
```

## Net

Represents an electrical connection between component pins.

### Usage

```typescript
import { Net } from "@tobisk/pcbs";

const vcc = new Net({ name: "+5V", class: "Power" });
const signal = new Net({ name: "DATA" });

// Connect pins to the net
signal.tie(pin1);
signal.tie(pin2);
```

### Options

*   `name`: The name of the net.
*   `class`: Optional class (e.g., "Power"). Power nets are often rendered with special symbols.

## Composable

`Composable` allows you to create reusable sub-circuits (logic blocks) that can be instantiated multiple times.

### Usage

Extend `Composable` and implement `defineInterface()`.

```typescript
import { Composable, Component, Net, PinAssignable } from "@tobisk/pcbs";

// Define the interface types (pin names)
type MyBlockPins = "IN" | "OUT" | "GND";

class VoltageDivider extends Composable<MyBlockPins> {
  constructor(options: { ref: string; ratio: number }) {
    super({ ref: options.ref });
    // logic to use options.ratio...
  }

  protected defineInterface(): Record<MyBlockPins, PinAssignable> {
    const r1 = new Component({ ... });
    const r2 = new Component({ ... });
    const mid = new Net();

    mid.tie(r1.pins[2]);
    mid.tie(r2.pins[1]);

    return {
      IN: r1.pins[1],
      OUT: mid, // Can return a Net (creates a bridge pin)
      GND: r2.pins[2]
    };
  }
}
```

### Subschematics

You can render a `Composable` on a separate schematic page using `makeSubschematic()`.

```typescript
class MyComplexBlock extends Composable {
  constructor() {
    super({ ref: "SUB1" });
    this.makeSubschematic({ name: "Complex Block Logic" });
  }
  // ...
}
```

## Module

`Module` represents a physical component or breakout board that has its own footprint and symbol, and potentially a 3D model. Unlike `Component`, `Module` allows you to define the symbol and footprint programmatically.

### Usage

Extend `Module` and implement static methods `makeSymbol` and `makeFootprint`.

```typescript
import { Module, KicadSymbol, KicadFootprint } from "@tobisk/pcbs";

class CustomModule extends Module {
  static makeSymbol(): KicadSymbol {
    // Return a KicadSymbol instance
  }

  static makeFootprint(): KicadFootprint {
    // Return a KicadFootprint instance
  }

  static async make3DModel() {
    // Optional: Return a 3D model
  }
}
```

Modules are located in `src/module/` and can be used to generate a project-specific KiCad library using the `lib` CLI command.
