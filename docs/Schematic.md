# Schematic

The `Schematic` class is the core of your design. It represents a single PCB project and contains all the logic for wiring components together.

## Usage

Extend the `Schematic` class and implement the `generate()` method.

```typescript
import { Schematic } from "@tobisk/pcbs";

class MyBoard extends Schematic {
  constructor() {
    super({
      name: "My_Board",
      size: "A4",
      author: "Your Name",
      revision: "v1.0"
    });
  }

  generate() {
    // Define your circuit here
    const vcc = new Net({ name: "VCC", class: "Power" });
    const gnd = new Net({ name: "GND", class: "Power" });
    // ...
  }
}

export default new MyBoard();
```

## Constructor

```typescript
new Schematic(options: {
  name: string;
  size?: "A4" | "A3" | "A2" | "A1" | "A0" | "User"; // Default: "A4"
  author?: string;
  company?: string;
  revision?: string; // Default: "v1.0"
  description?: string;
  layout?: Layout; // Optional layout algorithm
  placementAlgorithm?: PlacementAlgorithm; // "default" | "gravity"
})
```

## Methods

### `generate()`

**Abstract.** You must implement this method. Inside `generate()`, you instantiate `Component`, `Net`, `Composable`, and `Module` instances and wire them together.

### `_generateWithCapture()` (Internal)

Used by the CLI to execute the `generate()` method while capturing all registered components and nets for synthesis.

## Properties

*   `name`: The name of the project.
*   `size`: Paper size.
*   `author`: Author name.
*   `company`: Company name.
*   `revision`: Revision string.
*   `description`: Description string.
