import * as path from "path";
import * as fs from "fs";
import { getConfig } from "@tobisk/pcbs/cli/config";
import { die } from "@tobisk/pcbs/cli/utils";
import { cmdValidate } from "./validate";

/**
 * lib: Generate / update the KiCad library from TypeScript definitions.
 *
 * Usage:
 *   npm run lib
 *
 * Automatically scans src/module for all modules and generates symbols/footprints.
 * Also generates 3D models when make3DModel() is implemented.
 */
export async function cmdLib(args: string[]): Promise<void> {
  console.log(`\n📚  KiCad Library Generator`);

  const { projectRoot, sourceRoot } = getConfig();
  const LIB_DIR = path.join(projectRoot, ".kicad");
  const SYMBOLS_FILE = path.join(LIB_DIR, "Project_Symbols.kicad_sym");
  const FOOTPRINTS_DIR = path.join(LIB_DIR, "Project_Footprints.pretty");
  const MODELS_3D_DIR = path.join(LIB_DIR, "3d");
  const MODULES_DIR = path.join(sourceRoot, "module");

  const { KicadLibrary } = require("@tobisk/pcbs/KicadLibrary");
  const mergedLib = new KicadLibrary();

  if (!fs.existsSync(MODULES_DIR)) {
    die(`Modules directory not found: ${MODULES_DIR}`);
  }

  const files = fs.readdirSync(MODULES_DIR)
    .filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "index.ts");

  if (files.length === 0) {
    console.log("  ⚠️  No modules found in src/module.");
    return;
  }

  // Track footprints by class name so we can attach 3D models
  const footprintsByClass = new Map<string, any>();
  const classesWithMake3D: Array<{ className: string; Class: any }> = [];

  for (const file of files) {
    const className = path.basename(file, ".ts");
    const modulePath = path.join(MODULES_DIR, file);

    console.log(`  → Processing: ${className} (${file})`);

    try {
      // Clear cache to ensure we get fresh definitions
      delete require.cache[require.resolve(modulePath)];
      const mod = require(modulePath);
      const Class = mod[className];

      if (!Class) {
        console.warn(`  ⚠️  Warning: Could not find named export "${className}" in ${file}`);
        continue;
      }

      if (typeof Class.makeFootprint === "function") {
        const fp = Class.makeFootprint();
        mergedLib.addFootprint(fp);
        footprintsByClass.set(className, fp);
      } else {
        console.warn(`  ⚠️  Warning: ${className} has no static makeFootprint() method.`);
      }

      if (typeof Class.makeSymbol === "function") {
        mergedLib.addSymbol(Class.makeSymbol());
      } else {
        console.warn(`  ⚠️  Warning: ${className} has no static makeSymbol() method.`);
      }

      // Check for 3D model support
      if (typeof Class.make3DModel === "function") {
        classesWithMake3D.push({ className, Class });
      }
    } catch (err: any) {
      console.error(`  ❌ Error processing module ${className}: ${err.message}`);
    }
  }

  const symbolCount = mergedLib.symbols.length;
  const footprintCount = mergedLib.footprints.length;

  if (symbolCount === 0 && footprintCount === 0) {
    console.log("\n  ⚠️  No symbols or footprints were successfully generated.");
    return;
  }

  // Generate 3D models
  if (classesWithMake3D.length > 0) {
    console.log(`\n🧊  Generating 3D models...`);
    for (const { className, Class } of classesWithMake3D) {
      try {
        const modelResult = Class.make3DModel();
        const model = modelResult && typeof modelResult.then === "function"
          ? await modelResult
          : modelResult;

        if (model) {
          const result = await model.export({
            outDir: MODELS_3D_DIR,
            baseName: className,
            formats: ["wrl"],
          });

          if (result.wrlPath) {
            // Link the 3D model into the footprint
            const fp = footprintsByClass.get(className);
            if (fp && typeof fp.set3DModel === "function") {
              fp.set3DModel({ path: result.wrlPath });
            }
            console.log(`  ✅ 3D Model → .kicad/3d/${className}.wrl`);
          }
        }
      } catch (err: any) {
        console.error(`  ❌ Error generating 3D model for ${className}: ${err?.message ?? err}`);
        if (err?.stack) console.error(err.stack);
      }
    }
  }

  console.log(`\n📦  Writing library: ${symbolCount} symbol(s), ${footprintCount} footprint(s)\n`);

  if (symbolCount > 0) {
    mergedLib.writeSymbols(SYMBOLS_FILE);
    console.log(`  ✅ Symbols → ${path.relative(projectRoot, SYMBOLS_FILE)}`);
  }

  if (footprintCount > 0) {
    const paths = mergedLib.writeFootprints(FOOTPRINTS_DIR);
    console.log(`  ✅ Footprints → ${path.relative(projectRoot, FOOTPRINTS_DIR)}/`);
  }

  await cmdValidate(args);
}

