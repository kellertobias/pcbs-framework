import fs from 'node:fs';
import path from 'node:path';
import { findPcbProject } from './PcbProject';
import { SExpressionParser as Parser, type SExpr } from '../kicad/SExpressionParser';

/** Materialize project overrides plus shared fallback, including same-name library entries. */
export function prepareProjectLibraries(output: string, workspace: string): string[] {
    const project = findPcbProject(output);
    const directories = [
        ...(project?.libraryDirectories ?? []),
        path.join(workspace, '.kicad'),
        path.join(workspace, 'lib'),
    ];
    if (!project) return directories;
    const overlay = path.join(output, '.project-libraries');
    fs.rmSync(overlay, { recursive: true, force: true });
    fs.mkdirSync(overlay, { recursive: true });
    const symbols = new Map<string, Map<string, SExpr>>();
    const headers = new Map<string, SExpr[]>();
    const footprints = new Set<string>();
    // First directory wins; reverse traversal merges shared entries beneath local entries.
    for (const directory of [...directories].reverse()) {
        if (!fs.existsSync(directory)) continue;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const source = path.join(directory, entry.name);
            if (entry.isDirectory() && entry.name.endsWith('.pretty')) {
                footprints.add(entry.name.slice(0, -7));
                const target = path.join(overlay, entry.name);
                fs.mkdirSync(target, { recursive: true });
                for (const file of fs
                    .readdirSync(source)
                    .filter((file) => file.endsWith('.kicad_mod'))) {
                    fs.copyFileSync(path.join(source, file), path.join(target, file));
                }
            } else if (entry.isFile() && entry.name.endsWith('.kicad_sym')) {
                const root = Parser.parse(fs.readFileSync(source, 'utf8'))[0];
                if (!Array.isArray(root) || root[0] !== 'kicad_symbol_lib')
                    throw new Error(`Invalid project symbol library: ${source}`);
                const merged = symbols.get(entry.name) ?? new Map<string, SExpr>();
                for (const item of root.slice(1))
                    if (Array.isArray(item) && item[0] === 'symbol')
                        merged.set(Parser.unquote(String(item[1])), item);
                symbols.set(entry.name, merged);
                headers.set(
                    entry.name,
                    root.filter((item) => !Array.isArray(item) || item[0] !== 'symbol'),
                );
            }
        }
    }
    for (const [file, entries] of symbols)
        fs.writeFileSync(
            path.join(overlay, file),
            Parser.serialize([...headers.get(file)!, ...entries.values()]),
        );
    const table = (kind: string, entries: string[], suffix: string) =>
        `(${kind} (version 7)\n${entries
            .sort()
            .map(
                (name) =>
                    `(lib (name ${JSON.stringify(name)})(type "KiCad")(uri ${JSON.stringify(path.join(overlay, name + suffix))})(options "")(descr "Project and shared libraries"))`,
            )
            .join('\n')}\n)\n`;
    fs.writeFileSync(
        path.join(output, 'fp-lib-table'),
        table('fp_lib_table', [...footprints], '.pretty'),
    );
    fs.writeFileSync(
        path.join(output, 'sym-lib-table'),
        table(
            'sym_lib_table',
            [...symbols.keys()].map((file) => file.slice(0, -10)),
            '.kicad_sym',
        ),
    );
    return [overlay, ...directories];
}
