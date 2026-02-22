import * as path from "path";
import { resolveSchematic, die } from "@tobisk/pcbs/cli/utils";
import { CircuitSnapshot } from "@tobisk/pcbs";

/**
 * synth: Compile TypeScript schematic → Generate KiCad files directly
 */
export async function cmdSynth(args: string[]): Promise<void> {
  const entry = args[0];
  const schematicPath = await resolveSchematic(entry);
  const schematicDir = path.dirname(schematicPath);
  const schematicName = path.basename(schematicDir);

  console.log(`\n🚀  Synthesizing: ${schematicName}\n`);

  // Step 1: Load the TypeScript schematic
  try {
    const mod = require(schematicPath);
    const schematic = mod.default;

    if (!schematic || typeof schematic.generate !== "function") {
      die(`${schematicPath} must have a default export that is a Schematic instance with a generate() method.`);
    }

    const noWires = args.includes("--no-wires");
    const noSymbols = args.includes("--no-symbols");

    console.log(`  → Generating circuit: ${schematic.name}...`);
    schematic.generate();
    console.log(`  ✅ Circuit generation complete.`);

    console.log(`  → Generating KiCad files...`);
    const { runSynthesis } = require("@tobisk/pcbs/cli/synthesis");

    const snapshot = schematic._generateWithCapture() as CircuitSnapshot;
    const result = runSynthesis(snapshot, schematicDir, { noWires, noSymbols });

    if (result.success) {
      console.log(`  ✅ Synthesis successful!`);
      console.log(`  📂 Output: ${schematicDir}`);
    } else {
      console.log(`  📂 Output: ${schematicDir}`);
      console.warn(`\n  ⚠️  Synthesis completed with warnings! The schematic was generated but may have issues. Use with caution.`);
      if (result.errors && result.errors.length > 0) {
        console.warn(`\n  Errors:\n` + result.errors.map((e: string) => `    - ${e}`).join('\n'));
      }
      process.exit(1);
    }

  } catch (err: any) {
    die(`Synthesis failed: ${err.message}`);
  }
}
