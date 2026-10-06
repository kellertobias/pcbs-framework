import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CircuitSnapshot, PcbExactRoute } from '../synth/types';
import { captureRouting, copperUuids } from '../kicad/RoutingFile';
import { backupGeneratedFile } from '../project/OutputPaths';
import { appendGeneratedRoutes, runIncrementalRouting } from './IncrementalRouter';
import { GridRoutingBackend } from './GridRoutingBackend';
import { CapacityRoutingBackend } from './CapacityRoutingBackend';
import { SimpleRoutingBackend } from './SimpleRoutingBackend';
import type { RoutingBackend } from './types';

export interface AutomaticRoutingCache {
    version: 1;
    board: string;
    inputHash: string;
    routes: PcbExactRoute[];
}

/** Includes footprint geometry, placement, connectivity, constraints and engine revision. */
export function routingInputHash(
    snapshot: CircuitSnapshot,
    bareBoard: string,
    backend: string,
): string {
    return createHash('sha256')
        .update(
            JSON.stringify({
                revision: 2,
                backend,
                // UUIDs identify drawings, not physical routing constraints.
                bareBoard: bareBoard.replace(/\(uuid\s+"[^"\r\n]+"\)/g, ''),
                hints: snapshot.pcb?.routeHints,
                regions: snapshot.pcb?.routingRegions,
                netClasses: snapshot.pcb?.netClasses,
            }),
        )
        .digest('hex');
}

/** Generated copper is a disposable cache, never executable source or a permanent routing lock. */
export function automaticallyRoute(
    snapshot: CircuitSnapshot,
    bareBoard: string,
    directory: string,
    backendOverride?: RoutingBackend,
    validate?: (boardPath: string) => void,
) {
    const backendName = snapshot.pcb?.autoRoute
        ? (snapshot.pcb.autoRoute.backend ?? 'grid')
        : 'grid';
    const backend =
        backendOverride ??
        (backendName === 'capacity'
            ? new CapacityRoutingBackend()
            : backendName === 'simple'
              ? new SimpleRoutingBackend()
              : new GridRoutingBackend());
    const inputHash = routingInputHash(snapshot, bareBoard, backend.id);
    const file = path.join(directory, `${snapshot.name}.pcb-routing-cache.json`);
    if (fs.existsSync(file)) {
        let saved: Partial<AutomaticRoutingCache> = {};
        try {
            saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
            /* A disposable cache can be regenerated. */
        }
        if (
            saved.version === 1 &&
            saved.board === snapshot.name &&
            saved.inputHash === inputHash &&
            Array.isArray(saved.routes)
        )
            return { content: appendGeneratedRoutes(bareBoard, saved.routes), cached: true };
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-auto-route-'));
    try {
        const board = path.join(temporary, `${snapshot.name}.kicad_pcb`);
        fs.writeFileSync(board, bareBoard);
        const report = runIncrementalRouting(snapshot, board, {
            backend,
            routeAll: true,
            runDrc: false,
        });
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(
            path.join(directory, `${snapshot.name}.route-report.json`),
            `${JSON.stringify({ ...report, boardPath: path.join(directory, `${snapshot.name}.kicad_pcb`), backupPath: undefined, inputHash }, null, 2)}\n`,
        );
        if (report.failed.length || report.constraintViolating.length)
            throw new Error(
                `Automatic routing incomplete: ${[...report.failed, ...report.constraintViolating].map((e) => `${e.net}: ${e.reason}`).join('; ')}. Previous PCB retained; see export route report.`,
            );
        if (validate) validate(board);
        else {
            // Native connectivity includes filled pours, which a signal router cannot certify.
            for (const extension of ['kicad_pro', 'kicad_dru']) {
                const settings = path.join(directory, `${snapshot.name}.${extension}`);
                if (fs.existsSync(settings))
                    fs.copyFileSync(settings, path.join(temporary, path.basename(settings)));
            }
            const nativeReport = path.join(temporary, 'native-drc.json');
            const cli =
                process.env.KICAD_CLI ??
                (fs.existsSync('/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli')
                    ? '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli'
                    : 'kicad-cli');
            const native = spawnSync(
                cli,
                [
                    'pcb',
                    'drc',
                    '--refill-zones',
                    '--save-board',
                    '--format',
                    'json',
                    '--output',
                    nativeReport,
                    board,
                ],
                { encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
            );
            if (!fs.existsSync(nativeReport))
                throw new Error(
                    `Automatic routing requires native KiCad validation; previous PCB retained. ${native.error?.message ?? native.stderr}`,
                );
            const checks = JSON.parse(fs.readFileSync(nativeReport, 'utf8')) as {
                violations: { severity: string }[];
                unconnected_items: unknown[];
            };
            fs.copyFileSync(nativeReport, path.join(directory, `${snapshot.name}.route-drc.json`));
            const errors = checks.violations.filter((v) => v.severity === 'error').length;
            if (errors || checks.unconnected_items.length)
                throw new Error(
                    `Automatic routing incomplete: native filled-zone DRC found ${errors} errors and ${checks.unconnected_items.length} unconnected items. Previous PCB and cache retained; see export/${snapshot.name}.route-drc.json.`,
                );
        }
        const routed = fs.readFileSync(board, 'utf8');
        const { routes } = captureRouting(routed, snapshot.name, {
            excludeUuids: copperUuids(bareBoard),
            coordinateOnly: true,
        });
        if (fs.existsSync(file)) backupGeneratedFile(file);
        fs.writeFileSync(
            file,
            `${JSON.stringify({ version: 1, board: snapshot.name, inputHash, routes } satisfies AutomaticRoutingCache, null, 2)}\n`,
        );
        return { content: routed, cached: false };
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}
