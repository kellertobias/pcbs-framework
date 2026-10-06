import { backupGeneratedFile } from '../project/OutputPaths';
import { normalizeBoardNets, serializeNativeBoard } from '../kicad/KicadNetFormat';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { SExpr, SExpressionParser } from '../kicad/SExpressionParser';
import { CircuitSnapshot, PcbExactRoute, PcbPoint } from '../synth/types';
import { SimpleRoutingBackend } from './SimpleRoutingBackend';
import { IncrementalRoutingOptions, RouterPad, RoutingDrcReport, RoutingReport } from './types';

type Node = SExpr[];
const isNode = (value: SExpr, keyword?: string): value is Node =>
    Array.isArray(value) && (!keyword || value[0] === keyword);
const child = (node: Node, keyword: string): Node | undefined =>
    node.find((value): value is Node => isNode(value, keyword));
const children = (node: Node, keyword: string): Node[] =>
    node.filter((value): value is Node => isNode(value, keyword));
const atom = (node: Node | undefined, index: number): string | undefined => {
    const value = node?.[index];
    return typeof value === 'string' ? SExpressionParser.unquote(value) : undefined;
};

const stableUuid = (key: string): string => {
    const hex = createHash('sha256')
        .update(`tspcb-router:${key}`)
        .digest('hex')
        .slice(0, 32)
        .split('');
    hex[12] = '4';
    hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
};

const timestamp = (): string => new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z');

function writeAtomic(filePath: string, content: string): void {
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
    let descriptor: number | undefined;
    try {
        descriptor = fs.openSync(temporaryPath, 'w');
        fs.writeFileSync(descriptor, content, 'utf-8');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        fs.renameSync(temporaryPath, filePath);
    } catch (error) {
        if (descriptor !== undefined) fs.closeSync(descriptor);
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        throw error;
    }
}

/** Run an optional backend against only eligible nets and merge its owned copper into a KiCad board. */
export function runIncrementalRouting(
    snapshot: CircuitSnapshot,
    boardPath: string,
    options: IncrementalRoutingOptions = {},
): RoutingReport {
    if (!fs.existsSync(boardPath))
        throw new Error(`Cannot autoroute missing PCB '${boardPath}'. Synthesize it first.`);
    const source = fs.readFileSync(boardPath, 'utf-8');
    const ast = SExpressionParser.parse(source);
    const board = ast.find((value): value is Node => isNode(value, 'kicad_pcb'));
    if (!board) throw new Error(`Cannot autoroute invalid KiCad PCB '${boardPath}'.`);

    normalizeBoardNets(board);
    const netCodes = new Map<number, string>();
    const codesByName = new Map<string, number>();
    for (const net of children(board, 'net')) {
        const code = Number(atom(net, 1));
        const name = atom(net, 2);
        if (name && Number.isFinite(code)) {
            netCodes.set(code, name);
            codesByName.set(name, code);
        }
    }

    const rerouteNets = [...new Set(options.rerouteNets ?? [])].sort();
    for (const net of rerouteNets)
        if (!codesByName.has(net)) throw new Error(`Cannot reroute unknown net '${net}'.`);
    const exactNets = new Set((snapshot.pcb?.exactRoutes ?? []).map((route) => route.net));
    const existingCopper = copperByNet(board, netCodes);
    const hintedNets = new Set((snapshot.pcb?.routeHints ?? []).flatMap((hint) => hint.nets));
    // Route hints are the eligibility declaration. Existing copper can additionally
    // be selected explicitly through rerouteNets; an unhinted board is a no-op.
    const candidateNets = [
        ...new Set([
            ...hintedNets,
            ...rerouteNets,
            ...(options.routeAll ? codesByName.keys() : []),
        ]),
    ];

    const skipped: RoutingReport['skipped'] = [];
    const eligibleNets: string[] = [];
    for (const net of candidateNets.sort()) {
        if (!codesByName.has(net)) {
            skipped.push({ net, reason: 'route hint references a net absent from the PCB' });
            continue;
        }
        if (exactNets.has(net)) {
            skipped.push({ net, reason: 'framework-owned exact route is locked' });
            continue;
        }
        const hasCopper = (existingCopper.get(net) ?? 0) > 0;
        if (hasCopper && !rerouteNets.includes(net)) {
            skipped.push({ net, reason: 'existing manual or routed copper is preserved' });
            continue;
        }
        if (rerouteNets.length && !rerouteNets.includes(net) && hasCopper) {
            skipped.push({ net, reason: 'not explicitly selected for rerouting' });
            continue;
        }
        eligibleNets.push(net);
    }

    const backend = options.backend ?? new SimpleRoutingBackend();
    const backendResult = backend.route({
        snapshot,
        boardSource: SExpressionParser.serialize(board),
        padsByNet: collectPads(board, netCodes),
        eligibleNets,
        existingCopperNets: new Set(existingCopper.keys()),
        lockedNets: exactNets,
        rerouteNets: new Set(rerouteNets),
        routeHints: snapshot.pcb?.routeHints ?? [],
        netClasses: snapshot.pcb?.netClasses ?? [],
    });
    skipped.push(
        ...backendResult.skipped.map((entry) => ({
            net: entry.net,
            reason: entry.reason ?? 'backend skipped net',
        })),
    );

    const completed = backendResult.completed.filter((entry) => entry.route);
    const replacedCodes = new Set(
        completed
            .filter((entry) => rerouteNets.includes(entry.net))
            .map((entry) => codesByName.get(entry.net)!),
    );
    const preservedManualCopper = {
        segments: children(board, 'segment').filter(
            (node) => !replacedCodes.has(Number(atom(child(node, 'net'), 1))),
        ).length,
        arcs: children(board, 'arc').filter(
            (node) => !replacedCodes.has(Number(atom(child(node, 'net'), 1))),
        ).length,
        vias: children(board, 'via').filter(
            (node) => !replacedCodes.has(Number(atom(child(node, 'net'), 1))),
        ).length,
    };
    let backupPath: string | undefined;
    if (completed.length) {
        backupPath = backupGeneratedFile(boardPath, 'route-backup');
        if (replacedCodes.size) removeSelectedCopper(board, replacedCodes);
        for (const entry of completed)
            appendRoute(board, entry.route!, codesByName.get(entry.net)!);
        writeAtomic(boardPath, serializeNativeBoard(SExpressionParser.serialize(board)));
    }

    const drc =
        completed.length && options.runDrc !== false
            ? runDrc(boardPath)
            : { status: 'not-run' as const };
    const report: RoutingReport = {
        backend: backend.id,
        boardPath,
        backupPath,
        rerouteNets,
        completed: completed.map((entry) => ({ net: entry.net, reason: entry.reason ?? 'routed' })),
        skipped,
        failed: backendResult.failed.map((entry) => ({
            net: entry.net,
            reason: entry.reason ?? 'backend failed',
        })),
        constraintViolating: backendResult.completed.flatMap((entry) =>
            (entry.constraintViolations ?? []).map((reason) => ({ net: entry.net, reason })),
        ),
        preservedManualCopper,
        drc,
        fabricationReady: false,
        humanReviewRequired: true,
    };
    writeAtomic(
        path.join(
            path.dirname(boardPath),
            `${path.basename(boardPath, '.kicad_pcb')}.route-report.json`,
        ),
        `${JSON.stringify(report, null, 2)}\n`,
    );
    return report;
}

function copperByNet(board: Node, netCodes: Map<number, string>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const keyword of ['segment', 'arc', 'via'])
        for (const item of children(board, keyword)) {
            const name = netCodes.get(Number(atom(child(item, 'net'), 1)));
            if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
        }
    return counts;
}

function collectPads(
    board: Node,
    netCodes: Map<number, string>,
): Map<string, readonly RouterPad[]> {
    const result = new Map<string, RouterPad[]>();
    for (const footprint of children(board, 'footprint')) {
        const at = child(footprint, 'at');
        const fx = Number(atom(at, 1) ?? 0);
        const fy = Number(atom(at, 2) ?? 0);
        const rotation = (-Number(atom(at, 3) ?? 0) * Math.PI) / 180;
        const reference = children(footprint, 'property').find(
            (property) => atom(property, 1) === 'Reference',
        );
        const ref = atom(reference, 2) ?? '?';
        for (const pad of children(footprint, 'pad')) {
            const name = netCodes.get(Number(atom(child(pad, 'net'), 1)));
            if (!name) continue;
            const padAt = child(pad, 'at');
            const localX = Number(atom(padAt, 1) ?? 0);
            const localY = Number(atom(padAt, 2) ?? 0);
            const position = {
                x: fx + localX * Math.cos(rotation) - localY * Math.sin(rotation),
                y: fy + localX * Math.sin(rotation) + localY * Math.cos(rotation),
            };
            const pads = result.get(name) ?? [];
            pads.push({ ref, pad: atom(pad, 1) ?? '', net: name, at: position });
            result.set(name, pads);
        }
    }
    return result;
}

function appendRoute(board: Node, route: PcbExactRoute, netCode: number): void {
    for (const [index, segment] of (route.segments ?? []).entries()) {
        const start = segment.start as PcbPoint;
        const end = segment.end as PcbPoint;
        board.push([
            'segment',
            ['start', String(start.x), String(start.y)],
            ['end', String(end.x), String(end.y)],
            ['width', String(segment.width ?? route.width ?? 0.25)],
            ['layer', `"${segment.layer}"`],
            ['net', String(netCode)],
            [
                'uuid',
                `"${segment.uuid ?? stableUuid(`${route.id}:segment:${segment.id ?? index}`)}"`,
            ],
        ]);
    }
    for (const [index, arc] of (route.arcs ?? []).entries()) {
        const start = arc.start as PcbPoint;
        const end = arc.end as PcbPoint;
        board.push([
            'arc',
            ['start', String(start.x), String(start.y)],
            ['mid', String(arc.mid.x), String(arc.mid.y)],
            ['end', String(end.x), String(end.y)],
            ['width', String(arc.width ?? route.width ?? 0.25)],
            ['layer', `"${arc.layer}"`],
            ['net', String(netCode)],
            ['uuid', `"${arc.uuid ?? stableUuid(`${route.id}:arc:${arc.id ?? index}`)}"`],
        ]);
    }
    for (const [index, via] of (route.vias ?? []).entries()) {
        const at = via.at as PcbPoint;
        board.push([
            'via',
            ['at', String(at.x), String(at.y)],
            ['size', String(via.diameter ?? 0.8)],
            ['drill', String(via.drill ?? 0.4)],
            ['layers', `"${via.fromLayer ?? 'F.Cu'}"`, `"${via.toLayer ?? 'B.Cu'}"`],
            ['net', String(netCode)],
            ['uuid', `"${via.uuid ?? stableUuid(`${route.id}:via:${via.id ?? index}`)}"`],
        ]);
    }
}

/** Reapply only coordinate-based generated copper to the matching bare board. */
export function appendGeneratedRoutes(source: string, routes: PcbExactRoute[]): string {
    const board = SExpressionParser.parse(source).find((value): value is Node =>
        isNode(value, 'kicad_pcb'),
    );
    if (!board) throw new Error('Invalid PCB for routing cache.');
    normalizeBoardNets(board);
    const codes = new Map(
        children(board, 'net').map((net) => [atom(net, 2), Number(atom(net, 1))]),
    );
    for (const route of routes) {
        const code = codes.get(route.net);
        if (code === undefined)
            throw new Error(`Routing cache references unknown net ${route.net}.`);
        const points = [
            ...(route.segments ?? []).flatMap((s) => [s.start, s.end]),
            ...(route.arcs ?? []).flatMap((s) => [s.start, s.mid, s.end]),
            ...(route.vias ?? []).map((v) => v.at),
        ];
        if (points.some((p) => !('x' in p) || !Number.isFinite(p.x) || !Number.isFinite(p.y)))
            throw new Error('Automatic routing cache must contain finite coordinates.');
        appendRoute(board, route, code);
    }
    return serializeNativeBoard(SExpressionParser.serialize(board));
}

function removeSelectedCopper(board: Node, codes: Set<number>): void {
    for (let index = board.length - 1; index >= 0; index--) {
        const value = board[index];
        if (!isNode(value) || !['segment', 'arc', 'via'].includes(String(value[0]))) continue;
        if (codes.has(Number(atom(child(value, 'net'), 1)))) board.splice(index, 1);
    }
}

function runDrc(boardPath: string): RoutingDrcReport {
    const reportPath = path.join(
        path.dirname(boardPath),
        `${path.basename(boardPath, '.kicad_pcb')}.route-drc.rpt`,
    );
    const result = spawnSync(
        process.env.KICAD_CLI ??
            (fs.existsSync('/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli')
                ? '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli'
                : 'kicad-cli'),
        [
            'pcb',
            'drc',
            '--refill-zones',
            '--exit-code-violations',
            '--output',
            reportPath,
            boardPath,
        ],
        { encoding: 'utf-8' },
    );
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT')
        return { status: 'unavailable', details: 'kicad-cli was not found' };
    const details = [result.stderr, result.stdout, result.error?.message]
        .filter(Boolean)
        .join('\n')
        .trim();
    if (result.status === 0) return { status: 'passed', reportPath, details: details || undefined };
    if (fs.existsSync(reportPath))
        return { status: 'violations', reportPath, details: details || undefined };
    return {
        status: 'failed',
        details: details || `kicad-cli exited with status ${result.status}`,
    };
}
