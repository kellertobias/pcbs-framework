import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../config';
import { configureOutputIgnore } from '../../project/OutputPaths';
import { prompt } from '../utils';

/**
 * Commands to automate configuration of the project's environment.
 */
export async function cmdSetup(args: string[]): Promise<void> {
    console.log('🚀  Setting up project environment...\n');

    const { projectRoot } = getConfig();
    const packageFile = path.join(projectRoot, 'package.json');
    if (
        fs.existsSync(packageFile) &&
        JSON.parse(fs.readFileSync(packageFile, 'utf8')).name === '@tobisk/pcbs'
    ) {
        console.log('  Framework repository detected; project setup skipped.');
        return;
    }
    const choice = async (name: 'exports' | 'backups', label: string, fallback: boolean) => {
        if (args.includes(`--ignore-${name}`) && args.includes(`--track-${name}`))
            throw new Error(`Choose either --ignore-${name} or --track-${name}.`);
        if (args.includes(`--ignore-${name}`)) return true;
        if (args.includes(`--track-${name}`)) return false;
        if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
        const answer = await prompt(`Ignore ${label} in Git? ${fallback ? '[Y/n]' : '[y/N]'} `);
        return answer ? /^y(es)?$/i.test(answer) : fallback;
    };
    const exports = await choice('exports', 'export/ (including PDFs and renders)', false);
    const backups = await choice('backups', '.backups/', true);
    configureOutputIgnore(projectRoot, exports === true, backups === true);
    if (exports === undefined || backups === undefined)
        console.log(
            '  Generated files go in export/, images in export/renders/, backups in .backups/.\n  Run pcb setup to choose the Git policy, or use --track-exports --ignore-backups. Non-interactive installation leaves .gitignore unchanged.',
        );
    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');

    if (!fs.existsSync(tsconfigPath)) {
        console.warn(
            '⚠️  Could not find tsconfig.json in project root. Skipping path mapping setup.',
        );
        return;
    }

    try {
        const tsconfigRaw = fs.readFileSync(tsconfigPath, 'utf-8');
        const tsconfig = JSON.parse(tsconfigRaw);

        // Don't update tsconfig if we are in the framework repo itself
        const packageJsonPath = path.join(projectRoot, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            if (pkg.name === '@tobisk/pcbs') {
                console.log(
                    '  ℹ️  Framework repository detected. Skipping tsconfig.json path mapping setup.',
                );
                return;
            }
        }

        if (!tsconfig.compilerOptions) {
            tsconfig.compilerOptions = {};
        }

        if (!tsconfig.compilerOptions.paths) {
            tsconfig.compilerOptions.paths = {};
        }

        const virtualPath = '@tobisk/pcbs/kicad-types';
        const localPath = ['./src/kicad-library.ts'];

        // Check if mapping already exists and is correct
        const currentMapping = tsconfig.compilerOptions.paths[virtualPath];
        if (JSON.stringify(currentMapping) === JSON.stringify(localPath)) {
            console.log('  ✅ tsconfig.json path mapping is already correct.');
        } else {
            tsconfig.compilerOptions.paths[virtualPath] = localPath;
            fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf-8');
            console.log(`  ✅ Added path mapping to tsconfig.json: ${virtualPath} → ${localPath}`);
        }
    } catch (err: any) {
        console.warn(`  ⚠️  Failed to update tsconfig.json: ${err.message}`);
    }
}
