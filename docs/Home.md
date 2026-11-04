# PCB framework documentation

`@tobisk/pcbs` generates native KiCad schematics, PCB layouts and component
libraries from TypeScript. It also builds mechanical models, front-panel drawings,
assemblies and manufacturing exports.

Start with the [quick start](QuickStart.md) to build a circuit, or browse
[code and generated results](Examples.md) to see working code beside its
schematics, PCB layouts, footprints and 3D models.

<!-- generated-examples:start -->

<span id="saved-board-to-3d-view"></span>

## Populated board rendering

<div class="example-pair" data-example="board3d"><div>

<<< ./examples/coin-cell-led/renders.ts

</div><figure>

[![Populated board rendering](./public/examples/indicator-3d.png)](/examples/indicator-3d.png)

<figcaption>Native KiCad renders the saved board with its coin-cell holder, resistor and LED models.</figcaption>

</figure></div>

<span id="circuit-to-schematic"></span>

## Circuit connections

<div class="example-pair" data-example="circuit"><div>

<<< ./examples/coin-cell-led/Indicator.ts#circuit

</div><figure>

[![Circuit connections](./public/examples/indicator-schematic.png)](/examples/indicator-schematic.png)

<figcaption>The battery, resistor and LED are connected in TypeScript and plotted from the generated native KiCad schematic.</figcaption>

</figure></div>

## Functional groups

<div class="example-pair" data-example="groups"><div>

<<< ./examples/circuits/GroupedIndicator.ts#groups

</div><figure>

[![Functional groups](./public/examples/schematic-groups.png)](/examples/schematic-groups.png)

<figcaption>Decorated methods create the BATTERY and INDICATOR groups. The framework places their symbols and routes each group.</figcaption>

</figure></div>

<span id="placement-to-copper"></span>

## Placement and front copper

<div class="example-pair" data-example="copper"><div>

<<< ./examples/coin-cell-led/pcb-routing.ts

</div><figure>

[![Placement and front copper](./public/examples/indicator-front.png)](/examples/indicator-front.png)

<figcaption>The 50 × 44 mm PCB has explicit component placement, routed traces and a filled front ground zone.</figcaption>

</figure></div>

## A front-panel drawing

<div class="example-pair" data-example="front-panel"><div>

<<< ./examples/mechanical/front-panel.ts

</div><figure>

[![A front-panel drawing](./public/examples/front-panel.png)](/examples/front-panel.png)

<figcaption>A mechanical interface fixture supplies three face openings and a label anchor. The named panel exports its outline, cutouts and label to SVG and DXF.</figcaption>

</figure></div>

<span id="code-to-footprint"></span>

## Rounded SMD pads

<div class="example-pair" data-example="smd"><div>

<<< ./examples/library/footprint.ts

</div><figure>

[![Rounded SMD pads](./public/examples/footprint.png)](/examples/footprint.png)

<figcaption>Native KiCad plot of the two rounded pads and their silkscreen outline.</figcaption>

</figure></div>

<span id="code-to-mechanical-model"></span>

## A mounting plate

<div class="example-pair" data-example="model"><div>

<<< ./examples/library/model.ts

</div><figure>

[![A mounting plate](./public/examples/model-isometric.png)](/examples/model-isometric.png)

<figcaption>The completed plate adds four mounting holes and exports to WRL, STL and 3MF.</figcaption>

[![Mounting plate viewed from above](./public/examples/model-top.png)](/examples/model-top.png)

<figcaption>Top view of the same exported model.</figcaption>

</figure></div>

## Board and mechanical assembly

<div class="example-pair" data-example="assembly"><div>

<<< ./examples/mechanical/assembly.ts#parts

</div><figure>

[![Board and mechanical assembly](./public/examples/assembly-isometric.png)](/examples/assembly-isometric.png)

<figcaption>The saved board sits above a generated tray in the framework assembly viewer. This is a mechanical preview.</figcaption>

</figure></div>

## A generated datasheet

<div class="example-pair" data-example="datasheet"><div>

<<< ./examples/library/datasheet.ts

</div><figure>

[![A generated datasheet](./public/examples/datasheet-1.png)](/examples/datasheet-1.png)

<figcaption>The PDF contains source-supplied metadata, footprint drawings and pad-centre tables.</figcaption>

[![Pad-centre table in generated PDF](./public/examples/datasheet-2.png)](/examples/datasheet-2.png)

<figcaption>A second page from the same generated PDF.</figcaption>

[![Through-hole footprint in generated PDF](./public/examples/datasheet-3.png)](/examples/datasheet-3.png)

<figcaption>A third page from the same generated PDF.</figcaption>

</figure></div>

<!-- generated-examples:end -->

The [CLI reference](CLI.md) lists commands and options. The
[source/output workflow](OutputWorkflow.md) explains where generated files belong
and how to regenerate and review them.

## Circuits and schematics

- [Schematic](Schematic.md): define a circuit and choose its generation options.
- [Component](Component.md), [Net](Net.md) and [Composable](Composable.md): connect
  parts and reuse circuit blocks.
- [Decorators](Decorators.md): keep functional group definitions beside the
  methods that build the circuit.
- [Automatic schematic layout](AutomaticSchematicLayout.md): use functional groups
  and routed wires to refine placement, with project branding and native multipage
  sheets.
- [Schematic readability](SchematicReadability.md): position fields, arrange passive
  branches and inline probes, and understand generation warnings.

## Boards and fabrication

- [PCB placement and routing](PCB.md): define outlines, net classes and physical
  placement. Capture copper routing and synchronize saved boards.
- [Autorouting](Autorouting.md): choose a routing backend and set waypoints or
  areas to avoid.
- [Board composition](BoardComposition.md): reuse circuit blocks with their
  physical placement and copper routing.
- [Projects and panels](ProjectsAndPanels.md): keep libraries with a project and
  organize boards and manufacturing panels.
- [Front panels](FrontPanel.md): define openings and artwork, then export separate
  DXF/SVG layers.
- [Rendering](Rendering.md): define named board views and export models.
- [Physical assemblies](Assembly.md): view boards and mechanical models together
  in the local 3D viewer and render views from named cameras.

## Component libraries

- [Module](Module.md): define reusable physical parts.
- [Symbols](KicadSymbol.md), [footprints](KicadFootprint.md) and
  [3D models](Kicad3DModel.md): build component library assets in code.
- [Datasheets](Datasheets.md): generate PDFs for components and footprints.
- [Component cost](ComponentCost.md): record supplier quotes and assembly
  classifications.

## Contributing

- [Framework and project boundary](ProjectBoundary.md): decide what belongs in the
  framework and what belongs in a board project.
- [Documentation site](Documentation.md): edit, validate and publish the guides.

Before fabrication, check connectivity and run native KiCad DRC with filled zones.
Readability warnings flag drawing problems and do not replace those electrical
checks.
