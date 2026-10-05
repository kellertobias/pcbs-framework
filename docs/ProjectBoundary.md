# Framework and project boundary

`pcbs-framework` owns reusable code for building, placing, routing and exporting
PCB designs. `pcbs` supplies concrete circuits, component choices, project models,
placement policies and saved board routing. Dependency direction is project → framework.
The reusable part/catalog migration is still pending; `pcbs/src/module` and the
circuit definitions in `pcbs/src/lib` have not moved yet.

## Public build APIs

Import these helpers from `@tobisk/pcbs`, rather than its compiled internals:

- `straightenRoutes`: simplify captured copper while preserving pads, vias, junctions and obstacles.
- `ReviewPlacement`: deterministic review placement using project-supplied obstacles and allowed regions.
- `footprint`, `padRects`, `contourRects`, `footprintBounds`, `transformRect`, `bounds`, `parseSexpr`, `child`, `children`: physical KiCad footprint inspection.
- `routedSlotContour`: explicit capsule contours with tangent sides and nondegenerate circular end caps.
- `foldedChannel`, `roundedContour`, `capsulePoints`, `profileSolid`: reusable constant-gauge and loft geometry.
- `resistor`, `capacitor`, `offsetPosition`: small circuit construction helpers.
- `parseResistorValue`, `parseResistorValueBetter`, `getClosestResistor`: value parsing and matching against a caller-supplied catalog.

`getClosestResistor(target, catalog)` receives a resistor-label → supplier-code map.
Catalog selection belongs to the project. `profileSolid` receives an explicit
half-thickness; project wrappers may choose their own material gauge.

## Representative flows

A project constructs a circuit snapshot. Its placement policy reserves fixed
controls and board openings, selects priority and allowed regions, then calls
`ReviewPlacement.place`. The framework searches physical footprint orientations
and free grid cells. Project names and isolation-domain rules stay outside the engine.

A project captures its actual KiCad copper and calls `straightenRoutes`, passing
protected waypoints. The framework checks the board geometry and returns simplified
routes. The project decides which routing file to save. This does not replace native DRC.

`pcb dxf board.kicad_pcb --layers frontpanel,mounting,interaction` invokes the
framework's packaged Python exporter. It reads the framework layer registry,
runs native KiCad DXF export at 1:1 in mm, and verifies that the input PCB did not
change. Outputs and a manifest go beside the board unless an output directory is supplied.
The command requires Python 3 and `kicad-cli` on PATH, or `--kicad-cli /path/to/kicad-cli`.

## Development and verification

```sh
npm run build
npm test
python3 scripts/test_export_pcb_dxf.py
```

The public entry point is `src/synth/index.ts`; routing helpers live under
`src/router`, footprint inspection under `src/kicad`, model helpers under
`src/synth/3d`, and CLI commands under `src/cli/commands`.
Add reusable behavior and its tests here. Keep component reference measurements,
console mounting dimensions, circuit net names and saved copper with the relevant
project. Generic algorithms must not import a sibling project's source or assets.
