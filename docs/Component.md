# Component

The `Component` class represents a single electronic component in your schematic.

## Usage

```typescript
import { Component } from "@tobisk/pcbs";

const r1 = new Component({
  symbol: "Device:R",
  footprint: "Resistor_SMD:R_0603_1608Metric",
  ref: "R1",
  value: "10k",
});

// Access pins by number
r1.pins[1].tie(netA);

// Access pins by name (using mapping)
const u1 = new Component({
  // ...
  pins: (pin) => ({
    VCC: pin(1),
    GND: pin(2),
  }),
});

u1.pins.VCC.tie(netVCC);
```

## Constructor

```typescript
new Component(options: {
  symbol: string;
  footprint: string;
  ref: string;
  value?: string;
  description?: string;
  partNo?: string;
  pins?: (pin: (n: string | number) => Pin) => Record<string, Pin>;
})
```

## Properties

*   `symbol`: KiCad symbol identifier.
*   `footprint`: KiCad footprint identifier.
*   `ref`: Reference designator.
*   `value`: Component value.
*   `description`: Description string.
*   `partNo`: Manufacturer Part Number (MPN) or LCSC Part Number.

## Methods

### `pins` (Property)

A proxy object that allows accessing pins by number or name.

*   `component.pins[1]`: Returns the `Pin` object for pin 1.
*   `component.pins.VCC`: Returns the `Pin` object for the mapped pin named "VCC".

**`pin.tie(target)`**
Connects the pin to a `Net` or another `Pin`.

**`pin.dnc(reason?)`**
Explicitly marks the pin as "Do Not Connect". This suppresses warnings about unconnected pins and adds a visual "No Connect" marker (X) in the schematic.

```typescript
// Mark pin 5 as unused
u1.pins[5].dnc("Not used in this design");
```

### `power(mapping)`

Helper to connect multiple power pins at once.

```typescript
u1.power({
  VCC: vccNet,
  GND: gndNet,
});
```

### `absoluteSchematicPosition` (Getter)

Returns the calculated absolute position on the schematic page, accounting for parent `Composable` positions and rotations.

### `absolutePcbPosition` (Getter)

Returns the calculated absolute position on the PCB, accounting for parent `Composable` positions and rotations.
