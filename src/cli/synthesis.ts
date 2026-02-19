import { spawnSync } from "child_process";
import * as path from "path";
import { generatePython, CircuitSnapshot } from "./codegen";
import { KicadLibrary } from "../synth/KicadLibrary";
import * as fs from "fs";
import { getConfig } from "./config";

/** Escape a Python string value (duplicated from codegen for independence) */
function pyStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Execute the generated Python code via circuit-synth.
 * 
 * Appends the execution boilerplate to the code and runs it through
 * the project's Python virtual environment.
 */
export function runSynthesis(snapshot: CircuitSnapshot, outputDir: string): { success: boolean; output: string } {
  const code = generatePython(snapshot);
  const funcName = snapshot.name.toLowerCase().replace(/[^a-z0-9_]/g, "_");

  const { projectRoot, pythonPath } = getConfig();

  // Execution boilerplate
  const runScript = `
if __name__ == "__main__":
    import os
    import sys
    
    # Run the circuit function
    circuit_obj = ${funcName}()
    
    # Generate the KiCad project
    # circuit-synth will create the folder if it doesn't exist
    result = circuit_obj.generate_kicad_project(
        project_name=${pyStr(outputDir)},
        placement_algorithm=${pyStr(snapshot.placementAlgorithm || "hierarchical")},
        generate_pcb=False,
        force_regenerate=True,
    )
    import json
    # Convert Paths to strings for JSON serialization
    ser_result = {k: str(v) if hasattr(v, "__fspath__") or hasattr(v, "parts") else v for k, v in result.items()}
    print("RES:" + json.dumps(ser_result))
`;

  const fullCode = code + runScript;

  // Setup environment for circuit-synth
  const env = { ...process.env };
  const localLib = path.join(projectRoot, "lib");
  const kicadLib = path.join(projectRoot, ".kicad");
  const systemLib = "/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols";

  // Set KICAD_SYMBOL_DIR and PYTHONPATH
  const testSyms = path.join(projectRoot, "src", "tests", "assets", "symbols");
  env.KICAD_SYMBOL_DIR = `${localLib}:${kicadLib}:${testSyms}:${systemLib}`;
  env.PYTHONPATH = `${projectRoot}:${process.env.PYTHONPATH || ""}`;

  const res = spawnSync(pythonPath, ["-c", fullCode], {
    cwd: projectRoot,
    env,
    encoding: "utf-8",
  });

  if (res.error) {
    return { success: false, output: res.error.message };
  }

  const output = res.stdout + (res.stderr || "");
  const jsonMatch = output.match(/RES:({.*})/);
  const synthResult = jsonMatch ? JSON.parse(jsonMatch[1]) : null;

  const success = res.status === 0 && (synthResult ? synthResult.success : true);

  if (success) {
    // Generate library tables in the project directory
    try {
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
    success,
    output: output,
  };
}
