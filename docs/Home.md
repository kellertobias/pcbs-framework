# PCB framework documentation

`@tobisk/pcbs` lets you define a circuit in TypeScript and generate native KiCad
schematics, PCB files and component libraries. It also generates mechanical models
and manufacturing exports, with tools for rendering boards and viewing physical
assemblies.

Start with the [quick start](QuickStart.md) to build a circuit, or browse
[code and generated results](Examples.md) to see working code beside its
schematics, PCB layouts, footprints and 3D models.

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
