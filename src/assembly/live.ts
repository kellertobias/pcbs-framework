import fs from 'node:fs';
import path from 'node:path';
import { create, REGISTER_INSTANCE } from 'ts-node';
import { Assembly } from '../synth/Assembly';
import { resolveAssemblyBoard } from './prepare';

/** Track only this assembly's local source graph, leaving shared framework identity intact. */
export function assemblyModules(entry: string): string[] {
    const files = new Set<string>(),
        framework = path.resolve(__dirname, '..');
    function visit(file: string) {
        if (
            files.has(file) ||
            file.includes(`${path.sep}node_modules${path.sep}`) ||
            file.startsWith(framework + path.sep)
        )
            return;
        files.add(file);
        for (const child of require.cache[file]?.children ?? []) visit(child.filename);
    }
    visit(require.resolve(entry));
    return [...files];
}
export function loadAssembly(entry: string, invalidate: readonly string[] = []): Assembly {
    if (invalidate.length) {
        const active = process[REGISTER_INSTANCE];
        if (active) {
            // Module eviction alone leaves ts-node's dependency snapshots stale.
            // Replace its compiler without stacking another require hook per refresh.
            const fresh = create(active.options);
            active.compile = fresh.compile;
            active.getTypeInfo = fresh.getTypeInfo;
        }
    }
    for (const file of invalidate) delete require.cache[file];
    const exported = require(entry),
        assembly = exported.default ?? exported;
    if (!(assembly instanceof Assembly)) throw new Error('Entry must default-export an Assembly');
    return assembly;
}
export function assemblyInputs(assembly: Assembly, entry: string): string[] {
    const base = path.dirname(entry),
        files = new Set([entry, ...assemblyModules(entry)]);
    for (const part of assembly.parts) {
        if (part.kind === 'board') {
            const pcb = resolveAssemblyBoard(part, base);
            files.add(pcb);
            files.add(path.join(path.dirname(pcb), 'routing.json'));
            files.add(path.join(path.dirname(pcb), 'fp-lib-table'));
            if (part.file) {
                const source = path.resolve(base, part.file);
                files.add(source);
                for (const module of assemblyModules(source)) files.add(module);
            }
            for (const match of fs
                .readFileSync(pcb, 'utf8')
                .matchAll(/\(model\s+("(?:[^"\\]|\\.)*")/g)) {
                const declared = JSON.parse(match[1]).replace(
                    /\$\{([^}]+)\}/g,
                    (_: string, key: string) =>
                        key === 'KIPRJMOD'
                            ? path.dirname(pcb)
                            : (process.env[key] ?? `\$\{${key}\}`),
                );
                if (!declared.includes('${')) files.add(path.resolve(path.dirname(pcb), declared));
            }
        } else if (part.kind === 'model') {
            const file = path.resolve(base, part.file);
            files.add(file);
            if (path.extname(file).toLowerCase() === '.gltf') {
                const gltf = JSON.parse(fs.readFileSync(file, 'utf8'));
                for (const resource of [...(gltf.buffers ?? []), ...(gltf.images ?? [])])
                    if (resource.uri && !resource.uri.startsWith('data:'))
                        files.add(
                            path.resolve(path.dirname(file), decodeURIComponent(resource.uri)),
                        );
            }
        } else if (part.kind === 'generated')
            for (const input of part.inputs ?? []) files.add(path.resolve(base, input));
    }
    return [...files];
}
export function inputSignature(files: readonly string[]): string {
    return JSON.stringify(
        files.map((file) => {
            try {
                const s = fs.statSync(file, { bigint: true });
                return [file, String(s.mtimeNs), String(s.size), String(s.ino)];
            } catch {
                return [file, 'missing'];
            }
        }),
    );
}
/** Serialize refreshes and recheck saves made during a native export. Last good assets stay live on failure. */
export class AssemblyLiveRefresh {
    private files: string[];
    private signature: string;
    private busy?: Promise<void>;
    private timer?: ReturnType<typeof setInterval>;
    constructor(
        files: string[],
        private rebuild: () => Promise<string[]>,
    ) {
        this.files = files;
        this.signature = inputSignature(files);
    }
    async refresh(): Promise<void> {
        if (this.busy) return this.busy;
        this.busy = (async () => {
            // Retry once if an editor saved again while the native exporter was reading.
            for (let attempt = 0; attempt < 2; attempt++) {
                const before = inputSignature(this.files);
                const next = await this.rebuild();
                const unchanged = before === inputSignature(this.files);
                this.files = next;
                if (unchanged) {
                    this.signature = inputSignature(next);
                    return;
                }
            }
            // Keep the pre-save signature: the next poll will pick up continued changes.
        })();
        try {
            await this.busy;
        } finally {
            this.busy = undefined;
        }
    }
    async check(): Promise<void> {
        if (this.busy || this.signature === inputSignature(this.files)) return;
        // A failed refresh retries on a new save or explicit refresh, not every second.
        this.signature = inputSignature(this.files);
        await this.refresh();
    }
    start(interval = 1000): void {
        this.timer = setInterval(
            () =>
                void this.check().catch((error) =>
                    console.warn(`Assembly refresh failed: ${error.message}`),
                ),
            interval,
        );
    }
    stop(): void {
        if (this.timer) clearInterval(this.timer);
    }
}
