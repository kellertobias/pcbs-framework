import * as fs from "fs";
import * as path from "path";
import { CircuitSnapshot } from "../synth/types";
import { SymbolLibrary } from "./SymbolLibrary";
import { UuidManager } from "./UuidManager";
import { SchematicGenerator } from "./SchematicGenerator";
import { NetlistGenerator } from "./NetlistGenerator";
import { KicadLibrary } from "../synth/KicadLibrary";

export interface KicadGeneratorOptions {
  noWires?: boolean;
  noSymbols?: boolean;
  experimentalRouting?: boolean;
  experimentalLayout?: boolean;
}

export class KicadGenerator {
  private library: SymbolLibrary;
  private uuids: UuidManager;
  public errors: string[] = [];

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

  generate(snapshot: CircuitSnapshot, outputDir: string, options: KicadGeneratorOptions = {}) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const name = snapshot.name;
    const schPath = path.join(outputDir, `${name}.kicad_sch`);
    const netPath = path.join(outputDir, `${name}.net`);
    const uuidPath = path.join(outputDir, "uuids.json");

    // Validate component references end in a number
    for (const comp of snapshot.components) {
      if (comp.symbol === "Device:DNC" || comp.ref === "#PWR") continue;
      if (!/\d+$/.test(comp.ref)) {
        throw new Error(`Invalid Reference: Component '${comp.ref}' (${comp.symbol}) must end in a number to be compatible with KiCad annotation.`);
      }
    }

    // Load existing UUIDs
    this.uuids.load(uuidPath);

    // Generate Schematic
    console.log(`  → Generating Schematic: ${schPath}...`);
    const schematicGen = new SchematicGenerator(snapshot, this.library, this.uuids, options);
    const schematicContent = schematicGen.generate();
    if (schematicGen.errors.length > 0) {
      this.errors.push(...schematicGen.errors);
    }
    fs.writeFileSync(schPath, schematicContent, "utf-8");

    // Generate Netlist
    console.log(`  → Generating Netlist: ${netPath}...`);
    const netlistGen = new NetlistGenerator(snapshot, this.library, this.uuids, schPath);
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

    // Generate minimalistic PCB file if missing
    const pcbPath = path.join(outputDir, `${name}.kicad_pcb`);
    if (!fs.existsSync(pcbPath)) {
      const pcbContent = `(kicad_pcb
	(version 20241229)
	(generator "pcbnew")
	(generator_version "9.0")
	(general
		(thickness 1.6)
		(legacy_teardrops no)
	)
	(paper "A4")
	(layers
		(0 "F.Cu" signal)
		(2 "B.Cu" signal)
		(9 "F.Adhes" user "F.Adhesive")
		(11 "B.Adhes" user "B.Adhesive")
		(13 "F.Paste" user)
		(15 "B.Paste" user)
		(5 "F.SilkS" user "F.Silkscreen")
		(7 "B.SilkS" user "B.Silkscreen")
		(1 "F.Mask" user)
		(3 "B.Mask" user)
		(17 "Dwgs.User" user "User.Drawings")
		(19 "Cmts.User" user "User.Comments")
		(21 "Eco1.User" user "User.Eco1")
		(23 "Eco2.User" user "User.Eco2")
		(25 "Edge.Cuts" user)
		(27 "Margin" user)
		(31 "F.CrtYd" user "F.Courtyard")
		(29 "B.CrtYd" user "B.Courtyard")
		(35 "F.Fab" user)
		(33 "B.Fab" user)
		(39 "User.1" user)
		(41 "User.2" user)
		(43 "User.3" user)
		(45 "User.4" user)
	)
	(setup
		(pad_to_mask_clearance 0)
		(allow_soldermask_bridges_in_footprints no)
		(tenting front back)
	)
	(net 0 "")
	(embedded_fonts no)
)
`;
      fs.writeFileSync(pcbPath, pcbContent, "utf-8");
    }

    return { success: this.errors.length === 0, errors: this.errors };
  }
}
