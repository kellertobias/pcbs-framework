import * as fs from "fs";
import * as path from "path";
import { CircuitSnapshot } from "../synth/types";
import { SymbolLibrary } from "./SymbolLibrary";
import { UuidManager } from "./UuidManager";
import { SchematicGenerator } from "./SchematicGenerator";
import { NetlistGenerator } from "./NetlistGenerator";
import { KicadLibrary } from "../synth/KicadLibrary";

export class KicadGenerator {
  private library: SymbolLibrary;
  private uuids: UuidManager;

  constructor(libraryPaths?: string[]) {
    this.library = new SymbolLibrary();
    this.uuids = new UuidManager();

    // Default library paths from environment
    const envPaths = process.env.KICAD_SYMBOL_DIR
      ? process.env.KICAD_SYMBOL_DIR.split(":")
      : [];

    // Standard system paths for KiCad symbols
    const systemPaths = [
        "/usr/share/kicad/symbols",
        "/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols",
        "C:\\Program Files\\KiCad\\share\\kicad\\symbols"
    ].filter(p => fs.existsSync(p));

    const paths = [...(libraryPaths || []), ...envPaths, ...systemPaths];
    this.library.setLibraryPaths(paths);
  }

  generate(snapshot: CircuitSnapshot, outputDir: string) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const name = snapshot.name;
    const schPath = path.join(outputDir, `${name}.kicad_sch`);
    const netPath = path.join(outputDir, `${name}.net`);
    const uuidPath = path.join(outputDir, "uuids.json");

    // Load existing UUIDs
    this.uuids.load(uuidPath);

    // Generate Schematic
    console.log(`  → Generating Schematic: ${schPath}...`);
    const schematicGen = new SchematicGenerator(snapshot, this.library, this.uuids);
    const schematicContent = schematicGen.generate();
    fs.writeFileSync(schPath, schematicContent, "utf-8");

    // Generate Netlist
    console.log(`  → Generating Netlist: ${netPath}...`);
    const netlistGen = new NetlistGenerator(snapshot, this.library, this.uuids);
    const netlistContent = netlistGen.generate();
    fs.writeFileSync(netPath, netlistContent, "utf-8");

    // Save UUIDs
    this.uuids.save();

    // Generate minimal project file if missing
    const proPath = path.join(outputDir, `${name}.kicad_pro`);
    if (!fs.existsSync(proPath)) {
        const proContent = JSON.stringify({
            meta: { filename: `${name}.kicad_pro`, version: 1 },
            board: {
                design_settings: {
                    rules: {
                        solder_mask_clearance: 0.0,
                        solder_mask_min_width: 0.0,
                        solder_paste_clearance: 0.0,
                        solder_paste_margin: 0.0
                    }
                }
            }
        }, null, 2);
        fs.writeFileSync(proPath, proContent, "utf-8");
    }

    return { success: true };
  }
}
