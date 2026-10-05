# PCB projects and manufacturing panels

A workspace can keep independent schematics and named PCB projects together under
`src/schematics/`. A project directory is identified by `pcb-project.json`:

```json
{
  "name": "Control desk",
  "schematics": { "keys": "schematics/keys/Keys.ts" },
  "panels": { "production": "panels/production/Production.ts" },
  "assemblies": { "desk": "assemblies/Desk.ts" }
}
```

Only `name` is required. Every entry map is optional. Directory layout within the
project is your choice; entry paths are relative to the manifest. A schematic
entry can also point to a shared schematic outside the project. TypeScript
modules and libraries can be local imports or shared imports. `modules` optionally
lists local TypeScript module directories (default `modules/`), and `libraries`
optionally lists generated KiCad library directories in precedence order
(default `.kicad/`, `lib/`). Shared workspace KiCad libraries remain fallback.
Symbols and footprints with matching names are overridden individually, rather
than hiding the entire shared library. Generated library overlays belong to each
board's `.project-libraries` directory and are rebuilt automatically.

```sh
pcb projects
pcb synth control-desk/keys --pcb sync
pcb lib control-desk
pcb view assembly control-desk/desk
pcb export control-desk/production --no-renders
```

Legacy schematic entry paths/names continue to work. Named project schematics
and panels appear in the existing interactive selector. Assembly commands resolve
project assembly keys separately.

## Panel source

A panel is a dedicated `PcbPanel`, not a `Schematic` subclass. It has an owning
persisted project and references schematic keys from that project's manifest:

```ts
import path from 'node:path';
import { PcbPanel, PcbProject } from '@tobisk/pcbs';

export default new PcbPanel({
  name: 'Production',
  project: new PcbProject(path.resolve(__dirname, '../..')),
  pcb: {
    outline: [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ],
  },
  boards: [
    { id: 'left', schematic: 'keys', x: 5, y: 5 },
    { id: 'right', schematic: 'keys', x: 70, y: 30, rotation: 90 },
  ],
});
```

Boards can be placed repeatedly. `id` isolates each board's nets, references and
UUIDs. `origin` specifies a source PCB coordinate mapped to the placement anchor.
Rotation follows the framework's KiCad convention. A panel must use compatible
board thickness, copper layers and physical stackup. It cannot contain another
panel as a schematic source.

Panel synth/export synchronizes each unique source board first, then composes the
current saved native PCB objects. It writes the panel PCB/project/library tables,
not a circuit schematic, netlist or synthetic child project tree. Missing sources,
unknown project entries, inconsistent source perimeters and incompatible stacks
are errors. Export does not silently use an old panel after preparation fails.

`replaceOutline` can specify a source's straight outer perimeter to replace with
parent routing/tabs; internal cuts remain. The parent `pcb` options describe
manufacturing rails, routed cutouts, mounting/tooling holes and direct front/back
`fiducials` (copper diameter and mask aperture) without populating BOM/CPL.
Breakaway placement, fiducials, tooling and supplier constraints are design
choices; a panel type does not automatically certify these. Native filled-zone
DRC and supplier acceptance remain manufacturing gates.

## Manufacturing tooling

Panel export runs native KiCad DRC with zone refill and saves fresh fill caches
before plotting; its report is included with the export. Routing violations are
reported for review rather than interpreted as manufacturing acceptance.

The usual export command creates combined Gerbers, drills and map, BOM, CPL and
ZIP archive. BOM/CPL designators use the same board-instance prefixes. Panel
components retain original sourcing metadata without mutating the source boards.
Non-populated mechanical holes and copper-only solder jumpers are excluded from
component BOMs. Native position CSV preserves commas/spaces/quotes in values and
tracks both sides and absolute part rotations. Source-frame placement correction
offsets rotate into the panel frame; angle corrections remain additive.
`overrides.yml` in the project overrides shared `src/overrides.yml` corrections.
`--no-renders` skips the optional native 3D renders for manufacturing-only export.
Incomplete routing or missing sourcing metadata remains visible; export success
is not approval to order.

`relocateBoardModels` rebases generated native 3D links when board directories
move, retaining their copper/pad geometry. Source factories should resolve model
paths without assuming a fixed project nesting depth.

## Building referenced module projects

A board entry may export an async `beforeSynth` hook to refresh dependent project
assets before capture and library-overlay preparation. Export entries can use the
existing `beforeExport` hook to synchronize their dependent boards and assets.
Errors abort preparation. Keep dependency circuits in their own projects and
import their module definitions; add their generated library directory to the
consumer project's `libraries` list.

`footprint(name, libraryDirectories)` resolves explicit project libraries ahead of
workspace and installed libraries. Its cache is keyed by resolved file and file
revision, so identically named libraries in separate projects remain independent.
Symbols retain their declared footprint library. A `BoardModule.createFootprint`
result can add courtyard geometry and model links through ordinary framework APIs.

Native PCB writes use the format appropriate for the board version. KiCad 10
name-based nets are normalized only inside the routing/composition engine, then
emitted as names when written. This preserves pad/copper connectivity during
synchronization and when panels copy native boards saved by KiCad.
