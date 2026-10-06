import fs from 'node:fs';
import path from 'node:path';

/** One output root per source directory, also safe for paths already inside export/. */
export function outputPaths(directory: string) {
    const absolute = path.resolve(directory);
    let ancestor = absolute;
    while (ancestor !== path.dirname(ancestor)) {
        if (path.basename(ancestor) === 'export') {
            return {
                source: path.dirname(ancestor),
                export: ancestor,
                renders: path.join(ancestor, 'renders'),
                backups: path.join(path.dirname(ancestor), '.backups'),
            };
        }
        ancestor = path.dirname(ancestor);
    }
    return {
        source: absolute,
        export: path.join(absolute, 'export'),
        renders: path.join(absolute, 'export', 'renders'),
        backups: path.join(absolute, '.backups'),
    };
}

/** Prefer the new output location; read legacy projects without silently moving them. */
export function generatedFile(directory: string, filename: string): string {
    const outputs = outputPaths(directory);
    const exported = path.join(outputs.export, filename);
    if (fs.existsSync(exported)) return exported;
    const legacy = path.join(outputs.source, filename);
    return fs.existsSync(legacy) ? legacy : exported;
}

export function resolveGeneratedInput(file: string): string {
    const absolute = path.resolve(file);
    return generatedFile(path.dirname(absolute), path.basename(absolute));
}

/** Backups never compete with code or current exports. Keep every previous revision. */
export function backupGeneratedFile(file: string, kind = 'backup'): string {
    const directory = outputPaths(path.dirname(file)).backups;
    fs.mkdirSync(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:.]/g, '');
    const base = path.join(directory, `${path.basename(file)}.${kind}-${stamp}`);
    let destination = base;
    for (let suffix = 1; fs.existsSync(destination); suffix++) destination = `${base}-${suffix}`;
    fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL);
    return destination;
}

export const OUTPUT_IGNORE_RULES = ['**/export/', '**/.backups/'] as const;

/** Append only opted-in rules; retain the project's existing Git policy and comments. */
export function configureOutputIgnore(root: string, exports: boolean, backups: boolean): void {
    const file = path.join(root, '.gitignore');
    const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const rules = [exports && OUTPUT_IGNORE_RULES[0], backups && OUTPUT_IGNORE_RULES[1]].filter(
        (rule): rule is (typeof OUTPUT_IGNORE_RULES)[number] =>
            !!rule && !source.split(/\r?\n/).includes(rule),
    );
    if (!rules.length) return;
    fs.writeFileSync(
        file,
        `${source}${source && !source.endsWith('\n') ? '\n' : ''}\n# PCB generated outputs\n${rules.join('\n')}\n`,
    );
}
