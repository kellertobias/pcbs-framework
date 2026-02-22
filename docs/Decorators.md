# Decorators

Decorators allow you to add metadata to your schematic generation logic, helping with organization and layout.

## `@group(options)`

Assigns all components instantiated within the decorated method to a layout group. This is used by the `GravityLayout` algorithm to keep related components close together.

### Usage

```typescript
import { Schematic, Component, group } from "@tobisk/pcbs";

class MyBoard extends Schematic {
  generate() {
    this.createPowerSection();
    this.createMicrocontroller();
  }

  @group({ name: "Power" })
  private createPowerSection() {
    // All components created here will belong to group "Power"
    const regulator = new Component({ ... });
    const caps = new Component({ ... });
  }

  @group({ name: "MCU" })
  private createMicrocontroller() {
    const mcu = new Component({ ... });
  }
}
```

## `@subschematic(options)`

Assigns all components instantiated within the decorated method to a subschematic. This causes them to be rendered on a separate page in the generated PDF documentation (from `npx pcbs print`).

### Usage

```typescript
import { Schematic, subschematic } from "@tobisk/pcbs";

class MyBoard extends Schematic {
  generate() {
    this.createPowerSection();
  }

  @subschematic({ name: "Power Supply" })
  private createPowerSection() {
    // Components here appear on the "Power Supply" page
    // of the PDF schematic.
  }
}
```

You can combine decorators:

```typescript
  @group({ name: "Power" })
  @subschematic({ name: "Power Supply" })
  private createPowerSection() { ... }
```
