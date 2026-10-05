# Declarative PCB generation

PCB mechanics can be owned directly by the TypeScript schematic. Legacy
rectangular/polygon boards can continue to use `outline`; new boards can use
named contours and explicit primitives:

```ts
pcb: {
  thickness: 1.6,
  contours: [{
    id: "outer",
    edges: [
      { kind: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { kind: "arc", start: { x: 100, y: 0 }, mid: { x: 105, y: 5 }, end: { x: 100, y: 10 } },
      // Complete the closed contour...
    ],
  }],
  cutouts: [{
    id: "display",
    points: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 30 }, { x: 10, y: 30 }],
  }],
  slots: [{ id: "fader-1", start: { x: 70, y: 10 }, end: { x: 70, y: 70 }, width: 3 }],
  mountingHoles: [{ id: "top-left", at: { x: 5, y: 5 }, drill: 3.2 }],
  keepouts: [{
    id: "antenna",
    points: [{ x: 80, y: 5 }, { x: 95, y: 5 }, { x: 95, y: 25 }, { x: 80, y: 25 }],
  }],
  stackup: { copperFinish: "ENIG", dielectricMaterial: "FR4" },
  netClasses: [{
    name: "USB",
    nets: ["USB_D+", "USB_D-"],
    width: 0.2,
    clearance: 0.2,
    diffPairWidth: 0.2,
    diffPairGap: 0.18,
    preferredLayers: ["F.Cu"],
    length: { target: 50, tolerance: 2 },
  }],
  zones: [{
    id: "ground-plane",
    net: "GND",
    layer: "B.Cu",
    boardInset: 0.5,
    clearance: 0.3,
    thermalGap: 0.4,
    thermalBridgeWidth: 0.5,
  }],
  routeHints: [{
    id: "usb-data",
    nets: ["USB_D+", "USB_D-"],
    preferredLayers: ["F.Cu"],
    corridors: [[
      { x: 10, y: 40 }, { x: 90, y: 40 },
      { x: 90, y: 50 }, { x: 10, y: 50 },
    ]],
    forbiddenRegions: [[
      { x: 45, y: 42 }, { x: 55, y: 42 },
      { x: 55, y: 48 }, { x: 45, y: 48 },
    ]],
    waypoints: [{ x: 30, y: 45 }, { x: 70, y: 45 }],
    maxVias: 0,
    topology: "point-to-point",
    differential: { positive: "USB_D+", negative: "USB_D-", gap: 0.18, maxSkew: 0.5 },
  }],
  exactRoutes: [{
    id: "critical-signal",
    net: "SIGNAL",
    width: 0.3,
    segments: [{
      id: "from-source",
      start: { ref: "U1", pad: "1" },
      end: { x: 50, y: 60 },
      layer: "F.Cu",
    }, {
      id: "to-destination",
      start: { x: 54, y: 60 },
      end: { ref: "U2", pad: "3" },
      layer: "B.Cu",
    }],
    arcs: [{
      id: "rounded-bend",
      start: { x: 50, y: 60 },
      mid: { x: 52, y: 62 },
      end: { x: 54, y: 60 },
      layer: "F.Cu",
    }],
    vias: [{
      id: "layer-change",
      at: { x: 54, y: 60 },
      fromLayer: "F.Cu",
      toLayer: "B.Cu",
      diameter: 0.8,
      drill: 0.4,
    }],
  }],
}
```

Every generated footprint and mechanical primitive receives a stable UUID.
Footprints also carry a hidden `TSPCB.ManagedId` property. `--pcb sync` uses
these identities to update declared objects and leaves manual KiCad artwork,
unknown footprints, tracks, vias, and zones intact.

Mounting holes are emitted as built-in managed footprints so they remain
compatible with KiCad's footprint and drill workflows. A hole is NPTH by
default; set `plated: true` and provide an annular `diameter` for a plated hole.

Net classes are synchronized into the KiCad project without deleting unrelated
manual classes or custom rules. Layer restrictions and length targets are kept
in a marked managed section of the project's `.kicad_dru` file.

Copper-zone declarations own their outline and settings, not KiCad's transient
`filled_polygon` cache. Synthesis reports `PCB_ZONES_REQUIRE_REFILL`; open and
save the board in KiCad or run a KiCad headless operation that refills zones
before producing fabrication output. Unowned manual zones remain untouched.

## Routing intent and exact copper

`routeHints` describe constraints for a future or external routing backend. They
are attached to named nets and can express preferred layers, allowed corridors,
forbidden regions, waypoints, via limits, topology, length targets, and
differential-pair requirements. Hints never create copper by themselves. They
are exported to `<board>.pcb-intent.json`, so a backend can consume the intent
without scraping the generated KiCad file.

`exactRoutes` are authoritative copper declarations for critical connections.
Endpoints may use exact board coordinates or `{ ref, pad }` references. Pad
references are resolved after footprint placement and checked against the
route's net. Segments, arcs, and vias receive stable UUIDs, allowing `--pcb
sync` to update those declarations while preserving every unowned manual track,
arc, and via.

Generation rejects unresolved pads, unknown nets, invalid copper layers,
zero-length segments, collinear arcs, and impossible via definitions. A route
that violates a matching hint remains visible for review and produces a
machine-readable `PCB_ROUTE_CONSTRAINT_VIOLATION` warning in the sync report.
This separates invalid geometry (which stops generation) from design intent
that a human or autorouter may still need to reconcile.

## Incremental autorouting

The replaceable `RoutingBackend` interface receives pad locations, board
snapshot data, net classes, and route hints. `runIncrementalRouting()` and the
`route` CLI command provide the local tscircuit `CapacityRoutingBackend`; the
programmatic API retains `SimpleRoutingBackend` as its compatibility default.
See [PCB and schematic autorouting](Autorouting.md) for strict support points. Ordinary synthesis
does not load or invoke a router, so routing remains optional.

The initial simple backend is for uncomplicated low-speed nets. The capacity CLI backend includes all unrouted nets; the simple backend uses
hinted nets unless `--all` is specified. Existing manual copper and every
framework-owned `exactRoute` are skipped. Replacing existing copper requires an
explicit `rerouteNets` selection (or repeated `--reroute-net` flags); a complete
timestamped PCB backup is created before replacement. Completed, skipped,
failed, and constraint-violating nets are recorded separately in
`<board>.route-report.json`.

Routing completion is not fabrication approval. The framework runs KiCad DRC
when available and always marks the report as requiring human review. In
particular, review and normally hand-route:

- analogue inputs and references for noise coupling, grounding, filtering, and
  return-current paths;
- high-current motor, PWM, power-entry, and connector routes for copper width,
  temperature rise, protection, and fault current;
- USB pairs for impedance, pair spacing, skew, reference-plane continuity, ESD,
  and connector transitions;
- DMX/RS-485 pairs for differential geometry, termination, isolation, ESD, and
  connector/chassis grounding.

The built-in router reports differential and unsupported topology requirements
as constraint violations. Use exact routes, manual KiCad routing, or a future
specialized backend for those nets.

## Full placement and persistent routing

All physical parts can be placed through `Component.pcbPosition`; set
`pcb.requireAllPlaced: true` to reject any missing placement, excluded reference,
or unresolved footprint. Set `pcb.refreshFootprints: true` when `--pcb sync`
should also replace declared footprint geometry from the current library.
This replaces edits inside those declared footprints; ordinary sync retains
existing footprint geometry.

After routing in KiCad or with `pcb route`, capture the actual copper before
changing placements or footprints:

```bash
npx pcb capture-routing my_board
npx pcb synth my_board --pcb sync
# Or regenerate from source and saved copper (the prior PCB is backed up):
npx pcb synth my_board --pcb rebuild
```

`capture-routing` writes `routing.json` beside the board. Choose a different
filename with `pcb.routingFile: "my_board.routing.json"` (relative to the board
output directory). An explicitly configured missing file stops generation.
Synthesis automatically reads an existing default `routing.json` and never
rewrites it. Commit this file alongside the TypeScript source and `uuids.json`.
Each file is tied to a board name and schema version:

```json
{
  "version": 1,
  "board": "MyBoard",
  "routes": [{
    "id": "status",
    "net": "STATUS",
    "segments": [{
      "id": "to-led",
      "start": { "ref": "R1", "pad": "2" },
      "end": { "ref": "D1", "pad": "1" },
      "layer": "F.Cu",
      "width": 0.25
    }]
  }]
}
```

Saved routes use the same segment, arc, and via structure as `exactRoutes`.
Capture preserves the original KiCad UUIDs, so syncing captured tracks updates
the existing objects instead of duplicating them. Endpoints exactly coincident
with an unambiguous connected pad become `{ ref, pad }` anchors. Endpoints at
module interfaces become `{ module, port }` anchors. Anchors resolve against
current footprint geometry and placement on every generation. Other points
remain fixed board coordinates. Capture includes copper on both layers and
through vias; unsupported layers or unnamed nets stop capture rather than
silently dropping copper. Previous routing files are backed up before replacement.

Source-declared copper, including module internals, is excluded from CLI capture;
it continues to be owned by its source declarations. `captureRouting()` also
provides a programmatic capture API, with optional handoffs and excluded UUIDs.
Saved copper is protected from the incremental autorouter just like inline
exact routes.

The generated `<board>.pcb-routing-state.json` records copper ownership for
synchronization. Keep it with an existing board: sync removes previously owned
tracks deleted from declarations, while retaining unrelated manual copper.
`--pcb preserve` neither loads routing nor changes the board.

Moving an anchor preserves the route definition, but may stretch its adjoining
segment or arc. Fixed bends do not automatically move or reroute. Changing pad
numbers or net names requires updating the saved references. Inspect the result
and run KiCad DRC after placement or footprint changes.

## Modules with internal placement, copper, and handoffs

Extend `RoutedComposable<Ports>` for a reusable physical circuit. Its children
use **module-local** PCB positions. `defineRouting()` returns local copper and
one named handoff point for each electrical interface port. The complete block
translates, rotates, and mirrors with its PCB origin; copper layers flip when
placed on the back. Existing `Composable` placement semantics remain available.

```typescript
import {
  Component, Net, RoutedComposable, ModuleRouting,
} from "@tobisk/pcbs";

class Divider extends RoutedComposable<"IN" | "OUT" | "GND"> {
  private top!: Component;
  private bottom!: Component;

  protected defineInterface() {
    this.top = new Component({
      ref: `${this.ref}R1`, symbol: "Device:R",
      footprint: "Resistor_SMD:R_0603_1608Metric", value: "10k",
      pcbPosition: { x: 4, y: 4 },
    });
    this.bottom = new Component({
      ref: `${this.ref}R2`, symbol: "Device:R",
      footprint: "Resistor_SMD:R_0603_1608Metric", value: "10k",
      pcbPosition: { x: 4, y: 10 },
    });
    this.top.pins[2].tie(this.bottom.pins[1]);
    return {
      IN: this.top.pins[1], OUT: this.top.pins[2], GND: this.bottom.pins[2],
    };
  }

  protected defineRouting(): ModuleRouting<"IN" | "OUT" | "GND"> {
    return {
      routes: [{
        id: "input", net: this.top.pins[1],
        segments: [{ start: { ref: this.top.ref, pad: "1" },
          end: { x: 0, y: 4 }, layer: "F.Cu" }],
      }, {
        id: "divider-output", net: this.top.pins[2],
        segments: [{ start: { ref: this.top.ref, pad: "2" },
          end: { ref: this.bottom.ref, pad: "1" }, layer: "F.Cu" },
          { start: { ref: this.top.ref, pad: "2" },
            end: { x: 8, y: 7 }, layer: "F.Cu" }],
      }, {
        id: "ground", net: this.bottom.pins[2],
        segments: [{ start: { ref: this.bottom.ref, pad: "2" },
          end: { x: 0, y: 10 }, layer: "F.Cu" }],
      }],
      handoffs: {
        IN: { at: { x: 0, y: 4 }, layer: "F.Cu" },
        OUT: { at: { x: 8, y: 7 }, layer: "F.Cu" },
        GND: { at: { x: 0, y: 10 }, layer: "F.Cu" },
      },
    };
  }
}

// Inside Schematic.generate():
const divider = new Divider({ ref: "DIV1", pcbPosition: { x: 30, y: 20, rotation: 90 } });
new Net({ name: "INPUT" }).tie(divider.pins.IN);
new Net({ name: "ADC_INPUT" }).tie(divider.pins.OUT);
new Net({ name: "GND" }).tie(divider.pins.GND);
```

An external exact route can start or end at
`{ module: "DIV1", port: "OUT" }`. Its net and layer must match that interface.
Routes are namespaced by module reference (`DIV1/divider-output`), and electrical
net names are resolved after the entire circuit is connected. Use unique module
and component references for repeated instances. Routed modules can nest with
local origins; modules without any placed ancestor generate only their circuit.
The example illustrates the API; choose internal trace geometry appropriate to
the actual circuit and validate clearances in KiCad.
