# Module

The `Module` class represents a physical component or breakout board that has its own footprint and symbol, and potentially a 3D model. Unlike a simple `Component`, a `Module` defines its own library assets programmatically.

## Usage

Extend `Module` and implement static methods `makeSymbol`, `makeFootprint`, and optionally `make3DModel`.

```typescript
import { Module, KicadSymbol, KicadFootprint, Kicad3DModel } from "@tobisk/pcbs";

class CustomModule extends Module<"VCC" | "GND" | "SIG"> {
  constructor() {
    super({
      symbol: "Project_Symbols:Custom_Module",
      ref: "U",
      footprint: "Project_Footprints:Custom_Module",
      description: "My custom module",
      pins: (pin) => ({
        VCC: pin(1),
        GND: pin(2),
        SIG: pin(3),
      }),
    });
  }

  static makeSymbol(): KicadSymbol {
    const sym = new KicadSymbol({ name: "Custom_Module", reference: "U" });
    sym.addPin({ name: "VCC", number: "1", x: 0, y: 5.08, side: "top", type: "power_in" });
    // ...
    return sym;
  }

  static makeFootprint(): KicadFootprint {
    const fp = new KicadFootprint({ name: "Custom_Module" });
    fp.addPad({ number: "1", type: "thru_hole", shape: "circle", x: 0, y: 0, width: 1.5, height: 1.5 });
    // ...
    return fp;
  }

  static async make3DModel(): Promise<Kicad3DModel> {
    const model = new Kicad3DModel({ unit: "mm" });
    model.box({ x: 10, y: 10, z: 2 });
    return model;
  }
}
```

## Constructor

Identical to `Component`, but usually called with hardcoded values for `symbol` and `footprint` since the module defines them.

## Static Methods

### `makeSymbol()`

**Abstract.** Must return a `KicadSymbol` instance.

### `makeFootprint()`

**Abstract.** Must return a `KicadFootprint` instance.

### `make3DModel()`

**Optional.** Can return a `Kicad3DModel` instance or a promise resolving to one. If implemented, the `lib` command will generate the 3D model file and link it to the footprint.
