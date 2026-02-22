# Kicad3DModel

The `Kicad3DModel` class provides a fluent API for creating parametric 3D models using OpenCascade.js. It allows you to build complex shapes by combining simple primitives (box, sphere, cylinder) with boolean operations (union, subtract, intersect).

## Usage

```typescript
import { Kicad3DModel } from "@tobisk/pcbs";

const model = new Kicad3DModel({ unit: "mm" });

// Create a box
const body = model.box({ x: 10, y: 15, z: 2, center: true })
  .color("#1f4fa3"); // Blue

// Create a cylinder
const pin = model.cylinder({ r: 0.5, h: 4 })
  .translate({ x: 0, y: 0, z: -2 })
  .color("#ffd700"); // Gold

// Combine them
model.union(body, pin);

// Export to VRML/STEP
await model.export({
  outDir: "./3d_models",
  baseName: "My_Connector",
  formats: ["wrl", "step"]
});
```

## Constructor

```typescript
new Kicad3DModel(options: {
  unit?: "mm";
  rotX?: number; // Rotate entire model around X
  rotY?: number; // Rotate entire model around Y
  rotZ?: number; // Rotate entire model around Z
})
```

## Methods

### `box(options)`

Creates a box primitive.

**Options:**
*   `x`, `y`, `z`: Dimensions.
*   `center`: Boolean (true: centered at origin, false: corner at origin).

### `sphere(options)`

Creates a sphere primitive.

**Options:**
*   `r`: Radius.
*   `center`: Boolean (default true).

### `cylinder(options)`

Creates a cylinder primitive.

**Options:**
*   `r`: Radius.
*   `h`: Height.
*   `center`: Boolean (default true).

### `pipe(options)`

Creates a pipe (hollow cylinder).

**Options:**
*   `r`: Outer radius.
*   `wallThickness`: Thickness of the pipe wall.
*   `h`: Height.
*   `center`: Boolean.

### `union(a, b)`

Merges solid `b` into solid `a`. Modifies `a` in place and removes `b` from the model. returns the builder for `a`.

### `subtract(a, b)`

Subtracts solid `b` from solid `a`. Modifies `a` in place and removes `b` from the model. returns the builder for `a`.

### `intersect(a, b)`

Intersects solid `a` and solid `b`. Modifies `a` in place to be the common volume, removes `b` from the model. returns the builder for `a`.

### `export(options)`

Exports the model to disk.

**Options:**
*   `outDir`: Output directory path.
*   `baseName`: Base filename (without extension).
*   `formats`: Array of formats (`"wrl"`, `"step"`).

## SolidBuilder API

Methods on `Kicad3DModel` return a `SolidBuilder` which allows chaining transformations.

### `.translate({ x, y, z })`

Moves the solid by the given vector.

### `.rotate({ x, y, z })`

Rotates the solid around X, Y, Z axes (degrees).

### `.scale(factor | { x, y, z })`

Scales the solid uniformly or per-axis.

### `.color(hexString)`

Sets the color of the solid (e.g., `"#ff0000"`).

### `.fillet({ radius, edges? })`

Applies a fillet (rounded edge) to the solid.
*   `radius`: Fillet radius.
*   `edges`: `"all"` (default) or an array of edge indices.

### `.name(string)`

Sets a name for the solid (useful for debugging or VRML structure).
