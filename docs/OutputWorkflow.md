# Source files, exports and routing

A board source directory contains its TypeScript circuit and optional configuration files. Generated assets go into `export/` beside the source:

```text
MyBoard.ts
pcb-routing.ts           # explicit physical positions and routing hints
schematic-routing.ts     # functional groups and schematic hints
export/
  MyBoard.kicad_sch
  MyBoard.kicad_pcb
  MyBoard-schematic.pdf
  MyBoard-pcb-front.pdf
  MyBoard-pcb-back.pdf
  MyBoard.pcb-routing-cache.json
  renders/
    front.png
    back.png
.backups/
```

The installer asks separately whether to ignore exports and backups. The default keeps exports tracked and ignores backups. Noninteractive installs leave Git policy unchanged; run `pcb setup --track-exports --ignore-backups` to choose explicitly. This does not remove existing ignore rules. PDF and PNG outputs are ordinary files suitable for Git review.

`pcb clean-outputs [root]` previews a migration; add `--apply` to move files. It refuses collisions and keeps vendor references and source files. Update explicit relative references after migration. Backups are retained in `.backups/`, including previous generated boards and routing caches.

## Schematic layout

Use functional `schematicGroups` to arrange circuits automatically and draw group boxes. Group `relativeTo` hints specify left, right, up or down relationships, with optional gaps. Unknown references, cycles and overlapping groups fail generation. Existing schematic readability warnings flag drawing problems. A `schematic-routing.ts` file can contain these declarations; it does not need a separate routing implementation.

## Physical layout and copper

`placePcbComponents` applies measured absolute placements and explicit relative offsets. `packPcbComponents` searches remaining rear placements while respecting fixed bodies, drill envelopes, cutouts and footprint keepouts. Its optional priority and region/centre callbacks carry board-specific physical requirements.

CLI `synth --pcb sync` and `synth --pcb rebuild` automatically route from generated pads. `autoRoute: false` explicitly selects the legacy persistent routing workflow. The default preserve mode continues to leave a saved PCB untouched.

Generated copper is stored as a coordinate cache, rather than executable `pcb-tracks.ts`. A hash includes bare geometry, placement, connectivity, routing hints, net classes and engine revision. Changes invalidate the cache and regenerate from the bare board. A corrupt cache is disposable. `capture-routing` explicitly snapshots edited copper into the current cache for automatic boards; subsequent geometry changes invalidate that snapshot too.

Routing hints can specify required support points, preferred layers and per-net forbidden regions. `routingRegions` supports:

- `mode: 'keepout'`: every net avoids the area.
- `mode: 'local'`: nets with a terminal inside the area, or explicitly admitted `nets`, may use it; unrelated nets avoid it.

Regions may be limited to copper layers. Current region obstacles conservatively use polygon bounding boxes. Grid and capacity routing support these constraints; the simple backend rejects them rather than ignoring them. Native footprint/mechanical keepouts remain separately configurable.

Fresh automatic routing runs native KiCad DRC with filled zones before replacing the PCB or route cache. Native KiCad must be installed. Errors or unconnected items reject the candidate and leave the previous PCB/cache intact; diagnostic JSON remains in export. Matching cached geometry is reused without a new native run, so fabrication still requires checking the saved board with current native rules.

Automatic routing is not guaranteed to find a complete route for every circuit. In particular, signal completion alone does not establish pour connectivity. Use the native report to revise placement or hints rather than committing incomplete copper as authoritative generated data.


## Circuit-owned net classes

Define reusable physical rules alongside the circuit:

```ts
const motor = defineNetClass({ name: 'Motor', width: 0.3, clearance: 0.15,
    viaDiameter: 0.5, viaDrill: 0.25 });
const vm = new Net({ name: 'VM', class: motor });
const out = new Net({ name: 'MOTOR_A', class: motor });
```

The capture engine collects the used class definitions and net assignments into
PCB routing rules and native KiCad project settings. `SchematicOptions.netClasses`
can declare a Default class and other circuit-wide classes. Legacy string classes
and `pcb.netClasses` remain supported. Inconsistent definitions of the same class
or incompatible classified-net merges fail instead of silently dropping rules.
