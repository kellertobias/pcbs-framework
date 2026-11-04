# Net

The `Net` class represents an electrical connection (wire) in your schematic.

## Usage

```typescript
import { Net } from "@tobisk/pcbs";

const vcc = new Net({ name: "+5V", class: "Power" });

// Tie pins to net
vcc.tie(u1.pins[1]);
vcc.tie(r1.pins.VCC);
```

## Constructor

```typescript
new Net(options: {
  name: string;
  class?: string | NetClassDefinition; // Default: "Signal"
})
```

## Methods

### `tie(pinOrNet)`

Connects a `Pin` or another `Net` to this net.

**Behavior:**
*   If passed a `Pin`: Adds the pin to this net's connections.
*   If passed a `Net`: Merges the two nets. All pins connected to the other net are transferred to this one.

**Checks:**
*   Throws error if merging incompatible DNC (Do Not Connect) nets.
*   Throws error if connecting a DNC pin to a functional net with other functional connections.

### `pins` (Getter)

Returns a read-only array of all `Pin` objects connected to this net.

## Power Nets

Nets with `class: "Power"` are treated specially during schematic generation. They are rendered using power symbols (e.g., VCC, GND bars) instead of long wires across the page.

## Circuit-owned physical rules

Pass a definition from `defineNetClass` as the net's `class` to share trace width,
clearance and via rules across named nets. Used definitions and assignments are
collected into PCB rules and native project settings. Conflicting definitions
or incompatible classified-net merges throw instead of silently discarding rules.
See [circuit-owned net classes](OutputWorkflow.md#circuit-owned-net-classes) for
an example and the supported legacy declarations.
