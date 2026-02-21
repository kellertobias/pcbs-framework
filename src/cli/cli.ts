#!/usr/bin/env node

/**
 * PCB Framework CLI
 */

import "ts-node/register";
import "tsconfig-paths/register";
// import { ensurePythonEnv } from "./env"; // Removed
import { cmdSynth } from "./commands/synth";
import { cmdExport } from "./commands/export";
import { cmdPrint } from "./commands/print";
import { cmdParts } from "./commands/parts";
import { cmdLib } from "./commands/lib";
import { cmdTypes } from "./commands/types";
import { cmdSetup } from "./commands/setup";

// Parse args for --root early to configure environment
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === "--root" && process.argv[i + 1]) {
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
  synth [entry]                  Synthesize a schematic to KiCad project
  export [entry]                 Export gerber, BOM, and placement files
  print [entry]                  Print schematic to PDF
  parts [--footprint <fp>] [--value <val>]
                                 Search JLC Parts for components
  lib [module ...]               Generate/update KiCad library from TS modules
  types                          Sync KiCad library symbols and footprints to TS types
  setup                          Configure project tsconfig.json for KiCad types

Schematic Selection:
  If no entry is provided for synth/export, an interactive list of
  available schematics from src/schematics/ is shown.

Examples:
  npx @tobisk/pcbs synth my_board
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
    case "synth":
      return cmdSynth(commandArgs);
    case "export":
      return cmdExport(commandArgs);
    case "print":
      return cmdPrint(commandArgs);
    case "parts":
      return cmdParts(commandArgs);
    case "lib":
      return cmdLib(commandArgs);
    case "types":
      return cmdTypes(commandArgs);
    case "setup":
      return cmdSetup(commandArgs);
    case "--help":
    case "-h":
    case "help":
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
