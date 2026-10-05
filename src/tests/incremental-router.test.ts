import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { runIncrementalRouting, SimpleRoutingBackend } from '../router';
import { CircuitSnapshot } from '../synth/types';
import { SExpressionParser } from '../kicad/SExpressionParser';

const temporaryDirectories: string[] = [];
afterEach(() => {
    for (const directory of temporaryDirectories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});

const manualUuid = '30000000-0000-0000-0000-000000000001';

function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-incremental-router-'));
    temporaryDirectories.push(directory);
    const boardPath = path.join(directory, 'RouterBoard.kicad_pcb');
    fs.writeFileSync(
        boardPath,
        `(kicad_pcb
    (version 20240108)
    (generator "manual")
    (general (thickness 1.6))
    (paper "A4")
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
    (setup (pad_to_mask_clearance 0))
    (net 0 "") (net 1 "SIGNAL") (net 2 "MANUAL")
    ${footprint('J1', 5, 5, 1)} ${footprint('J2', 25, 15, 1)}
    ${footprint('J3', 5, 15, 2)} ${footprint('J4', 25, 5, 2)}
    (segment (start 5 15) (end 25 5) (width 0.25) (layer "F.Cu") (net 2) (uuid "${manualUuid}"))
    (gr_rect (start 0 0) (end 30 20) (stroke (width 0.05) (type solid)) (fill none) (layer "Edge.Cuts") (uuid "40000000-0000-0000-0000-000000000001"))
  )\n`,
    );
    const snapshot: CircuitSnapshot = {
        name: 'RouterBoard',
        components: [],
        nets: [],
        pcb: {
            routeHints: [
                {
                    id: 'signal',
                    nets: ['SIGNAL'],
                    preferredLayers: ['F.Cu'],
                    waypoints: [{ x: 15, y: 10 }],
                    length: { max: 10 },
                },
                { id: 'manual', nets: ['MANUAL'], preferredLayers: ['B.Cu'] },
            ],
            netClasses: [
                { name: 'Default', nets: ['SIGNAL', 'MANUAL'], width: 0.3, clearance: 0.2 },
            ],
        },
    };
    return { directory, boardPath, snapshot };
}

function footprint(ref: string, x: number, y: number, net: number): string {
    return `(footprint "Test:Pad" (layer "F.Cu") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 -2 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" thru_hole circle (at 0 0) (size 1.5 1.5) (drill 0.8) (layers "*.Cu" "*.Mask") (net ${net} "${net === 1 ? 'SIGNAL' : 'MANUAL'}")))`;
}

describe('incremental routing', () => {
    it('routes only hinted unrouted nets and preserves manual copper', () => {
        const { boardPath, snapshot } = fixture();
        const before = fs.readFileSync(boardPath, 'utf-8');
        const report = runIncrementalRouting(snapshot, boardPath, {
            backend: new SimpleRoutingBackend(),
            runDrc: false,
        });
        const board = fs.readFileSync(boardPath, 'utf-8');
        expect(report.completed.map((entry) => entry.net)).toEqual(['SIGNAL']);
        expect(report.skipped).toContainEqual(
            expect.objectContaining({
                net: 'MANUAL',
                reason: expect.stringContaining('preserved'),
            }),
        );
        expect(report.constraintViolating).toContainEqual(
            expect.objectContaining({ net: 'SIGNAL', reason: expect.stringContaining('maximum') }),
        );
        expect(report.backupPath && fs.existsSync(report.backupPath)).toBe(true);
        expect(board).toContain(manualUuid);
        expect(findNodeByUuid(board, manualUuid)).toEqual(findNodeByUuid(before, manualUuid));
        expect(board.match(/\(segment/g) ?? []).toHaveLength(5);
        expect(report.fabricationReady).toBe(false);
        expect(report.humanReviewRequired).toBe(true);
    });

    it('requires explicit net selection, backs up, and replaces only that net', () => {
        const { boardPath, snapshot } = fixture();
        const before = fs.readFileSync(boardPath, 'utf-8');
        const report = runIncrementalRouting(snapshot, boardPath, {
            rerouteNets: ['MANUAL'],
            runDrc: false,
        });
        const board = fs.readFileSync(boardPath, 'utf-8');
        expect(report.completed.map((entry) => entry.net).sort()).toEqual(['MANUAL', 'SIGNAL']);
        expect(report.backupPath).toBeTruthy();
        expect(fs.readFileSync(report.backupPath!, 'utf-8')).toBe(before);
        expect(board).not.toContain(manualUuid);
        expect(report.preservedManualCopper).toEqual({ segments: 0, arcs: 0, vias: 0 });
    });

    it('never removes framework-locked exact routes and supports substitutable backends', () => {
        const { boardPath, snapshot } = fixture();
        snapshot.pcb!.exactRoutes = [{ id: 'locked', net: 'MANUAL', segments: [] }];
        let called = false;
        const backend = {
            id: 'test-backend',
            route(request: any) {
                called = true;
                expect(request.routeHints).toBe(snapshot.pcb!.routeHints);
                expect(request.boardSource).toContain(manualUuid);
                expect(request.existingCopperNets.has('MANUAL')).toBe(true);
                expect(request.lockedNets.has('MANUAL')).toBe(true);
                expect(request.rerouteNets.has('MANUAL')).toBe(true);
                return {
                    completed: [],
                    skipped: request.eligibleNets.map((net: string) => ({ net, reason: 'test' })),
                    failed: [],
                };
            },
        };
        const report = runIncrementalRouting(snapshot, boardPath, {
            backend,
            rerouteNets: ['MANUAL'],
            runDrc: false,
        });
        expect(called).toBe(true);
        expect(report.backend).toBe('test-backend');
        expect(report.skipped).toContainEqual({
            net: 'MANUAL',
            reason: 'framework-owned exact route is locked',
        });
        expect(fs.readFileSync(boardPath, 'utf-8')).toContain(manualUuid);
    });

    it('rejects an unknown explicitly selected reroute net', () => {
        const { boardPath, snapshot } = fixture();
        expect(() =>
            runIncrementalRouting(snapshot, boardPath, { rerouteNets: ['MISSING'], runDrc: false }),
        ).toThrow(/unknown net 'MISSING'/);
    });

    it('is a no-op when TypeScript declares no eligible route hints', () => {
        const { boardPath, snapshot } = fixture();
        const before = fs.readFileSync(boardPath, 'utf-8');
        snapshot.pcb!.routeHints = [];
        const report = runIncrementalRouting(snapshot, boardPath, { runDrc: false });
        expect(report.completed).toEqual([]);
        expect(report.backupPath).toBeUndefined();
        expect(fs.readFileSync(boardPath, 'utf-8')).toBe(before);
    });
});

function findNodeByUuid(source: string, uuid: string): unknown {
    const walk = (value: unknown): unknown => {
        if (!Array.isArray(value)) return undefined;
        if (
            value.some(
                (child) => Array.isArray(child) && child[0] === 'uuid' && child[1] === `"${uuid}"`,
            )
        )
            return value;
        for (const child of value) {
            const found = walk(child);
            if (found) return found;
        }
        return undefined;
    };
    return walk(SExpressionParser.parse(source));
}
