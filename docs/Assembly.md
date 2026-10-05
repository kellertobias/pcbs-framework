# Assembly

`Assembly` places independent physical PCBs and mechanical models in one
millimetre, Z-up scene. It does not merge circuits, generate a manufacturing
panel, synthesize schematics or change source PCB files.

```ts
import { Assembly, Kicad3DModel } from '@tobisk/pcbs';

const assembly = new Assembly({ name: 'Controller in enclosure' });
assembly.addBoard({
    id: 'controller',
    file: '../controller/Controller.ts',
    origin: [0, 0],
    position: [10, 20, 8],
});
assembly.addModel({ id: 'enclosure', file: './enclosure.3mf' });
assembly.addGenerated({
    id: 'bracket',
    position: [20, 20, 0],
    model: async () => {
        const model = await new Kicad3DModel().init();
        model.box({ x: 20, y: 10, z: 3 });
        return model;
    },
});
export default assembly;
```

Run from the consumer project:

```sh
npx @tobisk/pcbs view assembly path/to/assembly.ts
```

The command opens the browser and serves the prepared assembly on loopback.
Use `--no-open` to print the URL without opening a browser, and `--port 4319`
to choose a port. Ctrl+C stops the server and removes temporary session assets.
All viewer code is bundled in the framework; it does not require a CDN.

The viewer watches saved PCB files, referenced model files and local assembly
source dependencies. A change re-exports the boards and regenerates projected
panels and generated models. The refresh icon also rebuilds explicitly;
`--no-watch` disables automatic refresh. Camera, visibility, selection and
unsaved placement edits survive a successful refresh. Failed exports leave
the last successful assembly visible and show the error in the viewer.
For TypeScript board entries, source changes regenerate a temporary preview PCB,
module footprints and directly declared model factories before native export.
Panel projections use that same preview. A newer native PCB save takes precedence
over its local source dependencies, so edits in KiCad also appear. A subsequent
source save switches back to source-generated geometry. Neither mode rewrites
the project PCB or UUID map. These are mechanical previews, not validated routed
manufacturing outputs. Explicit schematic instances always use generated previews.

For preparation without a viewer, use
`--prepare-only --output ./review`. This creates a fresh session subdirectory
containing `assembly.json` and exported/copied assets, preserving prior output.

## Board sources

`addBoard` accepts an existing `.kicad_pcb`, a `.kicad_sch` with a sibling PCB,
or a TypeScript/JavaScript entry default-exporting a framework schematic.
The entry resolves to its existing `<schematic.name>.kicad_pcb` in the same
directory. Synthesize the PCB separately before opening the assembly.
Alternatively, pass a `schematic` instance and its `sourceDirectory`.
Each board is exported by the installed native `kicad-cli pcb export vrml`,
including component models, with embedded geometry and millimetre output.
The assembly never rewrites the source PCB.

The board's chosen PCB `origin` maps to local model XY=(0,0). KiCad PCB Y
maps to model -Y. Native KiCad model Z=0 is the substrate mid-plane: for a
1.6 mm board, place Z=8.8 to put the bottom at Z=8 and the top at Z=9.6.
Rotation is Euler XYZ in degrees, followed by translation, in assembly axes.
Different board thicknesses need their own half-thickness allowance.

## Model sources

`addModel` loads WRL, STL, OBJ, GLB, GLTF or 3MF files. Generated models use
`addGenerated`, accepting a `Kicad3DModel` or synchronous/asynchronous factory.
The existing `Module.make3DModel()` functions can be passed as factories.
For files read inside a factory, declare `inputs: ['./dimensions.json']` on
the generated part so changes trigger refresh. Paths are relative to the
assembly entry. Imported local source dependencies are tracked automatically.

File paths are relative to the assembly entry. Defaults:

| Format | Units | Up axis |
| --- | --- | --- |
| WRL | KiCad tenths of an inch (2.54 mm) | Z |
| STL / OBJ | mm | Z |
| GLTF / GLB | metres | Y |
| 3MF | archive's declared units, converted to mm | Z |
| Generated framework WRL | KiCad tenths of an inch | Z |
| Native PCB export | mm | Z |

Override file model units with `unit: 'mm' | 'm' | 'tenths'` and axis with
`upAxis: 'y' | 'z'`. This keeps placement and measurements in millimetres.
3MF archives containing mixed model units are rejected. GLTF resources must
be relative files within the model directory or embedded data URIs. GLB is
convenient for a single self-contained model. OBJ loads geometry without MTL
materials; imported WRL should embed its geometry rather than use Inline nodes.
STEP is not supported by this viewer.

## Viewer

The parts list retains every assembly instance. Toggle visibility, isolate a
part, focus it, adjust opacity, orbit, pan, zoom or fit all visible parts.
Selecting a part shows its exact transformed world bounding dimensions.
Numeric XYZ controls adjust position and rotation for fit review. “Save view”
downloads a PNG of the current camera view.

Measure mode picks two visible mesh surfaces and reports Euclidean distance
and signed axis deltas in millimetres. Shift-click snaps to the nearest vertex
of the hit triangle. Mesh accuracy limits measurement accuracy; the viewer
is not an automatic collision checker or a replacement for manufacturing DRC.

“Save placements JSON” downloads browser placement edits. Apply them without
rewriting model sources:

```sh
npx @tobisk/pcbs view assembly assembly.ts --placements assembly-placements.json
```

Or call `assembly.applyPlacements(placements)` in code. Identity, units and
transforms are validated before any placements change. Browser edits otherwise
last only for that page session.

Equivalent untextured face meshes from native KiCad exports are merged within
each assembly part to reduce draw calls. Material colors and transformed
geometry are retained; visibility and placement remain independent per part.

## Projected front plates

`addFrontPanel` creates an independent plate from the `FrontPanelCutouts`
metadata in selected board footprints. Board origins, rotations, backside
reflection and assembly placement are applied before projecting along each
board's normal onto the panel plane. An angled plate therefore receives the
appropriate stretched opening. A board normal parallel to that plane is
rejected. Select whole boards by ID or particular footprint references:

Use `cutouts: [[[x, y], ...], ...]` for additional mechanical through openings,
such as screws into an enclosure side cheek. These use panel-local coordinates
and are included alongside projected board openings in the mesh, SVG, DXF and
cutout JSON. They do not modify the source PCBs.

```ts
assembly.addFrontPanel({
    id: 'controls-panel',
    sources: ['controller', { part: 'buttons', references: ['SW1', 'SW2'] }],
    outline: [[0, 0], [200, 0], [200, 100], [0, 100]],
    position: [0, 0, 20],
    rotation: [15, 0, 0],
    offset: 5,
    thickness: 2,
    color: '#89949e',
});
```

The outline is panel-local XY in millimetres. `position`/`rotation` locate the
plane; `offset` moves the plate along its rotated local Z normal. The plate
extends from offset to offset + thickness. Openings are boolean-subtracted,
including overlapping holes and cuts extending beyond an edge. Preparation
exports `panel.svg`, millimetre `panel.dxf` and `cutouts.json` alongside its framework-generated WRL.
Curves are sampled at a maximum 0.01 mm chord error, with coordinates snapped
to a 0.000001 mm grid for coincident-edge stability. These are visualization
meshes rather than STEP solids. Moving boards in the browser does not
regenerate plates: apply placements and prepare the assembly again.

## Named views and PNG renders

Define reproducible cameras in the Assembly constructor:

```ts
const assembly = new Assembly({
    name: 'Controller',
    views: [{
        id: 'top', name: 'Top', projection: 'orthographic',
        position: [100, 50, 1000], target: [100, 50, 0],
        up: [0, 1, 0], span: 180,
        visibleParts: ['controller', 'controls-panel'],
    }],
});
```

Cameras use assembly coordinates. `span` is the orthographic vertical field in
millimetres. Perspective is the default. `visibleParts` optionally selects a
view's visible parts; omitted means retain current visibility. Choose a view
from the right properties panel, then use **Save PNG** for the current camera, or render
named views from the CLI:

```sh
npx @tobisk/pcbs renders assembly assembly.ts --only top --output-dir ./renders --width 1600 --height 1000
```

The CLI uses installed Chrome/Chromium and the same WebGL viewer. Set
`PCB_ASSEMBLY_CHROME` if its executable is elsewhere. PNGs are named by view ID.
The renderer waits for every model and reports model failures instead of
exporting an incomplete assembly. Existing PNGs with the same view IDs are
replaced. Measurement and selection overlays are omitted from CLI renders.

The vertical icon toolbar sits at the far left and contains fit, visibility,
measurement, focus, isolation, PNG and placement-download controls. The adjacent
left sidebar contains only the assembly title and parts list. Views, selected-part
properties and measurements are in the right panel. The parts list uses icons for boards, generated mechanical parts, front panels
and other imported models. Logarithmic depth and adaptive camera clipping
reduce artifacts from the millimetre-scale gaps in large assemblies.

## Movable groups and formed panels

Groups carry local millimetre positions and Euler XYZ rotations. Add a `group`
ID to any part (including another group) to make its placement relative:

```ts
assembly.addGroup({ id: 'controls', position: [0, 0, 100], rotation: [7, 0, 0] });
assembly.addBoard({ id: 'wing', group: 'controls', file: './wing.kicad_pcb' });
assembly.addFrontPanel({
    id: 'plate', group: 'controls', sources: ['wing'], offset: 8, thickness: 2,
    outline: [[0, 0], [300, 0], [300, 200], [0, 200]],
    folds: [{ name: 'Rear return', insideRadius: 2,
        path: [[200, 9], [203, 9], [203, -30], [180, -30]] }],
});
```

The viewer displays groups in the parts list. Select a group to move/rotate,
focus, hide or isolate all its children together. Downloaded placements include
group transforms; `applyPlacements` restores them. Nested parent transforms are
included in cutout projection, so a common group rotation preserves board/panel
alignment. Unknown parents and cycles fail before model preparation.

Optional `folds` are local YZ centreline intersection paths extruded across the
panel outline's X bounds. Z includes the panel offset. Corners receive tangent
circular bends of `insideRadius`, with constant panel gauge and at most 0.01 mm
chord error. Position the path start at the flat web edge and its first corner
beyond it by `(insideRadius + thickness / 2) * tan(bendAngle / 2)` for a tangent
join. Cutouts apply to the flat web; folds need their own explicitly modelled
openings if required. The SVG/DXF exports describe the perforated flat web,
not a developed sheet blank. Material, K-factor and bend allowance are not
inferred. Bent meshes are visual fit geometry, not fabrication-ready STEP.

The canvas view cube offers face, edge (45-degree) and corner orientations.
It follows the current camera and uses Z-up assembly coordinates: front is
negative Y, right positive X, top positive Z. Click its geometry, or focus it
and press T/F/L/R/B/D for top/front/left/right/back/bottom. The projection button
below it switches perspective/orthographic while preserving the target and
apparent scale. These navigation overlays are excluded from PNG renders.

`reliefs: [{ outline: [[...]], depth: 0.6 }]` on a front panel adds underside
pockets, with depth measured upward from `offset`. Each depth must be positive
and less than the plate thickness. Through cutouts stay open through every
layer; interface caps are removed and only exposed pocket seats remain.
`cutouts.json` retains the pocket metadata. DXF/SVG still describe through cuts
and outer web contours; milling pockets require an additional fabrication step.
