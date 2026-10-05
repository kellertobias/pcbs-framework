import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { getConfig } from './config';

export type KicadReloadPhase = 'save' | 'revert';
export type KicadReloadStatus = 'saved' | 'reloaded' | 'not-open' | 'unavailable';

export interface KicadReloadResult {
    status: KicadReloadStatus;
    target?: string;
    openBoards?: string[];
    message?: string;
}

export type KicadReloadRunner = (phase: KicadReloadPhase, pcbPath: string) => KicadReloadResult;

function helperPath(): string {
    const { scriptsDir } = getConfig();
    const candidates = [
        path.join(scriptsDir, 'kicad-ipc-reload.py'),
        path.resolve(__dirname, '../../../scripts/kicad-ipc-reload.py'),
        path.resolve(process.cwd(), 'node_modules/@tobisk/pcbs/scripts/kicad-ipc-reload.py'),
    ];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found) throw new Error('Could not locate the packaged KiCad IPC reload helper.');
    return found;
}

/** Execute one IPC phase. Kept injectable so tests never need a running KiCad process. */
export function runKicadReloadPhase(phase: KicadReloadPhase, pcbPath: string): KicadReloadResult {
    const { pythonPath } = getConfig();
    const result = spawnSync(pythonPath, [helperPath(), phase, path.resolve(pcbPath)], {
        encoding: 'utf-8',
    });
    const outputLines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    const output = outputLines[outputLines.length - 1];
    let response:
        | { status: string; target?: string; openBoards?: string[]; message?: string }
        | undefined;
    try {
        response = output ? JSON.parse(output) : undefined;
    } catch {
        // The actionable process diagnostic below includes the raw output.
    }

    if (response?.status === 'dependency-missing') {
        throw new Error(
            `${response.message} Install it with: ${pythonPath} -m pip install kicad-python==0.7.1`,
        );
    }
    if (result.error || result.status !== 0 || !response || response.status === 'error') {
        const details = [response?.message, result.stderr, result.stdout, result.error?.message]
            .filter(Boolean)
            .join('\n')
            .trim();
        throw new Error(
            `KiCad ${phase === 'save' ? 'pre-save' : 'reload'} failed${details ? `: ${details}` : '.'}`,
        );
    }
    if (!['saved', 'reloaded', 'not-open', 'unavailable'].includes(response.status)) {
        throw new Error(`KiCad IPC helper returned unknown status '${response.status}'.`);
    }
    return response as KicadReloadResult;
}

export interface PreparedKicadReload {
    pcbPath: string;
    shouldReload: boolean;
    status: KicadReloadStatus;
    message?: string;
}

/** Save the exact open board before synthesis so unsaved KiCad edits enter the sync input. */
export function prepareKicadReload(
    pcbPath: string,
    run: KicadReloadRunner = runKicadReloadPhase,
): PreparedKicadReload {
    const resolved = path.resolve(pcbPath);
    const result = run('save', resolved);
    return {
        pcbPath: resolved,
        shouldReload: result.status === 'saved',
        status: result.status,
        message: result.message,
    };
}

/** Reload only a board that was positively matched and saved during preflight. */
export function completeKicadReload(
    prepared: PreparedKicadReload,
    run: KicadReloadRunner = runKicadReloadPhase,
): KicadReloadResult | undefined {
    if (!prepared.shouldReload) return undefined;
    const result = run('revert', prepared.pcbPath);
    if (result.status !== 'reloaded') {
        throw new Error(
            `KiCad no longer has the synchronized board open; reload was not performed (status: ${result.status}).`,
        );
    }
    return result;
}
