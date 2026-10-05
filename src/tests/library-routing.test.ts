import { describe, expect, it, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Router, pointOnSegment } from '../kicad/Router';
import { CapacityRoutingBackend } from '../router/CapacityRoutingBackend';
import { runIncrementalRouting } from '../router/IncrementalRouter';
import { CircuitSnapshot } from '../synth/types';
const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});
describe('libavoid schematic routing', () => {
    it('routes around obstacles through exact off-grid support points', () => {
        const waypoints = [
            { x: 3.33, y: 8.17 },
            { x: 15.29, y: 8.17 },
        ];
        const points = new Router().route(
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            [{ x: 8, y: -3, width: 4, height: 8 }],
            waypoints,
        );
        expect(points).toContainEqual(waypoints[0]);
        expect(points).toContainEqual(waypoints[1]);
        expect(points[0]).toEqual({ x: 0, y: 0 });
        expect(points[points.length - 1]).toEqual({ x: 20, y: 0 });
        expect(points.some((point) => point.y >= 8)).toBe(true);
    });
    it('rejects a required support point inside an obstacle', () => {
        expect(() =>
            new Router().route(
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                [{ x: 8, y: -3, width: 4, height: 8 }],
                [{ x: 10, y: 0 }],
            ),
        ).toThrow(/waypoint.*obstacle/);
    });
});
function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-library-routing-'));
    directories.push(directory);
    const file = path.join(directory, 'Library.kicad_pcb');
    const pad = (ref: string, x: number, y: number, net: number) =>
        `(footprint "Part" (layer "F.Cu") (at ${x} ${y}) (property "Reference" "${ref}") (pad "1" thru_hole circle (at 0 0) (size 1 1) (drill 0.5) (layers "*.Cu" "*.Mask") (net ${net} "${net === 1 ? 'SIGNAL' : 'OTHER'}")))`;
    fs.writeFileSync(
        file,
        `(kicad_pcb (version 20260206) (generator "pcb_framework") (net 0 "") (net 1 "SIGNAL") (net 2 "OTHER") ${pad('J1', 3, 10, 1)} ${pad('J2', 27, 10, 1)} ${pad('J3', 15, 10, 2)} (gr_rect (start 0 0) (end 30 20) (layer "Edge.Cuts")))`,
    );
    const snapshot: CircuitSnapshot = {
        name: 'Library',
        components: [],
        nets: [],
        pcb: {
            netClasses: [{ name: 'Signal', nets: ['SIGNAL'], width: 0.25, clearance: 0.2 }],
            routeHints: [
                {
                    id: 'signal',
                    nets: ['SIGNAL'],
                    preferredLayers: ['F.Cu'],
                    waypoints: [
                        { x: 10, y: 15 },
                        { x: 20, y: 15 },
                    ],
                },
            ],
        },
    };
    return { file, snapshot };
}
describe('tscircuit PCB routing', () => {
    it('routes through required points, avoids foreign pads, and writes no copper on forbidden layers', () => {
        const { file, snapshot } = fixture();
        const report = runIncrementalRouting(snapshot, file, {
            backend: new CapacityRoutingBackend(),
            runDrc: false,
        });
        expect(report.failed).toEqual([]);
        expect(report.completed.map((item) => item.net)).toEqual(['SIGNAL']);
        const source = fs.readFileSync(file, 'utf8');
        expect(source).toContain('(layer "F.Cu")');
        expect(source).toContain('(start 10 15)');
        expect(source).not.toContain('(layer "B.Cu")');
    });
    it('rejects blocked support points without changing the board', () => {
        const { file, snapshot } = fixture();
        snapshot.pcb!.routeHints![0].waypoints = [{ x: 15, y: 10 }];
        const before = fs.readFileSync(file, 'utf8');
        const report = runIncrementalRouting(snapshot, file, {
            backend: new CapacityRoutingBackend(),
            runDrc: false,
        });
        expect(report.failed.map((item) => item.net)).toEqual(['SIGNAL']);
        expect(report.completed).toEqual([]);
        expect(fs.readFileSync(file, 'utf8')).toBe(before);
    });
});
describe('routed schematic generation', () => {
    it('emits native KiCad wires through configured support points', async () => {
        const { Component, Net, Schematic } = await import('../synth');
        const { SchematicGenerator } = await import('../kicad/SchematicGenerator');
        const { SymbolLibrary } = await import('../kicad/SymbolLibrary');
        const { UuidManager } = await import('../kicad/UuidManager');
        class Board extends Schematic {
            constructor() {
                super({
                    name: 'Wires',
                    connectionStyle: 'routed',
                    schematicRouting: {
                        routeHints: [
                            { id: 'signal', nets: ['SIGNAL'], waypoints: [{ x: 40.33, y: 60.17 }] },
                        ],
                    },
                });
            }
            generate() {
                const net = new Net({ name: 'SIGNAL' });
                for (const [ref, x] of [
                    ['R1', 20],
                    ['R2', 60],
                ] as const) {
                    const r = new Component({
                        ref,
                        symbol: 'Device:R',
                        footprint: 'Test:Part',
                        schematicPosition: { x, y: 40 },
                    });
                    r.pins[1].tie(net);
                    r.pins[2].dnc();
                }
            }
        }
        const snapshot = new Board()._generateWithCapture();
        const library = new SymbolLibrary([path.join(__dirname, 'assets', 'symbols')]);
        const source = new SchematicGenerator(snapshot, library, new UuidManager()).generate();
        expect(source).toMatch(/\(xy 40\.33(?:00)? 60\.17(?:00)?\)/);
        expect(source).not.toContain('(global_label "SIGNAL"');
        snapshot.schematicRouting!.routeHints![0].nets = ['missing'];
        expect(() =>
            new SchematicGenerator(snapshot, library, new UuidManager()).generate(),
        ).toThrow(/unknown net/);
    });
});

describe('PCB autorouter constraints', () => {
    it('uses vias to bypass a front-layer wall while preserving existing copper', () => {
        const { file, snapshot } = fixture();
        const id = '80000000-0000-0000-0000-000000000001';
        let source = fs
            .readFileSync(file, 'utf8')
            .split('(layers "*.Cu" "*.Mask")')
            .join('(layers "F.Cu" "F.Mask")');
        source = source.replace(
            /\)\s*$/,
            `(segment (start 15 0) (end 15 20) (width 0.4) (layer "F.Cu") (net 2) (uuid "${id}")))`,
        );
        fs.writeFileSync(file, source);
        snapshot.pcb!.routeHints![0].preferredLayers = ['F.Cu', 'B.Cu'];
        snapshot.pcb!.routeHints![0].waypoints = [];
        const report = runIncrementalRouting(snapshot, file, {
            backend: new CapacityRoutingBackend(),
            runDrc: false,
        });
        expect(report.failed).toEqual([]);
        const output = fs.readFileSync(file, 'utf8');
        expect(output).toContain(id);
        expect(output).toContain('(layer "B.Cu")');
        expect(output.match(/\(via\b/g)?.length).toBeGreaterThanOrEqual(2);
    });
    it('routes all eligible nets without requiring a hint', () => {
        const { file, snapshot } = fixture();
        snapshot.pcb!.routeHints = [];
        const report = runIncrementalRouting(snapshot, file, {
            backend: new CapacityRoutingBackend(),
            routeAll: true,
            runDrc: false,
        });
        expect(report.completed.map((item) => item.net)).toEqual(['SIGNAL']);
        expect(report.skipped.map((item) => item.net)).toContain('OTHER');
    });
});

it('keeps copper belonging to a failed selected reroute as an obstacle', () => {
    const { file, snapshot } = fixture();
    let source = fs.readFileSync(file, 'utf8');
    const walls = ['F.Cu', 'B.Cu']
        .map(
            (layer, index) =>
                `(segment (start 15 0) (end 15 20) (width 0.4) (layer "${layer}") (net 2) (uuid "80000000-0000-0000-0000-00000000000${index + 1}"))`,
        )
        .join(' ');
    source = source.replace(/\)\s*$/, `${walls})`);
    fs.writeFileSync(file, source);
    const report = runIncrementalRouting(snapshot, file, {
        backend: new CapacityRoutingBackend(),
        rerouteNets: ['OTHER', 'SIGNAL'],
        runDrc: false,
    });
    expect(report.completed).toEqual([]);
    expect(report.skipped.map((item) => item.net)).toContain('OTHER');
    expect(report.failed.map((item) => item.net)).toContain('SIGNAL');
    expect(fs.readFileSync(file, 'utf8')).toBe(source);
});
