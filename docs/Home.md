# PCB framework documentation

`@tobisk/pcbs` turns TypeScript circuit definitions into native KiCad schematics,
PCB files and component libraries. It also provides mechanical models, assemblies,
rendering and manufacturing exports.

Start with the [quick start](QuickStart.md), then use the [CLI reference](CLI.md)
and [source/output workflow](OutputWorkflow.md) for generation and review.

See [code and generated results](Examples.md) for executable examples beside
native KiCad schematic, PCB and 3D renders, plus generated footprints and models.

## Circuits and schematic drawings

- [Schematic](Schematic.md): circuit entry point and generation options.
- [Component](Component.md), [Net](Net.md) and [Composable](Composable.md): parts,
  electrical connections and reusable circuit blocks.
- [Decorators](Decorators.md): assign functional groups beside circuit methods.
- [Automatic schematic layout](AutomaticSchematicLayout.md): functional groups,
  routing-informed placement, project branding and native multipage sheets.
- [Schematic readability](SchematicReadability.md): field placement, passive
  branches, inline probes and generation warnings.

## Boards and fabrication

- [PCB placement and routing](PCB.md): outlines, physical placement, net classes,
  saved copper and synchronization.
- [Autorouting](Autorouting.md): backends, waypoints and forbidden regions.
- [Board composition](BoardComposition.md): reusable placed and routed blocks.
- [Projects and panels](ProjectsAndPanels.md): project-local libraries and panels.
- [Front panels](FrontPanel.md): openings, artwork and layered DXF/SVG exports.
- [Rendering](Rendering.md): named board views and model exports.
- [Physical assemblies](Assembly.md): combine boards and mechanical models in the
  local viewer and render named cameras.

## Component libraries

- [Module](Module.md): define reusable physical parts.
- [Symbols](KicadSymbol.md), [footprints](KicadFootprint.md) and
  [3D models](Kicad3DModel.md): generate library assets from code.
- [Datasheets](Datasheets.md): component and footprint PDFs.
- [Component cost](ComponentCost.md): supplier and assembly cost information.

## Contributing

- [Framework and project boundary](ProjectBoundary.md): where reusable behavior belongs.
- [Documentation site](Documentation.md): edit, validate and publish the guides.

Native KiCad review remains part of board release. Schematic readability warnings
are drawing aids; they do not replace connectivity checks or filled-zone PCB DRC.
