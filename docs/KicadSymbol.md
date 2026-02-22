# KicadSymbol

The `KicadSymbol` class allows you to programmatically define KiCad schematic symbols (`.kicad_sym`).

## Usage

```typescript
import { KicadSymbol } from "@tobisk/pcbs";

const sym = new KicadSymbol({
  name: "My_Custom_Symbol",
  reference: "U",
  footprint: "Project_Footprints:My_Custom_Symbol"
});

// Add graphics
sym.addRect({ x1: -5.08, y1: 5.08, x2: 5.08, y2: -5.08 });

// Add pins
sym.addPin({
  name: "VCC",
  number: "1",
  x: 0,
  y: 7.62,
  side: "top",
  type: "power_in"
});

// Serialize to string
const content = sym.serialize();
```

## Constructor

```typescript
new KicadSymbol(options: {
  name: string;
  reference?: string; // Default: "U"
  footprint?: string; // Default: "DNC"
  description?: string;
  value?: string; // Default: name
})
```

## Methods

### `addPin(options)`

Adds a pin to the symbol.

**Options:**
*   `name`: Pin name (e.g., "VCC").
*   `number`: Pin number (e.g., "1").
*   `x`, `y`: Position coordinates (mm).
*   `side`: `"left" | "right" | "top" | "bottom"`.
*   `type`: `"input" | "output" | "power_in" | "power_out" | "bidirectional" | "passive" | "unconnected"`.
*   `style`: `"line" | "inverted" | "clock" | "inverted_clock"` (optional).
*   `length`: Pin length (optional, defaults to 2.54mm).

### `addRect(options)`

Adds a rectangle to the symbol's graphics.

**Options:**
*   `x1`, `y1`: Top-left corner.
*   `x2`, `y2`: Bottom-right corner.
*   `fill`: `"none" | "background"` (optional).
*   `strokeWidth`: Line width (optional).

### `addText(options)`

Adds text to the symbol's graphics.

**Options:**
*   `text`: The string to display.
*   `x`, `y`: Position.
*   `fontSize`: Font size (default: 1.27mm).

### `serialize()`

Returns the KiCad S-Expression string for the symbol. This output is suitable for embedding in a `.kicad_sym` library file.
