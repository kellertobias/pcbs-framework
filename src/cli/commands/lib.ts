import { findPcbProject } from '../../project/PcbProject';
import { BoardModule } from '../../synth/BoardModule';
import * as path from 'path';
import * as fs from 'fs';
import { getConfig } from '@tobisk/pcbs/cli/config';
import { die } from '@tobisk/pcbs/cli/utils';
import { cmdValidate } from './validate';

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

    const { projectRoot, sourceRoot, schematicsDir } = getConfig();
    const project = args[0]
        ? (findPcbProject(path.resolve(args[0])) ??
          findPcbProject(path.join(schematicsDir, args[0])))
        : undefined;
    if (args[0] && !project) throw new Error(`PCB project not found: ${args[0]}`);
    const LIB_DIR = path.join(project?.directory ?? projectRoot, '.kicad');
    const SYMBOLS_FILE = path.join(LIB_DIR, 'Project_Symbols.kicad_sym');
    const FOOTPRINTS_DIR = path.join(LIB_DIR, 'Project_Footprints.pretty');
    const MODELS_3D_DIR = path.join(LIB_DIR, '3d');
    const MODULES_DIR = path.join(sourceRoot, 'module');

    const { KicadLibrary } = require('@tobisk/pcbs/KicadLibrary');
    const mergedLib = new KicadLibrary();

    const scan = (directory: string): string[] =>
        !fs.existsSync(directory)
            ? []
            : fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
                  const file = path.join(directory, entry.name);
                  return entry.isDirectory()
                      ? scan(file)
                      : entry.name.endsWith('.ts') &&
                          !entry.name.endsWith('.test.ts') &&
                          entry.name !== 'index.ts'
                        ? [file]
                        : [];
              });
    const files = (project?.moduleDirectories ?? [MODULES_DIR]).flatMap(scan);

    if (files.length === 0) {
        console.log('  ⚠️  No modules found in src/module.');
        return;
    }

    // Track footprints by class name so we can attach 3D models
    const footprintsByClass = new Map<string, any>();
    const modelsByFootprint = new Map<string, string>();
    const failures: string[] = [];
    const classesWithMake3D: Array<{ className: string; Class: any }> = [];

    for (const modulePath of files) {
        const file = path.basename(modulePath);
        const className = path.basename(file, '.ts');

        console.log(`  → Processing: ${className} (${file})`);

        try {
            // Clear cache to ensure we get fresh definitions
            delete require.cache[require.resolve(modulePath)];
            const mod = require(modulePath);
            const Class = mod[className];

            if (!Class) {
                console.warn(`  ⚠️  Warning: Could not find named export "${className}" in ${file}`);
                failures.push(`${className}: missing named export`);
                continue;
            }

            // Board-derived footprints/models are built per source variant during PCB synthesis.
            const isBoardModule = Class.prototype instanceof BoardModule;
            if (!isBoardModule && typeof Class.makeFootprint === 'function') {
                const fp = await Class.makeFootprint();
                if (typeof Class.makeDatasheet === 'function') {
                    const metadata = await Class.makeDatasheet();
                    if (metadata) fp.setDatasheet(metadata);
                }
                mergedLib.addFootprint(fp);
                footprintsByClass.set(className, fp);
            } else if (!isBoardModule) {
                console.warn(`  ⚠️  Warning: ${className} has no static makeFootprint() method.`);
            }

            if (typeof Class.makeSymbol === 'function') {
                mergedLib.addSymbol(Class.makeSymbol());
            } else {
                console.warn(`  ⚠️  Warning: ${className} has no static makeSymbol() method.`);
            }

            // Check for 3D model support
            if (!isBoardModule && typeof Class.make3DModel === 'function') {
                classesWithMake3D.push({ className, Class });
            }
        } catch (err: any) {
            console.error(`  ❌ Error processing module ${className}: ${err.message}`);
            failures.push(`${className}: ${err.message}`);
        }
    }

    const symbolCount = mergedLib.symbols.length;
    const footprintCount = mergedLib.footprints.length;

    if (symbolCount === 0 && footprintCount === 0) {
        if (failures.length)
            throw new Error(`Library generation incomplete:\n${failures.join('\n')}`);
        console.log('\n  ⚠️  No symbols or footprints were successfully generated.');
        return;
    }

    // Generate 3D models
    if (classesWithMake3D.length > 0) {
        console.log(`\n🧊  Generating 3D models...`);
        for (const { className, Class } of classesWithMake3D) {
            try {
                const modelResult = Class.make3DModel();
                const model =
                    modelResult && typeof modelResult.then === 'function'
                        ? await modelResult
                        : modelResult;

                if (model) {
                    const result = await model.export({
                        outDir: MODELS_3D_DIR,
                        baseName: className,
                        formats: ['wrl'],
                    });

                    if (result.wrlPath) {
                        // Link the 3D model into the footprint
                        const fp = footprintsByClass.get(className);
                        if (fp && typeof fp.set3DModel === 'function') {
                            fp.set3DModel({ path: result.wrlPath });
                            modelsByFootprint.set(fp.name, fs.readFileSync(result.wrlPath, 'utf8'));
                        }
                        console.log(`  ✅ 3D Model → .kicad/3d/${className}.wrl`);
                    }
                }
            } catch (err: any) {
                console.error(
                    `  ❌ Error generating 3D model for ${className}: ${err?.message ?? err}`,
                );
                if (err?.stack) console.error(err.stack);
                failures.push(`${className} model: ${err?.message ?? err}`);
            }
        }
    }

    console.log(
        `\n📦  Writing library: ${symbolCount} symbol(s), ${footprintCount} footprint(s)\n`,
    );

    if (symbolCount > 0) {
        mergedLib.writeSymbols(SYMBOLS_FILE);
        console.log(`  ✅ Symbols → ${path.relative(projectRoot, SYMBOLS_FILE)}`);
    }

    if (footprintCount > 0) {
        const paths = mergedLib.writeFootprints(FOOTPRINTS_DIR);
        console.log(`  ✅ Footprints → ${path.relative(projectRoot, FOOTPRINTS_DIR)}/`);
    }

    console.log(`\n📄  Generating a datasheet for every footprint...`);
    const datasheets = await mergedLib.writeDatasheets(
        path.join(LIB_DIR, 'datasheets', 'footprints'),
        modelsByFootprint,
    );
    console.log(`  ✅ ${datasheets.length} PDFs → .kicad/datasheets/footprints/`);
    if (failures.length) throw new Error(`Library generation incomplete:\n${failures.join('\n')}`);
    await cmdValidate(project ? [project.directory] : []);
}
