# Named front panels in a schematic

Export a `frontPanels` object alongside the schematic's default export. Each
named callback receives the generated schematic and returns a panel definition.
Select actual component instances with `schematic.getComponent(ref)`; their
connector interfaces supply the cutouts and above/below name anchors.

```typescript
import { defineFrontPanel, type FrontPanels } from '@tobisk/pcbs';

export const frontPanels: FrontPanels<MyBoard> = {
  connectors: schematic => defineFrontPanel({
    edge: 'bottom',
    nameHeight: -3.5,
    textStyle: { bold: true },
    extends: { left: 2, right: 2, top: 35, bottom: 5 },
    components: [
      { component: schematic.getComponent('J1'), name: 'DMX IN', namePlacement: 'below' },
      { component: schematic.getComponent('J2'), name: '6–24 V', namePlacement: 'below' },
    ],
  }),
  // Add other independent panel callbacks here.
};

export default new MyBoard();
```

```bash
npx @tobisk/pcbs frontpanel path/to/MyBoard.ts connectors
npx @tobisk/pcbs frontpanel path/to/MyBoard.ts --list
```

The framework generates/captures the circuit once, calls the selected panel
callback, and looks up the selected components' placements in the saved
`<schematic.name>.kicad_pcb` beside the TypeScript file. It does not synthesize,
patch, or write that board. Save manual KiCad placement edits before exporting.
`--pcb <file>` selects a different saved PCB explicitly; `--output <dir>` changes
the destination. No project-specific script or npm task is required.

```typescript
import { exportSchematicFrontPanel } from '@tobisk/pcbs';

exportSchematicFrontPanel(schematic, frontPanels, 'connectors', {
  pcbFile: 'MyBoard.kicad_pcb',
  outputDir: 'mechanical',
});
```

## Connector interface in the 3D coordinate system

A component or reusable module defines `static frontPanelInterface`. An instance
can override it with its `frontPanelInterface` constructor option. This describes
a face orthogonal to the PCB, aligned with the part's mounted 3D geometry:

```typescript
import { Module, KicadFootprint, type FrontPanelInterface } from '@tobisk/pcbs';

class MyConnector extends Module<'1' | '2' | '3'> {
  static frontPanelInterface: FrontPanelInterface = {
    facing: 'bottom',
    anchor: { x: 0, y: 2.7, z: 12.5 },
    cutouts: [
      { type: 'circle', diameter: 22 },
      { type: 'circle', x: 9.9, y: 9.9, diameter: 3.2 },
      { type: 'circle', x: -9.9, y: -9.9, diameter: 3.2 },
    ],
    labelAnchors: {
      above: { x: 0, y: 18, fontSize: 2.5 },
      below: { x: 0, y: -15, fontSize: 2.5 },
    },
  };

  static makeFootprint() {
    return new KicadFootprint({ name: 'MyConnector' })
      .setFrontPanelInterface(MyConnector.frontPanelInterface);
  }
  // Usual constructor, electrical pads, and symbol definition omitted here.
}
```

`anchor.x/y` use footprint-local PCB coordinates (Y down). `anchor.z` is above
the carrier PCB's top surface; it must include module/header/spacer height.
Imported/generated 3D meshes use Cartesian Y, so convert their Y sign when
aligning an interface to footprint coordinates. `facing` is the outward direction
before KiCad footprint rotation. The exporter uses the actual saved rotation for
both the anchor and facing; Z remains the height above the PCB.

Cutout and label coordinates describe the **vertical face**, relative to its
anchor. Y points upward. Local face X runs along +PCB X for top-facing parts,
+PCB Y for right-facing parts, -PCB X for bottom-facing parts, and -PCB Y for
left-facing parts. Face cutout rotation is counterclockwise. Circles, rounded
rectangles, and polygons are supported. These contours are explicit mechanical
interfaces, not guessed from the mesh or drawn on horizontal PCB layers.

`namePlacement` selects the interface's `above` or `below` anchor, including its
font size and rotation. Missing requested anchors are errors. A selection's
`name` supplies the engraving text; otherwise `component.frontPanelLabel` is
used when present. An unnamed selection still exports its openings.

`nameHeight` optionally aligns every component name at one height relative to
 the PCB top surface, retaining the horizontal position from each component's
selected anchor. For example, `nameHeight: -3.5` places all names 3.5 mm below
the PCB surface. Without it, the interface's individual name heights apply.

`textStyle: { bold: true }` sets the default for all panel text, including names,
annotations, and drawing text. A component selection can override this with
`nameStyle: { bold: false }`; interface label anchors and `type: 'text'` drawings
also accept `bold`. SVG uses font weight; DXF defines an editable `PCBS_BOLD`
text style referencing `arialbd.ttf` (regular text uses `arial.ttf`). The CAD
application must resolve those fonts or an appropriate replacement.

Interfaces are also embedded as hidden footprint metadata during library/PCB
generation. Named schematic export prefers the component's interface and can
fall back to saved footprint metadata for older parts. It verifies that the saved
footprint matches the selected component's footprint.

## Plate bounds and PCB datum

The reference is the PCB's top-left bounding-box corner, projected onto the
chosen vertical face at the PCB top surface. Panel X increases along PCB X for
top/bottom panels, or along PCB Y for left/right panels. Panel Y is height above
the PCB surface, positive upward. The DXF keeps this datum at `(0, 0)`; it does
not move the origin to the plate corner.

All four `extends` distances are finite, nonnegative millimetres:

- `left`: extension left of X=0.
- `right`: extension beyond the PCB's span along the selected edge.
- `top`: plate height above the PCB top surface.
- `bottom`: extension below the PCB top surface.

The resulting outline runs from X=`-left` to X=`PCB span + right`, and Y=`-bottom`
to Y=`top`. Width is PCB span + left + right; height is top + bottom. Components
may sit inward from the edge. Their faces are projected along the edge normal;
only the explicitly selected components contribute geometry.

The SVG uses equivalent millimetre geometry with Y reversed for SVG display.
A bottom/left-facing interface's local X offsets are reflected to preserve the
PCB top-view coordinate convention. No additional outside-view mirroring is
applied.

## Four output layers

Both formats separate manufacturing geometry and review information:

| Layer | Contents |
| --- | --- |
| `OUTLINE` | Closed rectangular plate perimeter |
| `ENGRAVING` | Editable component names at selected above/below anchors |
| `CUTOUT` | Connector openings and mounting screw holes |
| `ANNOTATIONS` | Centre crosses, circle diameter notes, and rectangular/polygon bounding dimensions |

SVG groups use those four IDs. DXF declares four layers even if a layer has no
entities. Annotation dimensions for a rotated polygon/rectangle describe its
panel-axis bounding box; they do not claim to be machining tolerances. Hide the
annotations layer when sending manufacturing geometry to a cutting process.
Text remains editable; convert engraving text to curves in the target CAD
application if the manufacturing process requires outlined lettering.

Outputs are `<board>-<panel-name>-front-panel.dxf` and `.svg`, in `front-panel/`
by default. Different names from one schematic produce independent files.
Unknown panel names, foreign/repeated component objects, missing PCB references,
wrong facing, invalid dimensions, and openings outside the plate are errors.

Current vertical support covers front-side footprints, the four cardinal edges,
and straight `Edge.Cuts` contours (`gr_line` or `gr_rect`). The plate outline is
rectangular. Connector reach, plate thickness, and assembled clearances still
require mechanical verification.

## Vector drawings and SVG logos

A panel's `drawings` array supports `line`, `circle`, `arc`, `polyline`, `text`,
`svg`, and nested `group` drawings. Coordinates and dimensions are millimetres in
the panel's X/height plane. The default layer is `ENGRAVING`; any of the four
layers may be selected. Drawing bounds are checked against the plate before
output files are written.

```typescript
import * as path from 'node:path';
import { barrelPolaritySymbol } from '@tobisk/pcbs';

// Inside the named panel callback:
drawings: [
  barrelPolaritySymbol({
    rotation: 90, // counterclockwise in panel coordinates
    polarity: 'center-positive', // or 'center-negative'; match the actual circuit
    anchor: {
      component: schematic.getComponent('J2'),
      placement: 'interface',
      offset: { x: 0, y: 10.5 },
    },
    size: 12,
  }),
  {
    type: 'svg',
    file: path.resolve(__dirname, 'artwork/logo.svg'),
    at: { x: 50, y: 27 },
    width: 18,
    height: 6,
    rotation: 0,
    layer: 'ENGRAVING',
  },
],
```

A `group` can use either `at` or a component `anchor`, with optional `scale` and
counterclockwise `rotation`. Its children use local coordinates. Component
anchors support `interface`, `above`, and `below`, follow saved placement, and
must reference a selected component in this schematic. Offsets use panel axes;
artwork remains readable when the connector face is reflected. `strokeWidth`
is a preview stroke in millimetres; DXF exports the vector centreline.

For SVG artwork, `at` is the centre of the SVG viewBox. `width` and optional
`height` set an aspect-preserving fit. Import supports paths (including curves),
basic shapes, group transforms, inline styles and local `use` references. Both
SVG and DXF receive the same vector contours. Curves become polylines, using
`tolerance` (default 0.02 mm) for cubic subdivision. Source fills become closed
outline contours, rather than raster images or DXF hatches. Convert logo text
to paths and flatten CSS, clipping, masks, filters, or nested viewports first;
unsupported elements produce explicit errors. External references and embedded
images are unsupported. SVG import requires Node 20.19+ or 22.12+ for its path
parser; ordinary panel primitives do not load that parser.

Native circles and arcs remain exact DXF `CIRCLE` and `ARC` entities. Text is
editable and Unicode characters such as the voltage range dash use DXF Unicode
escapes. No logo is inserted unless a real SVG file is provided in the schematic.

## Legacy exports

`exportFrontPanel(pcbFile)` and `frontpanel <entry>` for schematics without a
`frontPanels` export retain the parallel-to-PCB workflow: footprint-local
`addFrontPanelCutout()` shapes, `setFrontPanelLabelAnchor()` labels, and the
PCB outline, on `OUTLINE`, `CUTOUT`, and `MARKING` layers.

`exportVerticalFrontPanel()` and explicit CLI `--edge --components --height`
remain available for existing footprint-property callers. New schematic work
should define named panels as shown above.
