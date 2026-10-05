import { discoverPcbProjects, PROJECT_FILE, PcbProject } from '../project/PcbProject';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { getConfig } from './config';

/**
 * Find the best entry point for a schematic directory.
 * Priority: index.ts -> <dirName>.ts -> first .ts file found.
 */
function findSchematicEntry(dirName: string): string | null {
    const { schematicsDir } = getConfig();
    const dirPath = path.join(schematicsDir, dirName);
    const parts = dirName.split('/');
    const projectDirectory = path.join(schematicsDir, parts[0]);
    if (parts.length === 2 && fs.existsSync(path.join(projectDirectory, PROJECT_FILE))) {
        const project = new PcbProject(projectDirectory);
        for (const kind of ['schematics', 'panels'] as const) {
            if (project.definition[kind]?.[parts[1]]) return project.entry(kind, parts[1]);
        }
        return null;
    }
    if (
        !fs.existsSync(dirPath) ||
        !fs.statSync(dirPath).isDirectory() ||
        fs.existsSync(path.join(dirPath, PROJECT_FILE))
    )
        return null;

    const candidates = [
        path.join(dirPath, 'index.ts'),
        path.join(dirPath, `${dirName}.ts`),
        path.join(dirPath, `${dirName.charAt(0).toUpperCase() + dirName.slice(1)}.ts`), // camelCase match
    ];

    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }

    // Fallback: any .ts file
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.ts'));
    if (files.length > 0) {
        return path.join(dirPath, files[0]);
    }

    return null;
}

export function die(msg: string): never {
    console.error(`❌  ${msg}`);
    process.exit(1);
}

export function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/**
 * List available schematics from src/schematics/.
 * Each schematic is a sub-folder containing an index.ts with a default export.
 */
export function listSchematics(): string[] {
    const { schematicsDir } = getConfig();
    if (!fs.existsSync(schematicsDir)) {
        return [];
    }
    const legacy = fs
        .readdirSync(schematicsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .filter((d) => !!findSchematicEntry(d.name))
        .map((d) => d.name)
        .sort();
    const projects = discoverPcbProjects(schematicsDir).flatMap((project) =>
        [
            ...Object.keys(project.definition.schematics ?? {}),
            ...Object.keys(project.definition.panels ?? {}),
        ].map((key) => `${path.basename(project.directory)}/${key}`),
    );
    return [...legacy, ...projects].sort();
}

/**
 * Resolve a schematic entry: either a direct path or interactive selection.
 */
export async function resolveSchematic(entry?: string): Promise<string> {
    if (entry) {
        // Direct path provided
        const resolved = path.resolve(entry);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            return resolved;
        }
        // Try as a schematic name
        const entryPath = findSchematicEntry(entry);
        if (entryPath) {
            return entryPath;
        }
        die(`Schematic not found: ${entry}`);
    }

    // Interactive selection
    const schematics = listSchematics();
    if (schematics.length === 0) {
        die(
            'No schematics found in src/schematics/. Create a folder with an index.ts that default-exports a Schematic.',
        );
    }

    console.log('\n✨  Available Schematics\n' + '─'.repeat(30));
    schematics.forEach((name, i) => {
        console.log(`  ${i + 1}. ${name}`);
    });
    console.log('─'.repeat(30));

    const selection = await prompt(`Select a schematic (1-${schematics.length}): `);
    const idx = parseInt(selection, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= schematics.length) {
        die('Invalid selection.');
    }

    const entryPoint = findSchematicEntry(schematics[idx]);
    if (!entryPoint) {
        die(`Could not find an entry point for schematic: ${schematics[idx]}`);
    }

    return entryPoint;
}

/** Resolve a named project assembly without treating it as a schematic. */
export function resolveProjectEntryPath(entry: string, kind: 'assemblies'): string {
    const direct = path.resolve(entry);
    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
    const [projectName, key, extra] = entry.split('/');
    const directory = path.join(getConfig().schematicsDir, projectName);
    if (!key || extra || !fs.existsSync(path.join(directory, PROJECT_FILE)))
        throw new Error(`Project ${kind} entry not found: ${entry}`);
    return new PcbProject(directory).entry(kind, key);
}
