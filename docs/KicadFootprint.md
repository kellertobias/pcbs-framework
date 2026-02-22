# KicadFootprint

The `KicadFootprint` class allows you to programmatically define KiCad footprints (`.kicad_mod`). It provides a fluent API to add pads, lines, arcs, text, and 3D models.

## Usage

```typescript
import { KicadFootprint } from "@tobisk/pcbs";

const fp = new KicadFootprint({ name: "My_Custom_Footprint", attr: "smd" });

// Add pads
fp.addPad({
  number: "1",
  type: "smd",
  shape: "roundrect",
  x: -1.27,
  y: 0,
  width: 1.5,
  height: 2.0
});

// Add graphics
fp.addLine({ x1: -2, y1: -2, x2: 2, y2: -2, layer: "F.SilkS" });

// Serialize to string
const content = fp.serialize();
```

## Constructor

```typescript
new KicadFootprint(options: {
  name: string;
  layer?: FootprintLayer; // Default: "F.Cu"
  attr?: "through_hole" | "smd"; // Default: "smd"
})
```

## Methods

### `addPad(options)`

Adds a pad to the footprint.

**Options:**
*   `number`: Pin number (string).
*   `type`: `"smd" | "thru_hole" | "np_thru_hole"`.
*   `shape`: `"roundrect" | "circle" | "rect" | "oval"`.
*   `x`, `y`: Position coordinates (mm).
*   `width`, `height`: Pad size (mm).
*   `layers`: Array of layer names (optional, defaults based on type).
*   `drill`: Drill diameter (number) or oval dimensions (`{x, y}`).
*   `roundrectRatio`: Corner radius ratio (0-1) for roundrect pads.

### `addLine(options)`

Adds a line segment.

**Options:**
*   `x1`, `y1`: Start coordinates.
*   `x2`, `y2`: End coordinates.
*   `layer`: Layer name (default: "F.SilkS").
*   `width`: Line width (default: 0.15).

### `addRect(options)`

Adds a rectangle (rendered as 4 lines).

**Options:**
*   `x1`, `y1`: Top-left corner.
*   `x2`, `y2`: Bottom-right corner.
*   `layer`: Layer name (default: "F.SilkS").
*   `width`: Line width (default: 0.15).

### `addArc(options)`

Adds an arc.

**Options:**
*   `start`: `{x, y}` coordinates.
*   `mid`: `{x, y}` coordinates.
*   `end`: `{x, y}` coordinates.
*   `layer`: Layer name.
*   `width`: Line width.

### `addText(options)`

Adds text to the footprint.

**Options:**
*   `text`: The string to display.
*   `x`, `y`: Position.
*   `layer`: Layer name.
*   `fontSize`: Font size (default: 1).
*   `thickness`: Font thickness (default: 0.1).
*   `justify`: Text justification (`"left" | "right" | "top" | "bottom"`).

### `set3DModel(link)` / `add3DModel(link)`

Links a 3D model file (VRML/STEP) to the footprint.

**Options (`link`):**
*   `path`: Relative path to the 3D model file.
*   `offset`: `{x, y, z}` offset.
*   `scale`: `{x, y, z}` scale.
*   `rotate`: `{x, y, z}` rotation (degrees).

### `addExternal3DModel(baseDir, relativePath, options?)`

Helper to link a 3D model using an absolute path resolved from `baseDir` (e.g., `__dirname`). This is useful when your 3D models are source files and you want the footprint to reference them correctly during local development.

### `serialize()`

Returns the KiCad S-Expression string for the footprint.

### `writeFile(prettyDir)`

Writes the footprint to a file inside the specified `.pretty` directory. Returns the full file path.
