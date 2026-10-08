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
The default requested page is A4, consistent with `Schematic`. Automatic layout
can grow to a larger sheet when the circuit and its notes cannot fit legibly;
changing the default does not scale text down or clip large groups.
Power glyphs remain upright: ground down, supplies up. Their orthogonal stubs
search clear lanes around existing fields, foreign pins and boundary labels.
Already drawn stubs participate in subsequent router spacing constraints.

Circuit layout routes an initial placement, then tries two refinements using
actual emitted net lengths. Candidates consider all connected placed terminals,
not just the first connection, and try passive rotations. Decouplers share an
aligned supply row. Test points are prioritized near connected devices in the
compact trial. Each completed drawing is scored for wire length, foreign-net
crossings and frame area. A trial is retained only if its cost improves without
additional readability warnings; routing failures retain the previous result.
`autoLayout.refine: false` disables refinement for a deterministic baseline.
`layoutReport.refinement` records passes, accepted trials and initial/final costs.
This bounded search is a heuristic, not a guarantee of the smallest drawing.

With `compactFields`, resistor references and values sit outside opposite sides
of the body. IC references and values sit above it with clearance. Generic
symbols can pass `annotation` to a side pin to draw capability text beneath its
plain electrical name; `addText` also supports left/right/center justification.

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

## Project header and reusable branding

Place a `pcb.config.json` at the project root to reuse branding across circuits:

```json
{
  "branding": {
    "company": "Your company",
    "logo": "assets/logo.svg"
  }
}
```

The nearest configuration above the working directory wins. Logo paths are
relative to that configuration. SVG and PNG logos are embedded in native KiCad
schematics and survive PDF export. Per-circuit `branding` options override the
project defaults. Use `projectName` for the project-box title, `description` for a
short explanation, and `schematicRevision: 1` for the internal drawing revision
(`R1`). The release `revision` remains independent. Automatic groups reserve a
bottom-right project box and select the smallest supported sheet that contains their frames;
A4 is the starting default, not a promise that a large circuit fits on one A4.

Placement refinements include compact resistor drawings, aligned supply shunts,
and direct test-point junctions. Each candidate is routed and scored; failed or
less readable candidates are rejected, with reasons in the ignored layout report.
Multi-pin connectors keep their native orientation rather than inheriting the
orientation of a ground pin. These rules use symbol geometry and nets, rather
than board-specific reference names or authored drawing coordinates.

The route score also accounts for drawing conventions: a rail shunt should be
vertical with power above or ground below, its signal terminal should align with
the device pin row, and a probe should sit at its device junction. These costs
prevent a small reduction in wire length from selecting a less readable layout.
Reported scores include the convention cost separately from wire length,
crossings and frame area. Sheet packing fills free columns below short groups,
while preserving explicit relative group relationships.

The generated `.kicad_wks` worksheet places the title at the top of the
project box, metadata below it, and a logo column at the right. It includes
KiCad version attribution with support from Tobias Media PCB Framework.
The project selects this worksheet in KiCad and the PDF command passes it
explicitly to native KiCad export.

Use `KicadSymbol.arrangePinGroup({ side: 'left', pins: ['1', '2'], startY: 20.32, pitch: 5.08 })`
for a drawing-only pin-group hint. Electrical names and physical numbers stay
unchanged; capability annotations move with their pins. The final placement
trial propagates each IC pin's left/right signal side through passive chains,
preventing feedback and filter networks from jumping across the device.

Adjacent pull resistors on one side of a device, sharing a rail, are recognized
as a bank when at least three device rows are neighbours (no gap above 15.24 mm).
The compact trial aligns the resistors horizontally, puts the rail on a shared
outside column, and keeps signal labels at the device side. Separated reset or
other pull resistors retain their individual supply glyphs. Bank reference and
value fields share a row above each resistor to avoid collisions at tight pin
spacing. IC reference/value fields align with the right edge above the body.

## Native functional pages

Set `autoLayout.pages: true` to produce an overview and one native child sheet per
functional group. All files stay in the board's `export/`, and native KiCad PDF
export produces one multipage document. The framework automatically chooses an
overview paper size that clears the title box, preserves physical component UUIDs
and scopes drawing identities per child sheet. Named global nets connect sections;
`externalNets` is inferred for each page so a one-terminal signal still reaches its
other page. Native KiCad netlist verification must compare the complete hierarchy
against the source circuit, including intentional no-connects.

A group may select `connectionStyle: 'direct-labels'` for repeated matrices or
interfaces. These use grid placement with supply-aware passive rotations, short
vertical escapes, upright supply glyphs and horizontal signal labels. Routed
sections can select `connectionStyle: 'routed'` and use the existing routing-informed
circuit layout. Empty groups are omitted. Every physical component belongs to one
group; split drawing units across pages are currently rejected explicitly.

The PDF title shows the board name, while section headings and native sheet names
identify individual functions. Generated library tables use paths relative to the
project output directory, so moving the project between computers keeps the library
links usable. Schematic page generation never requires changing PCB placement or
saved copper.
