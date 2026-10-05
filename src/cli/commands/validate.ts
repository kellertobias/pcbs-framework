import { findPcbProject } from '../../project/PcbProject';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { getConfig } from '@tobisk/pcbs/cli/config';
import { die } from '@tobisk/pcbs/cli/utils';

/**
 * validate: Verify that the generated KiCad libraries are valid and parsable.
 * Uses kicad-cli to attempt an export to SVG (hidden).
 */
export async function cmdValidate(args: string[]): Promise<void> {
    console.log(`\n🔍  Validating KiCad Libraries...`);

    const { projectRoot, kicadCliPath } = getConfig();
    const project = args[0] ? findPcbProject(args[0]) : undefined;
    const LIB_DIR = path.join(project?.directory ?? projectRoot, '.kicad');
    const SYMBOLS_FILE = path.join(LIB_DIR, 'Project_Symbols.kicad_sym');
    const FOOTPRINTS_DIR = path.join(LIB_DIR, 'Project_Footprints.pretty');

    if (!fs.existsSync(kicadCliPath)) {
        die(`kicad-cli not found at ${kicadCliPath}. Please ensure KiCad is installed.`);
    }

    const tmpDir = path.join(projectRoot, 'tmp', 'validation');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    let hasErrors = false;

    // 1. Validate Symbols
    if (fs.existsSync(SYMBOLS_FILE)) {
        console.log(`  → Validating Symbols: ${path.relative(projectRoot, SYMBOLS_FILE)}`);
        try {
            // We use 'sym export svg' as a parser check
            execSync(`"${kicadCliPath}" sym export svg "${SYMBOLS_FILE}" --output "${tmpDir}"`, {
                stdio: 'pipe',
            });
            console.log(`    ✅ Symbols are valid.`);
        } catch (err: any) {
            console.error(`    ❌ Symbol Validation Failed:\n${err.stderr.toString()}`);
            hasErrors = true;
        }
    } else {
        console.log(`  ⚠️  Symbols file not found, skipping.`);
    }

    // 2. Validate Footprints
    if (fs.existsSync(FOOTPRINTS_DIR)) {
        console.log(`  → Validating Footprints: ${path.relative(projectRoot, FOOTPRINTS_DIR)}/`);
        try {
            // We use 'fp export svg' as a parser check
            execSync(`"${kicadCliPath}" fp export svg "${FOOTPRINTS_DIR}" --output "${tmpDir}"`, {
                stdio: 'pipe',
            });
            console.log(`    ✅ Footprints are valid.`);
        } catch (err: any) {
            console.error(`    ❌ Footprint Validation Failed:\n${err.stderr.toString()}`);
            hasErrors = true;
        }
    } else {
        console.log(`  ⚠️  Footprints directory not found, skipping.`);
    }

    // Cleanup
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {}

    if (hasErrors) {
        console.log(`\n❌  Library validation failed.\n`);
        process.exit(1);
    } else {
        console.log(`\n✨  Library validation successful!\n`);
    }
}
