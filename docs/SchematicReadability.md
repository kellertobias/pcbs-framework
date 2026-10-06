# Schematic field placement and readability

For group membership without component coordinates, see
[Automatic functional-group schematics](AutomaticSchematicLayout.md).

The generator emits `SCHEMATIC_*` warnings with the affected references, sheet
coordinates and suggested corrections. The CLI displays them during synthesis,
and `SchematicGenerator.warnings` / the generator result retain them for tests
and automation. Warnings are enabled by default. They do not change electrical
connectivity or prevent generation.

The checks include visible field/text collisions, text overlapping symbol or
power-glyph geometry, wires crossing text, and wires crossing pin interiors.
Native symbol units, rotations, hidden fields, multiline notes and interface
labels are considered. Two-terminal nets also get `SCHEMATIC_ROUTE_DETOUR` when
they use at least 20 mm of wire and more than 2.5 times their Manhattan terminal
separation. Obstacles can legitimately require a detour; review placement and
pin orientation before overriding the route.

Font bounds are estimated conservatively. Warnings are a drawing review aid,
not an ERC/DRC result or a guarantee of visual quality. Intentional wire
crossings are allowed. Native KiCad export and pin-to-pin netlist checks remain
necessary when changing routing.

## Connected passive placement and compact fields

Start by anchoring the functional blocks (ICs, interfaces, connectors). Use
`branches` for connected two-pin parts instead of entering every absolute
coordinate. The framework finds the shared electrical pin, rotates the passive
so that pin faces the anchor, and calculates its position. Rules run in order,
so a divider or filter can attach to a previously placed passive:

```ts
schematicRouting: {
    compactFields: true,
    branches: [
        { component: 'R1', anchor: 'U1.13', direction: 'down', gap: 16.51 },
        { component: 'C6', anchor: 'R14.2', direction: 'down', gap: 13.97 },
        { component: 'R12', anchor: 'R11.2', direction: 'down', gap: 12.7 },
    ],
}
```

`gap` measures terminal separation along the requested direction. When a branch
turns perpendicular to its anchor pin, it aligns with the pin's escaped routing
lane to avoid a tiny jog. An explicit `laneOffset` chooses the perpendicular
spacing instead. The generator rejects missing anchors, ambiguous shared nets,
non-two-pin targets and invalid spacing; it does not invent electrical nets.
Drawing placements do not mutate the input circuit snapshot.

`compactFields` centers resistor values inside the body, rotates them with the
resistor and scales longer values to fit. References sit directly above
horizontal resistors or beside vertical ones. Capacitor labels and IC names
sit close to their graphic bounds. Test points already get automatic references
outside their circles. Explicit `fields` remain available for exceptions.
Intentional embedded resistor values are exempt only from their own body
collision check; foreign body, wire and text collisions remain checked.

These are reusable placement constraints, not full semantic circuit layout:
functional-block anchors, branch directions, spacing and explanatory notes
still express the author's reading order. Wire routing and field defaults are
then generated. Existing hierarchical placement remains available for initial
whole-sheet placement; it does not infer every circuit's presentation intent.

## Place visible fields explicitly

Keep circuit definitions separate from schematic layout. Field coordinates are
absolute sheet millimetres and become obstacles for the wire router:

```ts
schematicRouting: {
    fields: {
        U3: {
            reference: { x: 114.3, y: 25.4 },
            value: { x: 114.3, y: 27.94 },
            justify: 'center',
        },
        TP1: {
            reference: { x: 232.41, y: 86.36 },
            justify: 'left',
        },
    },
}
```

A unit-specific key such as `RV1/2` takes precedence over `RV1`. Reference and
value positions can supply independent text rotations; rotations describe the
readable field orientation after symbol rotation. `justify` applies to both
fields. Hidden values are not reserved as obstacles. With `hideValues`, automatic
reference placement uses the drawn symbol bounds, so a test-point reference sits
outside its circle instead of on the electrical anchor.

## Inline test points

Use a zero escape for a one-pin test point placed directly on a signal spine:

```ts
schematicRouting: {
    pinEscape: 5.08,
    pinEscapes: { 'TP1.1': 0, 'TP2.1': 0 },
    hideValues: ['TP1', 'TP2'],
}
```

The router then treats that probe as an anchor on its own net instead of routing
around its own body keepout. Its visible text stays reserved, and other nets
still respect its clearance. Native junctions are emitted when a pin lands in
a wire's interior, preserving connectivity after collinear segments are merged.
For ordinary pins, retain a lead long enough to keep turns clear of pin numbers.

To suppress heuristic diagnostics on an intentionally unusual drawing, set
`schematicRouting.readabilityWarnings = false`. This does not suppress electrical
validation, parallel-wire spacing or native KiCad validation.
