import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    outputPaths,
    generatedFile,
    backupGeneratedFile,
    configureOutputIgnore,
} from '../project/OutputPaths';
import { planOutputMigration, applyOutputMigration } from '../project/OutputMigration';
import { automaticallyRoute, routingInputHash } from '../router/AutomaticRouting';
import { appendGeneratedRoutes, runIncrementalRouting } from '../router/IncrementalRouter';
import { GridRoutingBackend } from '../router/GridRoutingBackend';
import { CapacityRoutingBackend } from '../router/CapacityRoutingBackend';
import { routingRegionObstacles } from '../router/RoutingRegions';
import { groupClusters } from '../kicad/GroupRelationships';
import { placePcbComponents } from '../synth/PcbPlacement';
import type { CircuitSnapshot } from '../synth/types';

const directories: string[] = [];
const temporary = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-output-workflow-'));
    directories.push(dir);
    return dir;
};
afterEach(() => {
    for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const native = (
    x = 18,
) => `(kicad_pcb (version 20260206) (net 0 "") (net 1 "SIGNAL") (net 2 "LOCAL")
    (gr_rect (start 0 0) (end 20 20) (layer "Edge.Cuts"))
    (footprint "Part" (at 2 10) (property "Reference" "J1") (pad "1" thru_hole circle (at 0 0) (size 1 1) (drill 0.5) (layers "*.Cu") (net 1 "SIGNAL")))
    (footprint "Part" (at ${x} 10) (property "Reference" "J2") (pad "1" thru_hole circle (at 0 0) (size 1 1) (drill 0.5) (layers "*.Cu") (net 1 "SIGNAL")))
    (footprint "Part" (at 10 5) (property "Reference" "U1") (pad "1" thru_hole circle (at 0 0) (size 1 1) (drill 0.5) (layers "*.Cu") (net 2 "LOCAL"))))`;
const circuit = (): CircuitSnapshot => ({
    name: 'Board',
    components: [],
    nets: [],
    pcb: { autoRoute: { backend: 'grid' } },
});

describe('generated asset boundaries', () => {
    it('uses a single export root even for nested render and manufacturing directories', () => {
        const root = temporary();
        expect(outputPaths(root).export).toBe(path.join(root, 'export'));
        expect(outputPaths(path.join(root, 'export', 'renders')).backups).toBe(
            path.join(root, '.backups'),
        );
        expect(outputPaths(path.join(root, 'export', 'jlcpcb')).renders).toBe(
            path.join(root, 'export', 'renders'),
        );
        fs.writeFileSync(path.join(root, 'Board.kicad_pcb'), 'legacy');
        expect(generatedFile(root, 'Board.kicad_pcb')).toBe(path.join(root, 'Board.kicad_pcb'));
        fs.mkdirSync(path.join(root, 'export'));
        fs.writeFileSync(path.join(root, 'export', 'Board.kicad_pcb'), 'current');
        expect(generatedFile(root, 'Board.kicad_pcb')).toBe(
            path.join(root, 'export', 'Board.kicad_pcb'),
        );
    });
    it('backs up every revision without overwriting and keeps exports tracked when requested', () => {
        const root = temporary(),
            output = path.join(root, 'export');
        fs.mkdirSync(output);
        const board = path.join(output, 'Board.kicad_pcb');
        fs.writeFileSync(board, 'old');
        const a = backupGeneratedFile(board),
            b = backupGeneratedFile(board);
        expect(a).not.toBe(b);
        expect(path.dirname(a)).toBe(path.join(root, '.backups'));
        expect(fs.readFileSync(a, 'utf8')).toBe('old');
        fs.writeFileSync(path.join(root, '.gitignore'), '# Existing policy\nnode_modules/\n');
        configureOutputIgnore(root, false, true);
        configureOutputIgnore(root, false, true);
        const ignored = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
        expect(ignored).toContain('node_modules/');
        expect(ignored).not.toContain('**/export/');
        expect(ignored.match(/\*\*\/\.backups\//g)).toHaveLength(1);
    });
    it('migrates generated files and backups while preserving code, manifests and reference images', () => {
        const root = temporary();
        fs.mkdirSync(path.join(root, 'references'));
        for (const file of [
            'Board.ts',
            'pcb-project.json',
            'Board.kicad_pcb',
            'Board.pdf',
            'mechanical-verification.json',
            'validation.json',
            'top.png',
            'Board.kicad_pcb.backup-old',
        ])
            fs.writeFileSync(path.join(root, file), file);
        fs.writeFileSync(path.join(root, 'references', 'datasheet.png'), 'reference');
        applyOutputMigration(planOutputMigration(root));
        expect(fs.readFileSync(path.join(root, 'export', 'Board.pdf'), 'utf8')).toBe('Board.pdf');
        expect(fs.existsSync(path.join(root, 'export', 'renders', 'top.png'))).toBe(true);
        expect(fs.existsSync(path.join(root, '.backups', 'Board.kicad_pcb.backup-old'))).toBe(true);
        expect(fs.existsSync(path.join(root, 'export', 'mechanical-verification.json'))).toBe(true);
        expect(fs.existsSync(path.join(root, 'export', 'validation.json'))).toBe(true);
        expect(fs.existsSync(path.join(root, 'Board.ts'))).toBe(true);
        expect(fs.existsSync(path.join(root, 'pcb-project.json'))).toBe(true);
        expect(fs.existsSync(path.join(root, 'references', 'datasheet.png'))).toBe(true);
        expect(planOutputMigration(root)).toEqual([]);
    });
    it('rejects collisions before any source is moved', () => {
        const root = temporary();
        fs.mkdirSync(path.join(root, 'export'));
        fs.writeFileSync(path.join(root, 'Board.kicad_pcb'), 'old');
        fs.writeFileSync(path.join(root, 'export', 'Board.kicad_pcb'), 'new');
        expect(() => applyOutputMigration(planOutputMigration(root))).toThrow('collision');
        expect(fs.readFileSync(path.join(root, 'Board.kicad_pcb'), 'utf8')).toBe('old');
    });
});
describe('source-driven PCB copper', () => {
    it('ignores UUID regeneration while retaining physical geometry in the input hash', () => {
        const snapshot = circuit();
        const first = native().replace('(kicad_pcb', '(kicad_pcb (uuid "first")');
        const second = first.replace('(uuid "first")', '(uuid "second")');
        expect(routingInputHash(snapshot, first, 'grid')).toBe(
            routingInputHash(snapshot, second, 'grid'),
        );
        expect(routingInputHash(snapshot, native(17), 'grid')).not.toBe(
            routingInputHash(snapshot, native(), 'grid'),
        );
    });
    it('routes from scratch, reuses matching inputs, and invalidates for moved pads and constraints', () => {
        const root = temporary(),
            snapshot = circuit();
        const first = automaticallyRoute(snapshot, native(), root, undefined, () => {});
        expect(first.cached).toBe(false);
        expect(first.content).toContain('(segment');
        expect(automaticallyRoute(snapshot, native(), root, undefined, () => {}).cached).toBe(true);
        expect(automaticallyRoute(snapshot, native(17), root, undefined, () => {}).cached).toBe(
            false,
        );
        snapshot.pcb!.routeHints = [{ id: 'layer', nets: ['SIGNAL'], preferredLayers: ['B.Cu'] }];
        expect(automaticallyRoute(snapshot, native(17), root, undefined, () => {}).cached).toBe(
            false,
        );
    });
    it('retains the previous cache when the revised circuit cannot be routed', () => {
        const root = temporary(),
            snapshot = circuit();
        automaticallyRoute(snapshot, native(), root, undefined, () => {});
        const file = path.join(root, 'Board.pcb-routing-cache.json'),
            before = fs.readFileSync(file, 'utf8');
        expect(() =>
            automaticallyRoute(snapshot, native(17), root, {
                id: 'grid',
                route: () => ({
                    completed: [],
                    skipped: [],
                    failed: [{ net: 'SIGNAL', reason: 'blocked' }],
                }),
            }),
        ).toThrow('Previous PCB retained');
        expect(fs.readFileSync(file, 'utf8')).toBe(before);
    });
    it('regenerates a corrupt disposable cache and preserves it when validation rejects copper', () => {
        const root = temporary(),
            snapshot = circuit();
        const file = path.join(root, 'Board.pcb-routing-cache.json');
        fs.writeFileSync(file, '{broken');
        expect(automaticallyRoute(snapshot, native(), root, undefined, () => {}).cached).toBe(
            false,
        );
        const before = fs.readFileSync(file, 'utf8');
        expect(() =>
            automaticallyRoute(snapshot, native(17), root, undefined, () => {
                throw Error('Unconnected pour');
            }),
        ).toThrow('Unconnected pour');
        expect(fs.readFileSync(file, 'utf8')).toBe(before);
    });
    it('preserves native named pad nets when applying cached coordinates', () => {
        const named = native().replace(/\(net ([12]) "([^"]+)"\)/g, '(net "$2")');
        const source = appendGeneratedRoutes(named, [
            {
                id: 'route',
                net: 'SIGNAL',
                segments: [
                    { start: { x: 2, y: 10 }, end: { x: 18, y: 10 }, width: 0.25, layer: 'B.Cu' },
                ],
            },
        ]);
        expect(source.match(/\(net "SIGNAL"\)/g)?.length).toBe(3);
        expect(source).not.toContain('(net 1');
    });
    it.each([new GridRoutingBackend(), new CapacityRoutingBackend()])(
        'honors hard regional routing keepouts with $id',
        (backend) => {
            const root = temporary(),
                file = path.join(root, 'Board.kicad_pcb'),
                snapshot = circuit();
            fs.writeFileSync(file, native());
            snapshot.pcb!.routingRegions = [
                {
                    id: 'wall',
                    mode: 'keepout',
                    points: [
                        { x: 8, y: 0 },
                        { x: 12, y: 0 },
                        { x: 12, y: 20 },
                        { x: 8, y: 20 },
                    ],
                },
            ];
            const report = runIncrementalRouting(snapshot, file, {
                backend,
                routeAll: true,
                runDrc: false,
            });
            expect(report.failed.map((r) => r.net)).toContain('SIGNAL');
            expect(report.completed).toEqual([]);
            expect(fs.readFileSync(file, 'utf8')).toBe(native());
        },
    );
    it('admits region-local nets while blocking unrelated crossing nets on selected layers', () => {
        const snapshot = circuit();
        snapshot.pcb!.routingRegions = [
            {
                id: 'driver',
                mode: 'local',
                layers: ['B.Cu'],
                points: [
                    { x: 8, y: 2 },
                    { x: 12, y: 2 },
                    { x: 12, y: 8 },
                    { x: 8, y: 8 },
                ],
            },
        ];
        const obstacles = routingRegionObstacles(snapshot, [
            { ref: 'U1', pad: '1', net: 'LOCAL', at: { x: 10, y: 5 }, layers: ['B.Cu'] },
            { ref: 'J1', pad: '1', net: 'SIGNAL', at: { x: 2, y: 10 }, layers: ['B.Cu'] },
        ]);
        expect(obstacles.get('LOCAL')).toEqual([]);
        expect(obstacles.get('SIGNAL')![0].layers).toEqual(['B.Cu']);
    });
});
describe('declarative placement hints', () => {
    const frames = () =>
        ['control', 'driver'].map((id) => ({
            id,
            title: id,
            members: [],
            notes: [],
            x: 0,
            y: 0,
            width: 30,
            height: 20,
        }));
    it('places a driver group to the right of its controller without individual coordinates', () => {
        const clusters = groupClusters(frames(), [
            { id: 'control', title: '', components: [] },
            {
                id: 'driver',
                title: '',
                components: [],
                relativeTo: { group: 'control', direction: 'right' },
            },
        ]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].offsets[1].x).toBeGreaterThan(30);
    });
    it('rejects cyclic and unknown group anchors', () => {
        expect(() =>
            groupClusters(frames(), [
                {
                    id: 'driver',
                    title: '',
                    components: [],
                    relativeTo: { group: 'missing', direction: 'right' },
                },
            ]),
        ).toThrow('Unknown');
        expect(() =>
            groupClusters(
                frames(),
                ['control', 'driver'].map((id, i) => ({
                    id,
                    title: '',
                    components: [],
                    relativeTo: { group: i ? 'control' : 'driver', direction: 'right' },
                })),
            ),
        ).toThrow('Cyclic');
    });
    it('requires physical placement for every footprint and resolves explicit offsets', () => {
        const snapshot = circuit();
        snapshot.components = [
            { ref: 'U1', footprint: 'Part' },
            { ref: 'C1', footprint: 'Part' },
        ] as any;
        placePcbComponents(
            snapshot,
            { U1: { x: 10, y: 10, side: 'back' } },
            { relative: { C1: { anchor: 'U1', x: 3, y: -2 } } },
        );
        expect(snapshot.components[1].pcbPosition).toMatchObject({ x: 13, y: 8, side: 'back' });
        expect(() => placePcbComponents(snapshot, {})).toThrow('Missing');
    });
});
