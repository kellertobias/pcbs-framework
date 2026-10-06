import fs from 'node:fs';
import path from 'node:path';
import { outputPaths } from './OutputPaths';

export interface OutputMove {
    from: string;
    to: string;
}
const excluded = new Set(['node_modules', '.git', '.kicad', '.venv', 'dist', 'export', '.backups']);
const generatedDirectories = new Set([
    '3d',
    'model',
    'boards',
    '.project-libraries',
    'jlcpcb',
    'zip',
    'pdf',
    'renders',
    'review-renders',
    'schematic-preview',
    'preview',
    'review',
]);
const nativeExtension = /\.(kicad_(pcb|sch|pro|prl|dru)|net|gbr|gbrjob|drl|rpt)$/i;
const backupName =
    /(?:\.backup(?:-|$)|\.route-backup-|\.bak(?:\.|$)|~$|(?:^|-)backups$|^\.history$|autosave)/i;
const reportName =
    /(?:^uuids\.json$|^routing\.json$|(?:pcb-(?:intent|sync|routing[^.]*)|route-report|schematic-layout|routing-verification|mechanical-verification|validation|verification|render-review|schematic-review|schematic-layout-comparison)\.json$|^drc[^/]*\.(?:json|txt)$|^fp-lib-table$|^sym-lib-table$|^fp-info-cache$)/;

/** Inventory only outputs, never TypeScript, manifests, vendor reference images or library assets. */
export function planOutputMigration(root: string): OutputMove[] {
    const moves: OutputMove[] = [];
    const visit = (directory: string) => {
        const entries = fs.readdirSync(directory, { withFileTypes: true });
        const boardDirectory = entries.some((e) => e.isFile() && /\.kicad_(pcb|sch)$/.test(e.name));
        const existingExports = entries.some((e) => e.isDirectory() && e.name === 'export');
        const assemblyDirectory = entries.some((e) => e.isFile() && /assembly\.ts$/i.test(e.name));
        const outputs = outputPaths(directory);
        for (const entry of entries) {
            if (entry.isSymbolicLink() || excluded.has(entry.name)) continue;
            const from = path.join(directory, entry.name);
            if (backupName.test(entry.name)) {
                moves.push({ from, to: path.join(outputs.backups, entry.name) });
                continue;
            }
            if (entry.isDirectory()) {
                if (
                    (boardDirectory || assemblyDirectory || existingExports) &&
                    generatedDirectories.has(entry.name)
                ) {
                    const destination = [
                        'renders',
                        'review-renders',
                        'review',
                        'preview',
                        'schematic-preview',
                    ].includes(entry.name)
                        ? path.join(outputs.renders, entry.name === 'renders' ? '' : entry.name)
                        : path.join(outputs.export, entry.name);
                    moves.push({ from, to: destination });
                } else visit(from);
            } else if (
                nativeExtension.test(entry.name) ||
                reportName.test(entry.name) ||
                ((boardDirectory || assemblyDirectory || existingExports) &&
                    /\.(pdf|png|svg|dxf|wrl|step|stl|3mf|csv|zip)$/i.test(entry.name))
            ) {
                moves.push({
                    from,
                    to: path.join(
                        /\.(png|svg)$/i.test(entry.name) ? outputs.renders : outputs.export,
                        entry.name,
                    ),
                });
            }
        }
    };
    visit(path.resolve(root));
    return moves.sort((a, b) => a.from.localeCompare(b.from));
}

/** Validate the complete plan before moving anything. Collisions never overwrite either revision. */
export function applyOutputMigration(moves: OutputMove[]): void {
    const destinations = new Set<string>();
    for (const move of moves) {
        if (!fs.existsSync(move.from)) throw new Error(`Missing migration source: ${move.from}`);
        if (fs.existsSync(move.to) || destinations.has(move.to))
            throw new Error(`Output migration collision: ${move.to}`);
        destinations.add(move.to);
    }
    const completed: OutputMove[] = [];
    try {
        for (const move of moves) {
            fs.mkdirSync(path.dirname(move.to), { recursive: true });
            fs.renameSync(move.from, move.to);
            completed.push(move);
        }
    } catch (error) {
        for (const move of completed.reverse()) fs.renameSync(move.to, move.from);
        throw error;
    }
}
