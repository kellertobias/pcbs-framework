# @tobisk/pcbs

Design circuits in TypeScript and generate native KiCad schematics, PCB files,
component libraries, mechanical parts and manufacturing exports.

**[Read the documentation](https://kellertobias.github.io/pcbs-framework/)**

## Get started

Use Node.js 22 LTS and KiCad 10 with its symbol and footprint libraries installed.

```sh
npm install @tobisk/pcbs typescript ts-node
npx @tobisk/pcbs --help
```

Follow the [quick start](docs/QuickStart.md) to create and synthesize a circuit.
See [code and generated results](docs/Examples.md) for source beside real KiCad
schematic, copper and 3D renders, including downloadable generated files.
The installed executable is `pcb`; `npx @tobisk/pcbs` invokes the same CLI.

## Design workflow

Keep the circuit in its main TypeScript file, schematic groups and drawing hints
in `schematic-routing.ts`, and physical placement and routing policy in
`pcb-routing.ts`. Generate KiCad assets from those sources. Generated files go in
`export/` beside the board source; recoverable backups go in `.backups/`.

- [Functional schematic layout](docs/AutomaticSchematicLayout.md): automatic groups,
  circuit-method decorators, project branding and native multipage schematics.
- [Boards and autorouting](docs/PCB.md): physical placement, persistent copper and
  [automatic routing constraints](docs/Autorouting.md).
- [Projects and panels](docs/ProjectsAndPanels.md): reusable libraries, multiple
  boards and manufacturing panels.
- [Component libraries](docs/Module.md): generated symbols, footprints and 3D models.
- [Assemblies](docs/Assembly.md), [rendering](docs/Rendering.md) and
  [front panels](docs/FrontPanel.md): mechanical review and exports.
- [CLI reference](docs/CLI.md) and [all guides](docs/Home.md).

`synth` preserves an existing PCB by default. `--pcb sync` updates declared
placement and nets; automatic routing may regenerate copper when its inputs change.
Choose `pcb.autoRoute: false` for the manual persistent-routing workflow. Review
native KiCad connectivity, filled zones and DRC before fabrication.

## Develop the framework

```sh
npm ci
npm run typecheck
npm run build
npm test
python3 scripts/test_export_pcb_dxf.py
npm run docs:build
```

See the [framework boundary](docs/ProjectBoundary.md) for ownership and the
[documentation guide](docs/Documentation.md) for local preview and GitHub Pages.
The source Markdown is shared by GitHub browsing and the documentation site.

## License

[MIT](LICENSE.md).
