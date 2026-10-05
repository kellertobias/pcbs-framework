import fs from 'node:fs';
import path from 'node:path';

export const PROJECT_FILE = 'pcb-project.json';
export type ProjectEntryKind = 'schematics' | 'panels' | 'assemblies';
export interface PcbProjectDefinition {
    name: string;
    schematics?: Record<string, string>;
    panels?: Record<string, string>;
    assemblies?: Record<string, string>;
    /** Optional local TypeScript module folders. Shared modules remain available through imports. */
    modules?: string[];
    /** Optional generated KiCad library directories, in precedence order. */
    libraries?: string[];
}

/** A design family inside the workspace schematics folder. Every section is optional. */
export class PcbProject {
    readonly directory: string;
    readonly definition: PcbProjectDefinition;
    constructor(directory: string, definition?: PcbProjectDefinition) {
        this.directory = path.resolve(directory);
        this.definition =
            definition ??
            JSON.parse(fs.readFileSync(path.join(this.directory, PROJECT_FILE), 'utf8'));
        if (
            !this.definition ||
            typeof this.definition.name !== 'string' ||
            !this.definition.name.trim()
        )
            throw new Error('PCB project requires a name');
        for (const kind of ['schematics', 'panels', 'assemblies'] as const) {
            const entries = this.definition[kind];
            if (
                entries !== undefined &&
                (!entries || typeof entries !== 'object' || Array.isArray(entries))
            )
                throw new Error(`Invalid project ${kind}`);
            for (const [name, file] of Object.entries(entries ?? {})) {
                if (
                    !/^[\w.-]+$/.test(name) ||
                    typeof file !== 'string' ||
                    !file ||
                    path.isAbsolute(file)
                )
                    throw new Error(`Invalid project ${kind} entry: ${name}`);
            }
        }
        const buildNames = [
            ...Object.keys(this.definition.schematics ?? {}),
            ...Object.keys(this.definition.panels ?? {}),
        ];
        if (new Set(buildNames).size !== buildNames.length)
            throw new Error('Project schematic and panel keys must be unique');
        for (const key of ['modules', 'libraries'] as const) {
            const dirs = this.definition[key];
            if (
                dirs !== undefined &&
                (!Array.isArray(dirs) ||
                    dirs.some((dir) => typeof dir !== 'string' || !dir || path.isAbsolute(dir)))
            )
                throw new Error(`Invalid project ${key}`);
        }
    }
    get name() {
        return this.definition.name;
    }
    entry(kind: ProjectEntryKind, name: string): string {
        const relative = this.definition[kind]?.[name];
        if (!relative) throw new Error(`Unknown ${kind} '${name}' in ${this.name}`);
        const file = path.resolve(this.directory, relative);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile())
            throw new Error(`Project entry missing: ${file}`);
        return file;
    }
    get moduleDirectories(): string[] {
        return (this.definition.modules ?? ['modules']).map((dir) =>
            path.resolve(this.directory, dir),
        );
    }
    get libraryDirectories(): string[] {
        return (this.definition.libraries ?? ['.kicad', 'lib']).map((dir) =>
            path.resolve(this.directory, dir),
        );
    }
}

export function findPcbProject(entry: string): PcbProject | undefined {
    let directory = path.resolve(entry);
    if (fs.existsSync(directory) && fs.statSync(directory).isFile())
        directory = path.dirname(directory);
    for (;;) {
        if (fs.existsSync(path.join(directory, PROJECT_FILE))) return new PcbProject(directory);
        const parent = path.dirname(directory);
        if (parent === directory) return undefined;
        directory = parent;
    }
}

export function discoverPcbProjects(schematicsDirectory: string): PcbProject[] {
    if (!fs.existsSync(schematicsDirectory)) return [];
    return fs
        .readdirSync(schematicsDirectory, { withFileTypes: true })
        .filter(
            (entry) =>
                entry.isDirectory() &&
                fs.existsSync(path.join(schematicsDirectory, entry.name, PROJECT_FILE)),
        )
        .map((entry) => new PcbProject(path.join(schematicsDirectory, entry.name)))
        .sort((a, b) => a.name.localeCompare(b.name));
}
