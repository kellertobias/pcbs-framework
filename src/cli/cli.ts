#!/usr/bin/env node
import { cmdProjects } from './commands/projects';
import { cmdDxf } from './commands/dxf';
import { cmdRenderAssembly } from './commands/render-assembly';

/**
 * PCB Framework CLI
 */

import 'ts-node/register';
import 'tsconfig-paths/register';
// import { ensurePythonEnv } from "./env"; // Removed
import { cmdSynth } from './commands/synth';
import { cmdExport } from './commands/export';
import { cmdPrint } from './commands/print';
import { cmdPdf } from './commands/pdf';
import { cmdParts } from './commands/parts';
import { cmdLib } from './commands/lib';
import { cmdTypes } from './commands/types';
import { cmdSetup } from './commands/setup';
import { cmdFrontPanel } from './commands/frontpanel';
import { cmdCaptureRouting } from './commands/capture-routing';
import { cmdDatasheet, cmdFootprintPng } from './commands/datasheet';
import { cmdRenderBoard } from './commands/render-board';
import { cmdRenderSeries } from './commands/render-series';
import { cmdRouteJoin } from './commands/route-join';
import { cmdStitchZones } from './commands/stitch-zones';
import { cmdRoute } from './commands/route';
import { cmdViewAssembly } from './commands/view-assembly';

// Parse args for --root early to configure environment
for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--root' && process.argv[i + 1]) {
        process.env.SCHEMATICS_ROOT = process.argv[i + 1];
        break;
    }
}

function printHelp(): void {
    console.log(`
PCB Framework CLI

Usage:
  npx @tobisk/pcbs <command> [options]

Commands:
  view assembly <assembly.ts>    Open a local 3D assembly viewer
    [--port N] [--no-open] [--placements file.json] [--prepare-only --output directory]
  synth [entry] [--pcb <mode>] [--reload-kicad]
                                 Synthesize and optionally refresh an open PCB
  projects [name]                List PCB projects and their boards, panels, assemblies
  export [entry]                 Export gerber, BOM, and placement files (--no-renders)
  print [entry]                  Print schematic to PDF
  pdf [entry|kicad-file]         Export native schematic and one PCB PDF per side
    [--only all|schematic|pcb] [--output <dir>]
  dxf <board.kicad_pcb> [--layers selectors] [--output-dir directory]
                                 Export mechanical layers at 1:1 in millimetres
  parts [--footprint <fp>] [--value <val>]
                                 Search JLC Parts for components
  lib [module ...]               Generate KiCad library and per-footprint PDFs
  footprint-png <file>          Render a KiCad footprint as PNG
  datasheet <manifest.json>      Generate a component datasheet PDF
  datasheet --all                Regenerate PDFs for all library footprints
  types                          Sync KiCad library symbols and footprints to TS types
  setup                          Configure project tsconfig.json for KiCad types
  frontpanel <schematic> <name>  Export a named schematic panel to four-layer DXF/SVG
    --list [--pcb <file>] [--output <dir>]
  frontpanel [entry|pcb]         Legacy footprint-property panel export
    --edge top|right|bottom|left --components J1,J2 --height <mm>
    [--bottom-z <mm>] [--output <dir>]  Export selected vertical interfaces
  capture-routing [entry]        Save actual PCB copper to routing.json
  route-join <board> --net NET --from Ref.pad --to Ref.pad
                                 Save a local signal/ground join to routing.json
  stitch-zones <board> --net GND Save filled-zone stitching to routing.json
  pcb-png <board> --output file  KiCad layer plot as PNG
  renders assembly <file.ts>   Render named assembly views as PNG
  renders <series.ts>          Render named views/exports (--only names, --output-dir dir)
  pcb-3d <board> --output file   KiCad board/model render as PNG
  pcb-model <board> --output file  Export actual board assembly as WRL
  route [entry] [options]        Incrementally autoroute eligible unrouted nets

Schematic Selection:
  If no entry is provided for synth/export, an interactive list of
  available schematics from src/schematics/ is shown.

PCB Modes:
  preserve  Do not read or write the PCB (default; safest for routed boards)
  sync      Merge declared footprint placement and nets; preserve copper/manual objects
  rebuild   Back up the existing PCB and generate a fresh declared board

KiCad Reload:
  --reload-kicad   On macOS, save the exactly matching open PCB through KiCad's
                   IPC API before sync and reload it from disk afterwards.
                   Requires --pcb sync/rebuild, kicad-python, and KiCad's IPC
                   API enabled in Preferences → Plugins.

Routing Options:
  --backend capacity             Use the local tscircuit PCB autorouter (default)
  --backend simple               Use the basic Manhattan router
  --all                          Include unhinted unrouted nets (default with capacity)
  --reroute-net <name>           Explicitly replace copper for a selected net; repeatable
  --no-drc                       Skip post-route KiCad DRC (human review is always required)

Examples:
  npx @tobisk/pcbs synth my_board --pcb sync
  npx @tobisk/pcbs synth my_board --pcb sync --reload-kicad
  npx @tobisk/pcbs route my_board --backend capacity
  npx @tobisk/pcbs route my_board --reroute-net STATUS_LED
  npx @tobisk/pcbs synth ./src/schematics/my_board/index.ts
  npx @tobisk/pcbs export my_board
  npx @tobisk/pcbs print my_board
  npx @tobisk/pcbs parts --footprint 0603 --value 10k
  npx @tobisk/pcbs parts
`);
}

async function main(): Promise<void> {
    // Ensure dependencies are met before doing anything else
    // ensurePythonEnv(); // Removed

    const args = process.argv.slice(2);
    const command = args[0];
    const commandArgs = args.slice(1);

    switch (command) {
        case 'projects':
            cmdProjects(commandArgs);
            break;
        case 'dxf':
            return cmdDxf(commandArgs);
        case 'view':
            await cmdViewAssembly(commandArgs);
            break;
        case 'route-join':
            await cmdRouteJoin(commandArgs);
            break;
        case 'stitch-zones':
            await cmdStitchZones(commandArgs);
            break;
        case 'renders':
            if (commandArgs[0] === 'assembly') await cmdRenderAssembly(commandArgs);
            else await cmdRenderSeries(commandArgs);
            break;
        case 'pcb-png':
            await cmdRenderBoard(commandArgs, 'layers');
            break;
        case 'pcb-3d':
            await cmdRenderBoard(commandArgs, '3d');
            break;
        case 'pcb-model':
            await cmdRenderBoard(commandArgs, 'model');
            break;
        case 'synth':
            return cmdSynth(commandArgs);
        case 'export':
            return cmdExport(commandArgs);
        case 'print':
            return cmdPrint(commandArgs);
        case 'pdf':
            return cmdPdf(commandArgs);
        case 'parts':
            return cmdParts(commandArgs);
        case 'lib':
            return cmdLib(commandArgs);
        case 'footprint-png':
            return cmdFootprintPng(commandArgs);
        case 'datasheet':
            return cmdDatasheet(commandArgs);
        case 'types':
            return cmdTypes(commandArgs);
        case 'setup':
            return cmdSetup(commandArgs);
        case 'frontpanel':
            return cmdFrontPanel(commandArgs);
        case 'capture-routing':
            return cmdCaptureRouting(commandArgs);
        case 'route':
            return cmdRoute(commandArgs);
        case '--help':
        case '-h':
        case 'help':
            printHelp();
            break;
        default:
            if (command) {
                console.error(`Unknown command: ${command}\n`);
            }
            printHelp();
            process.exit(command ? 1 : 0);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
