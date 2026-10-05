import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { Schematic } from '../synth/Schematic';
import { Component } from '../synth/Component';
import { Net } from '../synth/Net';
import { BoardModule } from '../synth/BoardModule';
import { PcbGenerator } from '../kicad/PcbGenerator';
import { KicadGenerator } from '../kicad/KicadGenerator';
import { UuidManager } from '../kicad/UuidManager';
import { boardRoot, child, value, removeBoardOutline } from '../kicad/BoardComposition';
import { SExpressionParser as Parser, type SExpr } from '../kicad/SExpressionParser';

const outline = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 15 },
    { x: 0, y: 15 },
];
const cli = '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli';
class SourceBoard extends Schematic {
    constructor() {
        super({
            name: 'source',
            pcb: {
                outline,
                requireAllPlaced: true,
                exactRoutes: [
                    {
                        id: 'link',
                        net: 'SIGNAL',
                        segments: [
                            {
                                start: { ref: 'J1', pad: '1' },
                                end: { ref: 'J1', pad: '2' },
                                layer: 'B.Cu',
                                width: 0.3,
                            },
                        ],
                    },
                ],
                zones: [
                    {
                        id: 'ground',
                        net: 'SIGNAL',
                        layer: 'B.Cu',
                        boardInset: 0.5,
                        clearance: 0.3,
                        minThickness: 0.2,
                    },
                ],
            },
            moduleInterface: {
                origin: { x: 5, y: 5 },
                pads: [
                    { number: '1', ref: 'J1', pad: '1' },
                    { number: '2', ref: 'J1', pad: '2' },
                ],
            },
        });
    }
    generate() {
        const signal = new Net({ name: 'SIGNAL' });
        const connector = new Component({
            ref: 'J1',
            symbol: 'Connector_Generic:Conn_01x02',
            footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical',
            pcbPosition: { x: 5, y: 5, rotation: 90 },
        });
        connector.pins[1].tie(signal);
        connector.pins[2].tie(signal);
    }
}
function generate(board: Schematic, dir: string): string {
    return new PcbGenerator(board._generateWithCapture(), new UuidManager(), dir).generate()
        .content;
}
function footprints(content: string): SExpr[][] {
    return boardRoot(content).filter(
        (item): item is SExpr[] => Array.isArray(item) && item[0] === 'footprint',
    );
}
function temporary<T>(run: (dir: string) => T): T {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-composition-'));
    try {
        return run(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe('referenced boards', () => {
    it('isolates nested captures and regenerates repeated references without accumulating state', () => {
        const source = new SourceBoard();
        class Panel extends Schematic {
            generate() {
                new Net({ name: 'PARENT_BEFORE' });
                this.addBoard(source, { id: 'left', x: 0, y: 0 });
                this.addBoard(source, { id: 'right', x: 30, y: 0 });
                new Net({ name: 'PARENT_AFTER' });
            }
        }
        const panel = new Panel({ name: 'panel' });
        for (let i = 0; i < 2; i++) {
            const snapshot = panel._generateWithCapture();
            expect(snapshot.components).toHaveLength(0);
            expect(snapshot.nets.map((net) => net.name)).toEqual(['PARENT_BEFORE', 'PARENT_AFTER']);
            expect(snapshot.boards).toHaveLength(2);
            expect(snapshot.boards![0].snapshot.components).toHaveLength(1);
        }
    });
    it('copies copper and isolates nets, references, UUIDs, anchors and absolute pad angles', () =>
        temporary((dir) => {
            const source = new SourceBoard();
            class Panel extends Schematic {
                generate() {
                    this.addBoard(source, { id: 'left', x: 0, y: 0 });
                    this.addBoard(source, { id: 'right', x: 40, y: 0, rotation: 90 });
                }
            }
            const content = generate(new Panel({ name: 'panel' }), dir);
            const parts = footprints(content);
            expect(parts.map((part) => value(child(part, 'property')![2]))).toEqual([
                'left_J1',
                'right_J1',
            ]);
            expect(child(parts[1], 'at')?.slice(1)).toEqual(['45', '-5', '180']);
            const pad = parts[1].find(
                (item): item is SExpr[] => Array.isArray(item) && item[0] === 'pad',
            )!;
            expect(child(pad, 'at')?.[3]).toBe('180');
            expect(content).toContain('left/SIGNAL');
            expect(content).toContain('right/SIGNAL');
            expect(
                boardRoot(content).filter((item) => Array.isArray(item) && item[0] === 'segment'),
            ).toHaveLength(2);
            expect(
                boardRoot(content).filter((item) => Array.isArray(item) && item[0] === 'zone'),
            ).toHaveLength(2);
            const ids = [...content.matchAll(/\(uuid "([^"]+)"\)/g)].map((match) => match[1]);
            expect(new Set(ids).size).toBe(ids.length);
        }));
    it('rejects cycles and duplicate instance names and restores registry after failure', () => {
        class Cycle extends Schematic {
            generate() {
                this.addBoard(this, { id: 'loop', x: 0, y: 0 });
            }
        }
        expect(() => new Cycle({ name: 'cycle', pcb: {} })._generateWithCapture()).toThrow(
            'Cyclic',
        );
        class Duplicate extends Schematic {
            generate() {
                this.addBoard(new SourceBoard(), { id: 'a', x: 0, y: 0 });
                this.addBoard(new SourceBoard(), { id: 'a', x: 30, y: 0 });
            }
        }
        expect(() => new Duplicate({ name: 'duplicate', pcb: {} })._generateWithCapture()).toThrow(
            'Duplicate',
        );
        expect(new SourceBoard()._generateWithCapture().components).toHaveLength(1);
    });
});

it('writes child schematics separately and synthesizes the panel through the normal generator', () =>
    temporary((dir) => {
        const source = new SourceBoard();
        class Panel extends Schematic {
            generate() {
                this.addBoard(source, { id: 'child', x: 0, y: 0 });
            }
        }
        const result = new KicadGenerator().generate(
            new Panel({ name: 'panel' })._generateWithCapture(),
            dir,
            { pcbMode: 'rebuild', validateWithKicad: false },
        );
        expect(result.success).toBe(true);
        expect(fs.existsSync(path.join(dir, 'boards/child/source.kicad_sch'))).toBe(true);
        expect(footprints(fs.readFileSync(path.join(dir, 'panel.kicad_pcb'), 'utf8'))).toHaveLength(
            1,
        );
    }));

describe('board modules', () => {
    it('derives selected contact geometry and origin, excluding source copper and internal components', () =>
        temporary((dir) => {
            const source = new SourceBoard();
            const module = new BoardModule({
                name: 'SourceModule',
                ref: 'U1',
                symbol: 'Connector_Generic:Conn_01x02',
                schematic: source,
            });
            const fp = module.createFootprint(generate(source, dir));
            const root = Parser.parse(fp.serialize())[0] as SExpr[];
            const pads = root.filter(
                (item): item is SExpr[] => Array.isArray(item) && item[0] === 'pad',
            );
            expect(pads).toHaveLength(2);
            expect(child(pads[0], 'at')?.slice(1)).toEqual(['0', '0', '90']);
            expect(child(pads[1], 'at')?.slice(1)).toEqual(['2.54', '0', '90']);
            expect(fp.serialize()).not.toContain('(net ');
            expect(fp.serialize()).not.toContain('Edge.Cuts');
            expect(fp.serialize()).toContain('F.Fab');
            fp.addRect({ x1: -1, y1: -1, x2: 4, y2: 1, layer: 'F.CrtYd' });
            fp.set3DModel({ path: '/tmp/current-module.wrl', offset: { x: 0, y: 0, z: 13 } });
            expect(fp.serialize()).toContain('F.CrtYd');
            expect(fp.serialize()).toContain('/tmp/current-module.wrl');
            const augmented = Parser.parse(fp.serialize())[0] as SExpr[];
            expect(
                augmented.filter((item) => Array.isArray(item) && item[0] === 'pad'),
            ).toHaveLength(2);
            expect(() =>
                new BoardModule({
                    name: 'Missing',
                    ref: 'U2',
                    symbol: 'Connector_Generic:Conn_01x02',
                    schematic: source,
                    interface: { pads: [{ number: '1', ref: 'missing', pad: '1' }] },
                }).createFootprint(generate(source, dir)),
            ).toThrow('cannot resolve');
        }));
    it.skipIf(!fs.existsSync(cli))(
        'exports actual assembled model, instantiates module, and passes native DRC with zone refill',
        () =>
            temporary((dir) => {
                const source = new SourceBoard();
                class Carrier extends Schematic {
                    generate() {
                        const module = new BoardModule({
                            name: 'SourceModule',
                            ref: 'U1',
                            symbol: 'Connector_Generic:Conn_01x02',
                            schematic: source,
                            pcbPosition: { x: 10, y: 10 },
                        });
                        const signal = new Net({ name: 'HOST' });
                        module.pins[1].tie(signal);
                        module.pins[2].tie(signal);
                    }
                }
                const carrier = generate(
                    new Carrier({
                        name: 'carrier',
                        pcb: {
                            outline: [
                                { x: 0, y: 0 },
                                { x: 40, y: 0 },
                                { x: 40, y: 30 },
                                { x: 0, y: 30 },
                            ],
                            requireAllPlaced: true,
                            exactRoutes: [
                                {
                                    id: 'host-link',
                                    net: 'HOST',
                                    segments: [
                                        {
                                            start: { ref: 'U1', pad: '1' },
                                            end: { ref: 'U1', pad: '2' },
                                            layer: 'B.Cu',
                                            width: 0.3,
                                        },
                                    ],
                                },
                            ],
                        },
                    }),
                    dir,
                );
                expect(footprints(carrier)).toHaveLength(1);
                expect(carrier).toContain('Board_Modules:SourceModule');
                expect(carrier).toContain('SourceModule.wrl');
                expect(
                    fs.statSync(path.join(dir, 'board-modules/SourceModule/SourceModule.wrl')).size,
                ).toBeGreaterThan(1000);
                expect(fs.readFileSync(path.join(dir, 'fp-lib-table'), 'utf8')).toContain(
                    'Board_Modules',
                );
                class Panel extends Schematic {
                    generate() {
                        this.addBoard(source, { id: 'a', x: 0, y: 0 });
                        this.addBoard(source, { id: 'b', x: 30, y: 0 });
                    }
                }
                for (const [name, content] of [
                    ['panel', generate(new Panel({ name: 'panel' }), dir)],
                    ['carrier', carrier],
                ]) {
                    const boardPath = path.join(dir, `${name}.kicad_pcb`);
                    fs.writeFileSync(boardPath, content);
                    const report = path.join(dir, `${name}.json`);
                    const drc = spawnSync(
                        cli,
                        [
                            'pcb',
                            'drc',
                            '--refill-zones',
                            '--format',
                            'json',
                            '--output',
                            report,
                            boardPath,
                        ],
                        { encoding: 'utf8', timeout: 30000 },
                    );
                    expect(
                        drc.status,
                        `${name}: ${drc.signal} ${drc.error?.message ?? ''} ${drc.stderr} ${drc.stdout}`,
                    ).toBe(0);
                    const result = JSON.parse(fs.readFileSync(report, 'utf8'));
                    expect(
                        result.violations.filter(
                            (item: { severity: string }) => item.severity === 'error',
                        ),
                    ).toEqual([]);
                    expect(result.unconnected_items).toEqual([]);
                }
            }),
        60000,
    );
});

describe('saved PCB panels', () => {
    it('reads the latest saved copper every time and retains internal cuts', () =>
        temporary((dir) => {
            const source = new SourceBoard();
            const file = path.join(dir, 'source.kicad_pcb');
            const raw = generate(source, dir);
            fs.writeFileSync(file, raw);
            class NativePanel extends Schematic {
                generate() {
                    this.addBoard(source, {
                        id: 'unit',
                        x: 30,
                        y: 40,
                        sourceDirectory: dir,
                        sourcePcb: 'source.kicad_pcb',
                        replaceOutline: outline,
                    });
                }
            }
            const panel = new NativePanel({
                name: 'native',
                pcb: {
                    outline: [
                        { x: 0, y: 0 },
                        { x: 100, y: 0 },
                        { x: 100, y: 100 },
                        { x: 0, y: 100 },
                    ],
                },
            });
            const first = generate(panel, dir);
            expect(first).toContain('unit/SIGNAL');
            const parsed = boardRoot(raw);
            const part = parsed.find(
                (item) => Array.isArray(item) && item[0] === 'footprint',
            ) as SExpr[];
            part.push(['model', '"${KIPRJMOD}/models/unit.wrl"']);
            const segment = parsed.find(
                (item) => Array.isArray(item) && item[0] === 'segment',
            ) as SExpr[];
            child(segment, 'width')![1] = '0.7';
            parsed.push([
                'gr_circle',
                ['center', '10', '8'],
                ['end', '11', '8'],
                ['stroke', ['width', '0.05'], ['type', 'default']],
                ['layer', '"Edge.Cuts"'],
            ]);
            fs.writeFileSync(file, Parser.serialize(parsed));
            const next = generate(panel, dir);
            expect(next).toContain('(width 0.7)');
            expect(next).toContain('(center 40 48)');
            expect(next).toContain(path.join(dir, 'models/unit.wrl'));
            expect(next).not.toEqual(first);
            fs.unlinkSync(file);
            expect(() => generate(panel, dir)).toThrow();
        }));
    it('rejects an unexpected native perimeter instead of dropping cuts', () => {
        const root = boardRoot('(kicad_pcb)');
        expect(() => removeBoardOutline(root, outline)).toThrow('perimeter differs');
    });
});
