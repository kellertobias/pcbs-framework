# Automatic functional-group schematics

A circuit can now supply group membership and explanations, without individual
component coordinates, branch-placement recipes or label offsets:

```ts
snapshot.schematicRouting = {
    autoLayout: {
        algorithm: 'circuit',
        groups: [
            { id: 'logic', title: 'CONTROLLER', components: ['U1', 'R1', 'C1', 'J1'] },
            {
                id: 'motor',
                title: 'MOTOR DRIVER',
                components: ['U2', 'RV1/2', 'C7', 'R13'],
                notes: ['Coast during manual input; qualify returned-energy VM peaks.'],
            },
            { id: 'position', title: 'FADER TRACK', components: ['RV1/1'] },
        ],
    },
    units: { RV1: [{ unit: 1 }, { unit: 2 }] },
    interfaceComponents: ['J1'],
    powerSymbols: { GND: 'power:GND', VCC: 'power:+3V3' },
    compactFields: true,
};
```

Include every drawing in exactly one group. A split drawing uses `reference/unit`
keys; its circuit, footprint and BOM still contain one physical component.
Unit positions can be omitted in automatic mode. Explicit fields, branch recipes
and route hints are rejected when combined with automatic groups. Capture-time
positions are ignored for these drawings, without mutating the source snapshot.

The framework generates positions and rotations, native internal wires,
boundary net labels, local power symbols, group boxes, headings and notes.
Connector interfaces keep their labels. Internal group networks remain wired;
only connections crossing a functional boundary receive labels. Native KiCad
netlist export must verify the resulting electrical partitions.

## Implementations

`grid` is a deterministic baseline. `circuit` places the most connected/high-pin
count device first, then follows electrical connections and native pin sides.
Common supply nets are excluded from signal connectivity; both `Power` net
classes and `powerSymbols` identify supplies. Two-pin series parts follow the
signal direction; shunts and pull resistors use vertical branches; power-only
bypass parts occupy a local supply row. Candidate positions reserve symbol,
field and terminal space and avoid occupied envelopes.

Groups are packed by height into a sheet, growing from the requested paper size
through A0 if necessary. Every generated origin lies on the 2.54 mm grid;
off-grid normalization would otherwise introduce native KiCad pin/wire gaps.
The wire router stays inside group interiors and avoids the heading/note areas.
Closely spaced power pins on the same device side share a glyph. Side-facing
power pins use inline glyphs to keep labels out of neighbouring signal lanes.

The generator exposes `layoutReport`. Synthesis saves
`<name>-schematic-layout.json`, containing group bounds, generated positions,
selected paper, algorithm, warnings and estimated signal connection length.
The estimate is the sum of per-net bounding-box half-perimeters within groups;
it is not actual routed wire length or an electrical quality measurement.

This is a heuristic first implementation, not an optimal-layout guarantee.
Dense groups can produce a larger page and longer local wires than a skilled
human layout. Review the native rendering and generation warnings. Existing
manual layouts remain available for other schematics. PCB placement and copper
routing are independent of this drawing feature.

## Research and design rationale

- [ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
  supports layered layout, fixed port constraints, orthogonal routing and
  compound graphs. It demonstrates the value of groups and pin sides. This
  implementation uses the existing synchronous framework/router, rather than
  adding ELK as a runtime dependency.
- [SPAR](https://ieeexplore.ieee.org/document/238032/)
  separates netlist partitioning, placement, global/local routing and interface
  presentation, with functional identification and traceability as objectives.
- [Weave](https://arxiv.org/abs/2607.03835)
  combines deterministic layered schematic layout with round-trip connectivity
  verification. Our native KiCad tests compare exact circuit-pin partitions,
  independently of visual/layout estimates.

The motor-fader board is the integration fixture: both `grid` and `circuit`
are generated with no individual authored coordinates and must preserve all
33 original circuit nets, including both units of RV1. The comparison artifact
records their page sizes, estimated lengths and native verification results.
