import * as path from "path";
import * as fs from "fs";
import { CircuitSnapshot } from "../synth/types";
import { KicadGenerator } from "../kicad/KicadGenerator";
import { KicadLibrary } from "../synth/KicadLibrary";
import { getConfig } from "./config";

/**
 * Execute the circuit generation using native TypeScript generator.
 */
export function runSynthesis(snapshot: CircuitSnapshot, outputDir: string): { success: boolean; output: string } {
  const { projectRoot } = getConfig();

  // Define library search paths
  const libPaths = [
    path.join(projectRoot, ".kicad"), // Local project symbols
    path.join(projectRoot, "lib"),    // Legacy lib folder
    path.join(projectRoot, "src", "tests", "assets", "symbols"), // Test assets
    // Add system paths?
    // KicadGenerator will add defaults from env or common locations if not found.
    // But better to pass them explicitly if we know them.
  ];

  const generator = new KicadGenerator(libPaths);

  try {
      const result = generator.generate(snapshot, outputDir);

      if (result.success) {
        // Generate library tables in the project directory
        // This logic is preserved from original implementation
        try {
          const kicadLib = path.join(projectRoot, ".kicad");
          const relPath = path.relative(outputDir, kicadLib);

          const fpTable = KicadLibrary.generateFpLibTable(relPath);
          const symTable = KicadLibrary.generateSymLibTable(relPath);

          fs.writeFileSync(path.join(outputDir, "fp-lib-table"), fpTable);
          fs.writeFileSync(path.join(outputDir, "sym-lib-table"), symTable);

          console.log(`  ✅ Generated KiCad library tables in project directory.`);
        } catch (err: any) {
          console.warn(`  ⚠️  Failed to generate library tables: ${err.message}`);
        }
      }

      return {
        success: true,
        output: "Successfully generated KiCad schematic and netlist.",
      };
  } catch (e: any) {
      return {
          success: false,
          output: `Generation failed: ${e.message}\n${e.stack}`,
      };
  }
}
