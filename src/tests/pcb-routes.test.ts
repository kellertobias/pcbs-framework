import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { KicadGenerator } from '../kicad/KicadGenerator';
import { PcbGenerator } from '../kicad/PcbGenerator';
import { synchronizePcb } from '../kicad/PcbSynchronizer';
import { UuidManager } from '../kicad/UuidManager';
import { Component, Net, Schematic } from '../synth';

const temporaryDirectories: string[] = [];
afterEach(() => {
    for (const directory of temporaryDirectories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});

function fixture(maxVias = 1) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-exact-route-'));
    temporaryDirectories.push(directory);
    const pretty = path.join(directory, 'Test.pretty');
    fs.mkdirSync(pretty);
    fs.writeFileSync(
        path.join(pretty, 'Part.kicad_mod'),
        `(footprint "Part"
    (version 20241229) (generator "test") (layer "F.Cu")
    (property "Reference" "REF**" (at 0 -2 0) (layer "F.SilkS") (uuid "20000000-0000-0000-0000-000000000001") (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "Part" (at 0 2 0) (layer "F.Fab") (uuid "20000000-0000-0000-0000-000000000002") (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" thru_hole circle (at 0 0) (size 1.5 1.5) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "20000000-0000-0000-0000-000000000003"))
    (pad "2" thru_hole circle (at 2 0) (size 1.5 1.5) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "20000000-0000-0000-0000-000000000004")))\n`,
    );
    fs.writeFileSync(
        path.join(directory, 'fp-lib-table'),
        `(fp_lib_table (version 7) (lib (name "Test")(type "KiCad")(uri "${pretty}")(options "")(descr "")))`,
    );

    class RouteBoard extends Schematic {
        constructor() {
            super({
                name: 'RouteBoard',
                pcb: {
                    outline: [
                        { x: 0, y: 0 },
                        { x: 40, y: 0 },
                        { x: 40, y: 20 },
                        { x: 0, y: 20 },
                    ],
                    routeHints: [
                        {
                            id: 'signal-corridor',
                            nets: ['SIGNAL'],
                            preferredLayers: ['F.Cu', 'B.Cu'],
                            corridors: [
                                [
                                    { x: 5, y: 5 },
                                    { x: 35, y: 5 },
                                    { x: 35, y: 15 },
                                    { x: 5, y: 15 },
                                ],
                            ],
                            forbiddenRegions: [
                                [
                                    { x: 5, y: 16 },
                                    { x: 35, y: 16 },
                                    { x: 35, y: 19 },
                                    { x: 5, y: 19 },
                                ],
                            ],
                            waypoints: [{ x: 20, y: 10 }],
                            maxVias,
                            topology: 'point-to-point',
                        },
                    ],
                    exactRoutes: [
                        {
                            id: 'signal-critical',
                            net: 'SIGNAL',
                            width: 0.3,
                            segments: [
                                {
                                    id: 'first',
                                    start: { ref: 'R1', pad: '1' },
                                    end: { x: 20, y: 10 },
                                    layer: 'F.Cu',
                                },
                                {
                                    id: 'last',
                                    start: { x: 24, y: 10 },
                                    end: { ref: 'R2', pad: '1' },
                                    layer: 'B.Cu',
                                },
                            ],
                            arcs: [
                                {
                                    id: 'bend',
                                    start: { x: 20, y: 10 },
                                    mid: { x: 22, y: 12 },
                                    end: { x: 24, y: 10 },
                                    layer: 'F.Cu',
                                },
                            ],
                            vias: [
                                {
                                    id: 'change',
                                    at: { x: 24, y: 10 },
                                    fromLayer: 'F.Cu',
                                    toLayer: 'B.Cu',
                                    diameter: 0.8,
                                    drill: 0.4,
                                },
                            ],
                        },
                    ],
                },
            });
        }
        generate() {
            const signal = new Net({ name: 'SIGNAL' });
            for (const [ref, x] of [
                ['R1', 10],
                ['R2', 30],
            ] as const) {
                const part = new Component({
                    symbol: 'Device:R',
                    ref,
                    footprint: 'Test:Part',
                    pcbPosition: { x, y: 10 },
                });
                part.pins[1].tie(signal);
                part.pins[2].dnc();
            }
        }
    }
    const board = new RouteBoard();
    const snapshot = board._generateWithCapture();
    const uuids = new UuidManager();
    uuids.load(path.join(directory, 'uuids.json'));
    return { directory, snapshot, generator: new PcbGenerator(snapshot, uuids, directory) };
}

describe('route intent and exact routes', () => {
    it('emits stable exact segments, arcs and vias resolved from pads', () => {
        const { generator } = fixture();
        const first = generator.generate();
        const second = generator.generate();
        expect(second.content).toBe(first.content);
        expect(first.content.match(/\(segment/g) ?? []).toHaveLength(2);
        expect(first.content.match(/\(arc/g) ?? []).toHaveLength(1);
        expect(first.content.match(/\(via/g) ?? []).toHaveLength(1);
        expect(first.content).toContain('(start 10 10)');
        expect(first.content).toContain('(end 30 10)');
        expect(
            first.warnings.filter((warning) =>
                warning.startsWith('PCB_ROUTE_CONSTRAINT_VIOLATION'),
            ),
        ).toHaveLength(0);
    });

    it('syncs stable exact copper without touching manual tracks', () => {
        const { generator } = fixture();
        const generated = generator.generate().content;
        const manualSegment = `\n\t(segment (start 1 1) (end 2 1) (width 0.2) (layer "F.Cu") (net 1) (uuid "30000000-0000-0000-0000-000000000001"))`;
        const existing = generated.replace(/\n\)\s*$/, `${manualSegment}\n)\n`);
        const synced = synchronizePcb(existing, generated);
        expect(synced.content.match(/\(segment/g) ?? []).toHaveLength(3);
        expect(synced.content).toContain('30000000-0000-0000-0000-000000000001');
        expect(synced.report.updatedGeometry.length).toBeGreaterThanOrEqual(4);
    });

    it('keeps hints as sidecar intent and reports constraint violations', () => {
        const { directory, snapshot, generator } = fixture(0);
        const generated = generator.generate();
        expect(generated.warnings).toContainEqual(
            expect.stringContaining('PCB_ROUTE_CONSTRAINT_VIOLATION'),
        );

        const hintOnly = { ...snapshot, pcb: { ...snapshot.pcb!, exactRoutes: [] } };
        const result = new KicadGenerator([]).generate(hintOnly, directory, {
            pcbMode: 'rebuild',
            validateWithKicad: false,
        });
        const board = fs.readFileSync(path.join(directory, 'RouteBoard.kicad_pcb'), 'utf-8');
        const intent = JSON.parse(
            fs.readFileSync(path.join(directory, 'RouteBoard.pcb-intent.json'), 'utf-8'),
        );
        expect(result.success).toBe(true);
        expect(board).not.toContain('\n\t(segment');
        expect(intent.hints[0].id).toBe('signal-corridor');
        expect(intent.note).toContain('do not create copper');
    });

    it('rejects unresolved pads and illegal arc geometry', () => {
        const unresolved = fixture();
        unresolved.snapshot.pcb!.exactRoutes![0].segments![0].start = { ref: 'R404', pad: '1' };
        expect(() => unresolved.generator.generate()).toThrow(
            /cannot resolve positioned footprint 'R404'/,
        );

        const illegal = fixture();
        illegal.snapshot.pcb!.exactRoutes![0].arcs![0].mid = { x: 22, y: 10 };
        expect(() => illegal.generator.generate()).toThrow(/collinear\/illegal/);
    });
});
