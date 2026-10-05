# CLI Documentation

The `@tobisk/pcbs` framework provides a powerful CLI to manage your project.

## Commands

Run commands using `npx pcbs <command> [args]`.

### `synth`

Synthesizes a TypeScript schematic into KiCad files (`.kicad_sch` and `.net`).

```bash
npx pcbs synth src/schematics/MyBoard.ts
```

**Options:**
*   `--no-wires`: Skip wire generation (symbols only). **For debugging purposes.**
*   `--no-symbols`: Skip symbol generation (wires only). **For debugging purposes.**
*   `--experimental-routing`: Enable the legacy schematic wire-routing experiment. This does not route PCB copper; use `route` for PCB routing.
*   `--reload-kicad`: After `--pcb sync` or `--pcb rebuild`, refresh the exactly matching open PCB in KiCad on macOS. Before synthesis, the framework asks KiCad to save that board so unsaved editor changes become part of the synchronization input. It then uses KiCad's IPC `RevertDocument` operation to reload the updated file. Enable the IPC API in **KiCad → Preferences → Plugins** and install the official bindings in the project environment with `.venv/bin/python -m pip install kicad-python==0.7.1`. If no matching board is open, synthesis succeeds without opening or changing another document. If IPC is unavailable, synthesis continues with an explicit warning instead of pretending a reload occurred.

### `parts`

Search for components in the JLCPCB parts library.

**Interactive Mode:**
Run without arguments to enter an interactive search shell.

```bash
npx pcbs parts
```

**Direct Search:**
Use flags to search directly.

```bash
npx pcbs parts --footprint "SOIC-8" --value "10k"
```

**Options:**
*   `--footprint`: Filter by footprint.
*   `--value`: Filter by component value.
*   `--basic-only`: Search only for "Basic" parts (cheaper/no setup fee).
*   `--json`: Output results in JSON format.

*Note: This command requires Python and the `search_lib.py` script to be set up correctly.*

### `lib`

Generates project-specific KiCad libraries (`.kicad_sym` and `.pretty`) from your **[Module](Module.md)** definitions in `src/module/`.

```bash
npx pcbs lib
```

This command scans `src/module/*.ts`, executes the static `makeSymbol()` and `makeFootprint()` methods, and optionally generates 3D models via `make3DModel()`.

### `export`

Generates manufacturing files for JLCPCB.

```bash
npx pcbs export src/schematics/MyBoard.ts
```

**Outputs:**
*   Gerber files
*   Drill files
*   BOM (Bill of Materials) in JLCPCB CSV format
*   CPL (Component Placement List) in JLCPCB CSV format
*   3D Renders (Top, Bottom, Angled)
*   A ZIP archive containing all necessary files for upload.

### `pdf`

Export saved KiCad files to a native schematic PDF and one composite PDF per PCB
side. Run `synth` first when the TypeScript circuit or schematic routing has changed.
This command reads the saved files without regenerating or replacing the board.
The existing `print` command remains available for its custom TypeScript renderer.

```bash
pcb pdf src/schematics/single_fader_controller/SingleFaderController.ts
pcb pdf my_board --output output/pdf
pcb pdf path/to/MyBoard.kicad_sch --only schematic
pcb pdf path/to/MyBoard.kicad_pcb --only pcb
```

By default, outputs go in `pdf/` beside the input project:

- `<schematic.name>-schematic.pdf` contains all schematic sheets.
- `<schematic.name>-pcb-front.pdf` combines `F.Cu,F.SilkS,Edge.Cuts`.
- `<schematic.name>-pcb-back.pdf` combines `B.Cu,B.SilkS,Edge.Cuts`, mirrored
  for an underside view.

PCB plots autoscale to the page, include pad/via drill marks, and check/refill zones
in KiCad's export process. These are review PDFs; autoscaling means they are not
dimensionally accurate fabrication templates. `--only all|schematic|pcb` defaults
to `all`. Input may be a TypeScript entry, a schematic directory name, or a saved
`.kicad_sch`/`.kicad_pcb` file (whose sibling is used for the other view).
Install `kicad-cli` (with PCB PDF export and `--check-zones` support); set
`KICAD_CLI` to override its location. Export failures leave existing PDFs intact.

### `frontpanel`

Export a named panel declared by the schematic's `export const frontPanels`.
The selected callback receives the generated schematic, picks component
instances, and defines the edge, extensions, names, and above/below placements.
Saved PCB placement supplies the actual connector positions and rotations.

```bash
npx @tobisk/pcbs frontpanel src/schematics/MyBoard.ts connectors
npx @tobisk/pcbs frontpanel src/schematics/MyBoard.ts --list
npx @tobisk/pcbs frontpanel src/schematics/MyBoard.ts connectors --output mechanical
```

`--pcb <file>` overrides the default `<schematic.name>.kicad_pcb` beside the
schematic. Export reads that PCB without writing or resynthesizing it.

Outputs in `front-panel/` are `<board>-<name>-front-panel.dxf` and `.svg`, with
four independent layers: `OUTLINE`, `ENGRAVING`, `CUTOUT`, and `ANNOTATIONS`.
See [FrontPanel](FrontPanel.md) for the component interface and coordinate API.

The earlier footprint-property exporters remain available for existing callers:
`frontpanel <entry>` without a `frontPanels` export and explicit
`--edge --components --height` on a PCB file.

### `validate`

Validates the generated KiCad libraries to ensure they are parsable by KiCad.

```bash
npx pcbs validate
```

This command attempts to export symbols and footprints to SVG using `kicad-cli` as a validity check.
# PCB synchronization modes

`pcb synth` defaults to `--pcb preserve`: schematic, netlist, and library files
are regenerated, while an existing `.kicad_pcb` is neither read nor written.

- `--pcb preserve` leaves the PCB completely untouched.
- `--pcb sync` updates TypeScript-declared footprint placement, side, rotation,
  and pad nets while preserving tracks, arcs, vias, zones, and unowned KiCad
  objects. Routed footprint moves are listed in `<project>.pcb-sync.json` and
  require deliberate rerouting.
- `--pcb rebuild` creates a timestamped backup beside an existing PCB before
  replacing it with a newly generated board.

To synchronize and immediately refresh a board already open in KiCad:

```bash
npx pcbs synth src/schematics/MyBoard.ts --pcb sync --reload-kicad
```

The reload targets a canonical full path, not merely a window title or filename.
It never drives KiCad menus and does not touch unrelated open documents.

Use `--pcb-mode <mode>` as an equivalent long-form option.

### `route`

Runs an opt-in PCB routing backend after synthesis. The built-in `simple`
backend is intentionally limited to short, low-speed Manhattan routes. A net is
eligible only when it has a `routeHints` declaration and no existing copper.
Manual copper and TypeScript `exactRoutes` are preserved by default.

```bash
npx pcbs route src/schematics/MyBoard.ts --backend simple
```

Existing copper is replaced only when its net is selected explicitly. The
command creates an exact timestamped copy of the PCB before changing it:

```bash
npx pcbs route src/schematics/MyBoard.ts --reroute-net STATUS_LED
```

Repeat `--reroute-net` to select more nets. `--no-drc` disables the automatic
post-route KiCad DRC invocation, but never changes the report's human-review
requirement. Results are written to `<project>.route-report.json`; KiCad DRC
output is written to `<project>.route-drc.rpt` when the command is available.

### Capture actual routing

```bash
npx pcb capture-routing [entry]
```

Saves current segments, arcs, and through vias into `routing.json`, preserving
KiCad identities and converting pad/interface endpoints to logical anchors.
Existing routing files are backed up. Subsequent `synth --pcb sync` or
`--pcb rebuild` reads this file automatically; ordinary synthesis never
overwrites it. Source-declared module copper stays in TypeScript. See
[Persistent routing and modules](PCB.md#full-placement-and-persistent-routing).

### Library-backed PCB autorouting

`pcb route [entry]` now defaults to the local `capacity` backend and includes all
unrouted nets. Use `--backend simple` for the earlier Manhattan implementation.
`--reroute-net NAME` explicitly selects existing manual copper for replacement;
source-declared exact copper stays protected. Both PCB and schematic support
points are documented in [Autorouting](Autorouting.md).

### Automatic component PDFs

`pcb lib` also generates a PDF for every footprint under
`.kicad/datasheets/footprints/`, with pad measurements, optional component
specifications, and any generated 3D model. See [Component Datasheets](Datasheets.md)
for the `makeDatasheet()` metadata hook and programmatic API.
Use `pcb datasheet --all` to regenerate PDFs from existing library assets, or
`pcb datasheet manifest.json` for a custom multi-variant document.

## Assembly viewer

`npx @tobisk/pcbs view assembly <assembly.ts>` opens the local interactive
assembly viewer. Use `--no-open`, `--port N`, `--placements file.json`, or
`--prepare-only --output directory` as needed. See [Assembly](Assembly.md)
for board sources, imported model formats, generated models and measurements.

Render named Assembly cameras as PNG: `npx @tobisk/pcbs renders assembly path/to/assembly.ts --only top,overview --output-dir ./renders`. See [Assembly](Assembly.md) for projected front plates, view definitions and Chrome configuration.
