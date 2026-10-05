import { resolveProjectEntryPath } from '../utils';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
    assemblyInputs,
    assemblyModules,
    loadAssembly,
    AssemblyLiveRefresh,
} from '../../assembly/live';
import { prepareAssembly } from '../../assembly/prepare';
import { serveAssembly } from '../../assembly/server';

export async function cmdViewAssembly(args: string[]): Promise<void> {
    if (args[0] !== 'assembly' || !args[1])
        throw new Error(
            'Usage: view assembly <assembly.ts> [--port 0] [--no-open] [--no-watch] [--placements file.json] [--prepare-only --output directory]',
        );
    const file = resolveProjectEntryPath(args[1], 'assemblies');
    if (!fs.existsSync(file)) throw new Error(`Assembly entry missing: ${file}`);
    const option = (flag: string) => {
        const i = args.indexOf(flag);
        return i < 0 ? undefined : args[i + 1];
    };
    const port = Number(option('--port') ?? 0);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
        throw new Error('Port must be between 0 and 65535');
    const placements = option('--placements');
    const readAssembly = (invalidate: string[] = []) => {
        const assembly = loadAssembly(file, invalidate);
        if (placements)
            assembly.applyPlacements(JSON.parse(fs.readFileSync(path.resolve(placements), 'utf8')));
        return assembly;
    };
    const assembly = readAssembly();
    const output = option('--output');
    if (args.includes('--prepare-only') && !output)
        throw new Error('--prepare-only requires --output');
    // Reserve a fresh session directory; never overwrite source files or prior exports.
    const parent = output ? path.resolve(output) : os.tmpdir();
    fs.mkdirSync(parent, { recursive: true });
    const directories: string[] = [];
    const directory = fs.mkdtempSync(path.join(parent, 'pcb-assembly-'));
    directories.push(directory);
    try {
        console.log(`Preparing ${assembly.name} (${assembly.parts.length} parts)…`);
        await prepareAssembly(assembly, path.dirname(file), directory);
        if (args.includes('--prepare-only')) {
            console.log(`Prepared assembly: ${directory}`);
            return;
        }
        let modules = [
            ...new Set([
                ...assemblyModules(file),
                ...assemblyInputs(assembly, file).filter((f) => require.cache[f]),
            ]),
        ];
        const live = new AssemblyLiveRefresh(assemblyInputs(assembly, file), async () => {
            served.setRefreshState(true);
            const next = fs.mkdtempSync(path.join(parent, 'pcb-assembly-'));
            try {
                const updated = readAssembly(modules);
                await prepareAssembly(updated, path.dirname(file), next);
                const inputs = assemblyInputs(updated, file);
                modules = [...new Set([...modules, ...inputs.filter((f) => require.cache[f])])];
                served.replaceDirectory(next);
                served.setRefreshState(false);
                directories.push(next);
                console.log(`Refreshed ${updated.name} from current PCB/model files.`);
                return inputs;
            } catch (error) {
                fs.rmSync(next, { recursive: true, force: true });
                served.setRefreshState(
                    false,
                    error instanceof Error ? error.message : String(error),
                );
                throw error;
            }
        });
        const served = await serveAssembly(directory, port, () => live.refresh());
        const { server, url } = served;
        if (!args.includes('--no-watch')) live.start();
        console.log(
            `Assembly viewer: ${url}\nCtrl+C to stop. Placements are edited in the browser; download JSON to keep changes.\n${args.includes('--no-watch') ? 'Automatic refresh disabled; use the refresh button.' : 'PCB/model changes refresh automatically; use --no-watch to disable.'}`,
        );
        const stop = () => {
            live.stop();
            server.close();
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
        server.once('close', () => {
            process.off('SIGINT', stop);
            process.off('SIGTERM', stop);
            live.stop();
            if (!output)
                for (const snapshot of directories)
                    fs.rmSync(snapshot, { recursive: true, force: true });
        });
        if (!args.includes('--no-open')) {
            const command =
                process.platform === 'darwin'
                    ? 'open'
                    : process.platform === 'win32'
                      ? 'cmd'
                      : 'xdg-open';
            const parameters = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
            const child = spawn(command, parameters, {
                stdio: 'ignore',
                detached: true,
            });
            child.on('error', (error) => console.warn(`Open ${url} manually (${error.message})`));
            child.unref();
        }
    } catch (error) {
        if (!output) fs.rmSync(directory, { recursive: true, force: true });
        throw error;
    }
}
