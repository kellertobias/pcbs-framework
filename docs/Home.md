# PCB framework documentation

`@tobisk/pcbs` turns TypeScript circuit and layout definitions into KiCad
schematics and PCB files. Render the generated board to review the design, then
[export Gerber and drill files](CLI.md#export) for fabrication.

The examples below pair the source code with its generated output. Start with the
[quick start](QuickStart.md), or browse [all code examples](Examples.md) for schematic
layout, component libraries and mechanical models.

<!-- generated-examples:start -->

<span id="saved-board-to-3d-view"></span>

## Render the PCB built in code

<div class="example-pair" data-example="board3d"><div>

<<< ./examples/coin-cell-led/renders.ts

</div><figure>

[![3D render of a KiCad PCB generated from TypeScript definitions](./public/examples/indicator-3d.png)](/examples/indicator-3d.png)

<figcaption>The framework generates this PCB from TypeScript circuit and layout definitions. Rendering the generated KiCad board lets you review the physical result before exporting manufacturing files.</figcaption>

</figure></div>

<span id="circuit-to-schematic"></span>

## Generate a KiCad schematic

<div class="example-pair" data-example="circuit"><div>

<<< ./examples/coin-cell-led/Indicator.ts#circuit

</div><figure>

[![KiCad schematic generated from a TypeScript circuit definition](./public/examples/indicator-schematic.png)](/examples/indicator-schematic.png)

<figcaption>Define components and connect their pins in TypeScript. The framework turns those connections into a native KiCad schematic, shown here with routed wires.</figcaption>

</figure></div>

## Lay out schematics by function

<div class="example-pair" data-example="groups"><div>

<<< ./examples/circuits/GroupedIndicator.ts#groups

</div><figure>

[![Generated schematic with functional groups defined by decorators](./public/examples/schematic-groups.png)](/examples/schematic-groups.png)

<figcaption>Group circuit-building methods in code with decorators. The framework uses those groups to place symbols, route connections and label the generated schematic.</figcaption>

</figure></div>

<span id="placement-to-copper"></span>

## Generate the PCB layout

<div class="example-pair" data-example="copper"><div>

<<< ./examples/coin-cell-led/pcb-routing.ts

</div><figure>

[![Front copper of a PCB generated from TypeScript layout and routing definitions](./public/examples/indicator-front.png)](/examples/indicator-front.png)

<figcaption>Declare the board outline, component positions and copper rules in TypeScript. The framework generates the KiCad PCB and routes its connections; this front-copper view shows the result.</figcaption>

</figure></div>

## Export front panels from code

<div class="example-pair" data-example="front-panel"><div>

<<< ./examples/mechanical/front-panel.ts

</div><figure>

[![Front-panel outline, cutouts and engraving exported from a code definition](./public/examples/front-panel.png)](/examples/front-panel.png)

<figcaption>Define a mechanical interface and select it in a named panel definition. The framework exports the panel outline, openings and labels as SVG and DXF files.</figcaption>

</figure></div>

<span id="code-to-footprint"></span>

## Generate KiCad footprints

<div class="example-pair" data-example="smd"><div>

<<< ./examples/library/footprint.ts

</div><figure>

[![KiCad footprint generated from TypeScript pad and silkscreen geometry](./public/examples/footprint.png)](/examples/footprint.png)

<figcaption>Build pad geometry and silkscreen in TypeScript, then generate a native KiCad footprint for your component library. The preview comes from that generated footprint.</figcaption>

</figure></div>

<span id="code-to-mechanical-model"></span>

## Build and export 3D models

<div class="example-pair" data-example="model"><div>

<<< ./examples/library/model.ts

</div><figure>

[![3D preview of a mechanical model built and exported from TypeScript](./public/examples/model-isometric.png)](/examples/model-isometric.png)

<figcaption>Define solids and cuts in TypeScript to generate a 3D model. Export the same geometry as WRL, STL or 3MF for PCB and mechanical design.</figcaption>

[![Top view of the same model generated from TypeScript](./public/examples/model-top.png)](/examples/model-top.png)

<figcaption>Another view of the generated geometry lets you compare the openings and mounting holes with their definitions in code.</figcaption>

</figure></div>

## Review boards and parts together

<div class="example-pair" data-example="assembly"><div>

<<< ./examples/mechanical/assembly.ts#parts

</div><figure>

[![Generated PCB and mechanical models rendered in a code-defined assembly](./public/examples/assembly-isometric.png)](/examples/assembly-isometric.png)

<figcaption>Combine a generated PCB with mechanical models using assembly positions defined in code. The framework renders the assembled geometry so you can inspect how the parts sit together.</figcaption>

</figure></div>

## Generate component datasheets

<div class="example-pair" data-example="datasheet"><div>

<<< ./examples/library/datasheet.ts

</div><figure>

[![PDF generated from footprint definitions and supplied component specifications](./public/examples/datasheet-1.png)](/examples/datasheet-1.png)

<figcaption>Generate component PDFs from the same footprint definitions used in your KiCad library. The framework includes the supplied specifications, footprint drawings and pad-centre tables.</figcaption>

[![Generated PDF footprint drawing and pad-coordinate table](./public/examples/datasheet-2.png)](/examples/datasheet-2.png)

<figcaption>The generated PDF pairs the footprint drawing with a table of pad coordinates from the same definition.</figcaption>

[![Generated PDF drawing and pad-coordinate table for a second footprint](./public/examples/datasheet-3.png)](/examples/datasheet-3.png)

<figcaption>A second footprint definition produces its own drawing and pad-centre table in the same PDF.</figcaption>

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
