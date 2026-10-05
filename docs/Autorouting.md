# PCB and schematic autorouting

The framework uses two local engines:

- [tscircuit capacity-autorouter](https://github.com/tscircuit/tscircuit-autorouter)
  for PCB paths, layer transitions, and vias (MIT).
- [libavoid-js](https://github.com/Aksem/libavoid-js) for orthogonal schematic
  wires around symbols (LGPL-2.1-or-later).

The dependencies are pinned. An isolated Node worker loads their ESM/WASM code;
no routing request is sent to a cloud service. Worker execution has a time and
step limit, and failure is reported rather than producing a straight-line fallback.

## PCB

```bash
npx pcb synth my_board --pcb sync
npx pcb route my_board                 # capacity backend; all unrouted nets
npx pcb capture-routing my_board       # persist actual copper in routing.json
```

Existing copper and source-declared exact routes remain protected. Replacing
manual copper requires an explicit `--reroute-net NET_NAME`. `--backend simple`
retains the earlier basic Manhattan implementation; `--all` includes unhinted
nets with that backend too. The programmatic API retains its existing opt-in
net selection: pass `{ backend: new CapacityRoutingBackend(), routeAll: true }`
to `runIncrementalRouting()`.

Set widths, clearances, and via dimensions in `pcb.netClasses`. Required support
points use `pcb.routeHints[].waypoints` in **board millimetres**:

```typescript
pcb: {
  outline: [/* board polygon */],
  netClasses: [{
    name: "Signals", nets: ["STATUS"], width: 0.25, clearance: 0.2,
    viaDiameter: 0.6, viaDrill: 0.3,
  }],
  routeHints: [{
    id: "status-path", nets: ["STATUS"],
    preferredLayers: ["F.Cu", "B.Cu"],
    waypoints: [{ x: 20, y: 15 }, { x: 40, y: 15 }],
    maxVias: 2,
  }],
}
```

Waypoints are enforced in order by routing independent legs. They are not soft
preferences that optimization may remove. With more than two pads, the support
points apply to the first connection; remaining pads are connected by a chain,
or by a star when `topology: "star"` is selected. PCB support points are fixed
on the first permitted layer. A single preferred layer prohibits layer changes.
Pad copper layers are taken from the actual board, including through-hole pads.

The adapter accounts for pads (including unconnected pads and mechanical
holes), existing tracks/vias/arcs, keepouts, and previously completed nets.
Rotated pads use conservative bounding rectangles; diagonal existing tracks
use short rectangular pieces, and existing arcs use a conservative circular
bound. Board lines, rectangles, arcs, and circles are read from `Edge.Cuts`.
Curves are polygonized at 0.2 mm intervals for checks with an additional edge
margin. Routed centerlines are checked against board boundaries and cutouts,
foreign copper clearance, allowed layers, corridor polygons, forbidden regions,
via limits, and configured length bounds before merging.

Routing is sequential across nets, with no rip-up of protected copper.
Conservative obstacle bounds can make a tight but physically possible route
fail. Unsupported differential routing and unsatisfied length targets fail
visibly; this backend does not provide impedance calculation or length tuning.
A failed net contributes no copper. Successful nets may still be written when
other nets fail, and the CLI returns a failure status. Every write has a board
backup and a route report. KiCad DRC runs when available; inspect its result.

## Schematic

Select native wire routing in the schematic source:

```typescript
super({
  name: "MyBoard",
  connectionStyle: "routed",
  schematicRouting: {
    routeHints: [{
      id: "status-wire", nets: ["STATUS"],
      waypoints: [{ x: 60, y: 40 }, { x: 90, y: 40 }],
    }],
  },
});
```

`schematicRouting` alone also enables routing. The support points use **sheet
millimetres**, independently of PCB coordinates. They are exact libavoid
checkpoints; off-grid points are supported and retained as wire vertices.
Wire serialization retains up to four decimal places. As on the PCB, hints
apply to the first connection of a multi-pin net. Keep explicit symbol placement
when support points are intended to follow a specific layout.

The engine avoids symbol bounds and reserves previous paths belonging to other
nets. Required points inside obstacles cause failure. Shared same-net branches
receive KiCad junctions. Ordinary power nets retain their conventional power
symbols; adding a routing hint to a power net requests wires for it as well.
Routing is batched into one worker invocation per schematic. An unresolved
hint or routing failure stops generation; required supports never silently turn
into label-only connections. `direct-labels` is incompatible with
`schematicRouting`.

The old `--experimental-routing` option now uses libavoid too, retaining its
label fallback for unconstrained failures. Prefer `connectionStyle: "routed"`
for strict routing. Label-based schematic generation remains the default.

### Wired circuitry with labelled external connectors

Set `connectionStyle: 'routed'`, `placementAlgorithm: 'none'`, and
`schematicRouting.interfaceComponents: ['J1', 'J2']` for an authored flat circuit.
The generator physically wires all internal connections, including the internal
branches of nets exposed on connectors. It places labels only at the connector
boundary and where each interface net joins the internal drawing. A purely
internal net never receives a label, and routing failures fail synthesis.
`placementAlgorithm: 'none'` preserves the declared coordinates exactly.

`schematicRouting.symbolOverrides` accepts framework `KicadSymbol` definitions
keyed by the original qualified symbol name. This allows functional pin grouping
in the drawing without changing physical pin numbers; changed pin numbers are
rejected. Definitions are embedded in the generated schematic. KiCad can report
a library-symbol mismatch against the original library drawing.
Use `annotations: [{ text, x, y, size }]` for sheet headings and
`hideValues: ['J1', 'TP1']` to suppress redundant generic symbol values.
Keep these drawing decisions in the board's `schematic-routing.ts` and supporting
TypeScript files. Circuit wiring remains in the main board file.

### Readable local power connections

With `interfaceComponents`, `powerSymbols` maps circuit nets to native KiCad power
symbols (for example `{ GND: 'power:GND', LOGIC_3V3: 'power:+3V3' }`). The drawing
retains the circuit net name. `powerGroups` joins selected physical terminals with
short local wires, then connects the branch through a power symbol; other supply
terminals receive their own glyphs. For example, use
`{ net: 'LOGIC_3V3', pins: ['U1.20', 'C1.1'] }` for a chip and its bypass capacitor.

`symbolClearance` reserves space outside symbol bodies and visible reference/value
fields. `pinEscape` sets the straight lead length before a routed wire can turn.
Use a lead longer than the body clearance. Collinear same-net wire retracing is
merged, with junctions preserved at power and interface anchors. Handwritten
`routeHints` can keep long connections around the edge of a circuit section.
Place conditioning capacitors beside their chip in `schematic-routing.ts`; their
physical PCB placement remains a separate decision in `pcb-routing.ts`.

A4/A3 routed drawings default to a hard 2 mm parallel wire gap. `wireClearance`
can set another explicit minimum. The final drawing is checked, including pin
leads; routing fails rather than reducing this minimum. Perpendicular crossings
remain possible without a junction. The router chooses short paths with fewer
bends, using a direction-aware visibility grid when native routing cannot meet
spacing. Power glyph bodies are reserved even against wires on the same net.
IC-to-IC connections form the main signal spine before test-point branches.
