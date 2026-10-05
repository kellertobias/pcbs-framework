import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { Component, ModuleRouting, Net, RoutedComposable, Schematic } from '../synth';
import {
    captureRouting,
    copperUuids,
    loadRoutingFile,
    saveRoutingFile,
} from '../kicad/RoutingFile';
import { PcbGenerator } from '../kicad/PcbGenerator';
import { KicadGenerator } from '../kicad/KicadGenerator';
import { synchronizePcb } from '../kicad/PcbSynchronizer';
import { UuidManager } from '../kicad/UuidManager';
import { CircuitSnapshot, PcbExactRoute, PcbPosition } from '../synth/types';

const directories: string[] = [];
afterEach(() => {
    for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-persistent-'));
    directories.push(dir);
    const pretty = path.join(dir, 'Test.pretty');
    fs.mkdirSync(pretty);
    const footprint = path.join(pretty, 'Part.kicad_mod');
    fs.writeFileSync(
        footprint,
        `(footprint "Part" (version 20241229) (generator "test") (layer "F.Cu")
    (property "Reference" "REF**" (at 0 -2) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" thru_hole circle (at 0 0) (size 1.5 1.5) (drill 0.8) (layers "*.Cu" "*.Mask"))
    (pad "2" thru_hole circle (at 2 0) (size 1.5 1.5) (drill 0.8) (layers "*.Cu" "*.Mask")))`,
    );
    fs.writeFileSync(
        path.join(dir, 'fp-lib-table'),
        `(fp_lib_table (version 7) (lib (name "Test")(type "KiCad")(uri "${pretty}")(options "")(descr "")))`,
    );
    const uuids = new UuidManager();
    uuids.load(path.join(dir, 'uuids.json'));
    class Board extends Schematic {
        constructor(private x = 10) {
            super({
                name: 'Persistent',
                pcb: {
                    outline: [
                        { x: 0, y: 0 },
                        { x: 50, y: 0 },
                        { x: 50, y: 50 },
                        { x: 0, y: 50 },
                    ],
                },
            });
        }
        generate() {
            const net = new Net({ name: 'SIGNAL' });
            const r = new Component({
                ref: 'R1',
                symbol: 'Device:R',
                footprint: 'Test:Part',
                pcbPosition: { x: this.x, y: 10 },
            });
            r.pins[1].tie(net);
            r.pins[2].dnc();
        }
    }
    const render = (snapshot: CircuitSnapshot) =>
        new PcbGenerator(snapshot, uuids, dir).generate().content;
    return { dir, footprint, uuids, Board, render };
}

const manualUuid = '10000000-0000-0000-0000-000000000001';
function addManual(source: string): string {
    return source.replace(
        /\n\)\s*$/,
        `\n(segment (start 10 10) (end 20 10) (width 0.3) (layer "F.Cu") (net 1) (uuid "${manualUuid}"))\n)\n`,
    );
}

describe('persistent PCB routing', () => {
    it('captures actual tracks and reconnects moved pads without replacing their identity', () => {
        const { dir, Board, render } = fixture();
        const old = addManual(render(new Board()._generateWithCapture()));
        const saved = captureRouting(old, 'Persistent');
        expect(saved.routes[0].segments![0].start).toEqual({ ref: 'R1', pad: '1' });
        saveRoutingFile(path.join(dir, 'routing.json'), saved);
        const loaded = loadRoutingFile(new Board(12)._generateWithCapture(), dir);
        const updated = render(loaded);
        expect(updated).toContain('(start 12 10)');
        expect(updated).toContain('(end 20 10)');
        expect(updated).toContain(manualUuid);
        const synced = synchronizePcb(old, updated).content;
        expect(copperUuids(synced)).toEqual([manualUuid]);
        expect(synced).toContain('(start 12 10)');
        expect(fs.readFileSync(path.join(dir, 'routing.json'), 'utf-8')).toContain('"ref": "R1"');
    });

    it('refreshes footprint geometry and resolves saved routes against new pad centers', () => {
        const { dir, footprint, Board, render } = fixture();
        const snapshot = new Board()._generateWithCapture();
        const old = addManual(render(snapshot));
        saveRoutingFile(path.join(dir, 'routing.json'), captureRouting(old, 'Persistent'));
        fs.writeFileSync(
            footprint,
            fs.readFileSync(footprint, 'utf-8').replace('(at 0 0)', '(at 1 0)'),
        );
        const updated = render(loadRoutingFile(snapshot, dir));
        const synced = synchronizePcb(old, updated, { refreshFootprints: true }).content;
        expect(synced).toContain('(at 1 0 0)');
        expect(synced).toContain('(start 11 10)');
        expect(copperUuids(synced)).toEqual([manualUuid]);
    });

    it('captures back-side pad anchors without mirroring board-local pad geometry twice', () => {
        const { footprint, Board, render } = fixture();
        fs.writeFileSync(
            footprint,
            fs.readFileSync(footprint, 'utf-8').replace('(at 0 0)', '(at 1 0)'),
        );
        const snapshot = new Board()._generateWithCapture();
        snapshot.components.find((part) => part.ref === 'R1')!.pcbPosition!.side = 'back';
        const source = render(snapshot).replace(
            /\n\)\s*$/,
            `\n(segment (start 9 10) (end 20 10) (width 0.3) (layer "B.Cu") (net 1) (uuid "${manualUuid}"))\n)\n`,
        );
        expect(captureRouting(source, 'Persistent').routes[0].segments![0].start).toEqual({
            ref: 'R1',
            pad: '1',
        });
    });

    it('loads routing during rebuild, preserves the source file, and rejects other-board files', () => {
        const { dir, Board, render } = fixture();
        const snapshot = new Board()._generateWithCapture();
        const file = path.join(dir, 'routing.json');
        saveRoutingFile(file, captureRouting(addManual(render(snapshot)), 'Persistent'));
        const before = fs.readFileSync(file, 'utf-8');
        const result = new KicadGenerator([]).generate(snapshot, dir, {
            pcbMode: 'rebuild',
            validateWithKicad: false,
        });
        expect(result.success).toBe(true);
        expect(fs.readFileSync(path.join(dir, 'Persistent.kicad_pcb'), 'utf-8')).toContain(
            manualUuid,
        );
        expect(fs.readFileSync(file, 'utf-8')).toBe(before);
        expect(() => loadRoutingFile({ ...snapshot, name: 'Different' }, dir)).toThrow(
            /Invalid routing file/,
        );
        expect(() =>
            loadRoutingFile(
                { ...snapshot, pcb: { ...snapshot.pcb, routingFile: 'missing.json' } },
                dir,
            ),
        ).toThrow(/does not exist/);
    });

    it('backs up prior routing and captures arcs/vias while excluding source-owned copper', () => {
        const { dir, Board, render } = fixture();
        const source = addManual(render(new Board()._generateWithCapture())).replace(
            /\n\)\s*$/,
            `
      (arc (start 20 10) (mid 21 11) (end 22 10) (width 0.3) (layer "F.Cu") (net 1) (uuid "10000000-0000-0000-0000-000000000002"))
      (via (at 22 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "10000000-0000-0000-0000-000000000003"))
    )`,
        );
        const saved = captureRouting(source, 'Persistent', { excludeUuids: [manualUuid] });
        expect(saved.routes[0].segments).toBeUndefined();
        expect(saved.routes[0].arcs).toHaveLength(1);
        expect(saved.routes[0].vias).toHaveLength(1);
        const file = path.join(dir, 'routing.json');
        saveRoutingFile(file, saved);
        saveRoutingFile(file, saved);
        expect(
            fs.readdirSync(dir).filter((name) => name.startsWith('routing.json.backup-')),
        ).toHaveLength(1);
    });

    it('removes only formerly owned copper and remaps net codes during sync', () => {
        const { Board, render } = fixture();
        const source = render(new Board()._generateWithCapture());
        const old = addManual(source)
            .replace('(net 1 "SIGNAL")', '(net 7 "SIGNAL")')
            .replace(/\(net 1\)/g, '(net 7)');
        const snapshot = new Board()._generateWithCapture();
        snapshot.pcb!.exactRoutes = [
            {
                id: 'new',
                net: 'SIGNAL',
                segments: [{ start: { x: 1, y: 1 }, end: { x: 3, y: 1 }, layer: 'F.Cu' }],
            },
        ];
        const updated = render(snapshot);
        const kept = synchronizePcb(old, updated).content;
        expect(kept).toContain(manualUuid);
        expect(kept).toMatch(/\(segment[^]*?\(net 7\)/);
        const removed = synchronizePcb(old, updated, { ownedCopperUuids: [manualUuid] }).content;
        expect(removed).not.toContain(manualUuid);
        expect(copperUuids(removed)).toHaveLength(1);
    });

    it('keeps generated identities stable across synthesis and removes deleted saved copper', () => {
        const { dir, Board } = fixture();
        const first = new Board()._generateWithCapture();
        first.pcb!.exactRoutes = [
            {
                id: 'inline',
                net: 'SIGNAL',
                segments: [
                    { start: { ref: 'R1', pad: '1' }, end: { x: 20, y: 10 }, layer: 'F.Cu' },
                ],
            },
        ];
        const synth = (snapshot: CircuitSnapshot, pcbMode: 'sync' | 'rebuild') =>
            new KicadGenerator([]).generate(snapshot, dir, { pcbMode, validateWithKicad: false });
        synth(first, 'rebuild');
        const boardPath = path.join(dir, 'Persistent.kicad_pcb');
        const ids = copperUuids(fs.readFileSync(boardPath, 'utf-8'));
        synth(first, 'sync');
        expect(copperUuids(fs.readFileSync(boardPath, 'utf-8'))).toEqual(ids);
        const old = fs.readFileSync(boardPath, 'utf-8');
        fs.writeFileSync(
            boardPath,
            old.replace(
                /\n\)\s*$/,
                `\n(segment (start 1 1) (end 2 1) (width 0.3) (layer "F.Cu") (net 1) (uuid "${manualUuid}"))\n)\n`,
            ),
        );
        synth(new Board()._generateWithCapture(), 'sync');
        expect(copperUuids(fs.readFileSync(boardPath, 'utf-8'))).toEqual([manualUuid]);
    });

    it('rejects a physical component missing from full placement', () => {
        const { Board, render } = fixture();
        const snapshot = new Board()._generateWithCapture();
        snapshot.pcb!.requireAllPlaced = true;
        snapshot.pcb!.place = ['OTHER*'];
        expect(() => render(snapshot)).toThrow(/Full placement requires.*R1/);
    });
});

class Block extends RoutedComposable<'OUT'> {
    part!: Component;
    protected defineInterface() {
        this.part = new Component({
            ref: `${this.ref}R1`,
            symbol: 'Device:R',
            footprint: 'Test:Part',
            pcbPosition: { x: 2, y: 0, rotation: 30 },
        });
        const signal = new Net({ name: `${this.ref}_signal` });
        this.part.pins[1].tie(signal);
        this.part.pins[2].dnc();
        return { OUT: this.part.pins[1] };
    }
    protected defineRouting(): ModuleRouting<'OUT'> {
        return {
            routes: [
                {
                    id: 'out',
                    net: this.part.pins[1],
                    segments: [
                        {
                            start: { ref: this.part.ref, pad: '1' },
                            end: { x: 8, y: 0 },
                            layer: 'F.Cu',
                        },
                    ],
                },
            ],
            handoffs: { OUT: { at: { x: 8, y: 0 }, layer: 'F.Cu' } },
        };
    }
}

describe('placed and routed composables', () => {
    function moduleBoard(position: PcbPosition = { x: 10, y: 10, rotation: 90 }) {
        const context = fixture();
        class Modules extends Schematic {
            block!: Block;
            constructor() {
                super({
                    name: 'Modules',
                    pcb: {
                        outline: [
                            { x: 0, y: 0 },
                            { x: 50, y: 0 },
                            { x: 50, y: 50 },
                            { x: 0, y: 50 },
                        ],
                    },
                });
            }
            generate() {
                this.block = new Block({ ref: 'A', pcbPosition: position });
                new Net({ name: 'OUTPUT' }).tie(this.block.pins.OUT);
            }
        }
        const board = new Modules();
        const snapshot = board._generateWithCapture();
        return { ...context, board, snapshot };
    }

    it('rotates child placement, local copper and a named handoff together', () => {
        const { board, snapshot, render } = moduleBoard();
        expect(board.block.part.absolutePcbPosition).toEqual({
            x: 10,
            y: 8,
            rotation: 120,
            side: 'front',
        });
        expect(snapshot.pcb!.exactRoutes![0].net).toBe('OUTPUT');
        expect(snapshot.pcb!.handoffs![0]).toEqual({
            module: 'A',
            port: 'OUT',
            net: 'OUTPUT',
            at: { x: 10, y: 2 },
            layer: 'F.Cu',
        });
        snapshot.pcb!.exactRoutes!.push({
            id: 'external',
            net: 'OUTPUT',
            segments: [
                { start: { module: 'A', port: 'OUT' }, end: { x: 30, y: 2 }, layer: 'F.Cu' },
            ],
        });
        const content = render(snapshot);
        expect(content).toContain('(at 10 8 120)');
        expect(content).toContain('(start 10 2)');
        expect(content).toContain('(end 30 2)');
        expect(copperUuids(content)).toHaveLength(2);
    });

    it('captures external copper using a module handoff anchor that follows module movement', () => {
        const { snapshot, render } = moduleBoard();
        const declared = render(snapshot);
        const withExternal = declared.replace(
            /\n\)\s*$/,
            `\n(segment (start 10 2) (end 30 2) (width 0.3) (layer "F.Cu") (net 1) (uuid "${manualUuid}"))\n)\n`,
        );
        const captured = captureRouting(withExternal, 'Modules', {
            excludeUuids: copperUuids(declared),
            handoffs: snapshot.pcb!.handoffs,
        });
        expect(captured.routes[0].segments![0].start).toEqual({ module: 'A', port: 'OUT' });
        const moved = moduleBoard({ x: 20, y: 10, rotation: 90 });
        moved.snapshot.pcb!.exactRoutes!.push(...captured.routes);
        expect(moved.render(moved.snapshot)).toContain('(start 20 2)');
    });

    it('composes nested module rotations and local placements', () => {
        const { render } = fixture();
        class Outer extends RoutedComposable<'OUT'> {
            inner!: Block;
            protected defineInterface() {
                this.inner = new Block({
                    ref: `${this.ref}B`,
                    pcbPosition: { x: 5, y: 0, rotation: 90 },
                });
                return { OUT: this.inner.pins.OUT };
            }
            protected defineRouting(): ModuleRouting<'OUT'> {
                return { routes: [], handoffs: { OUT: { at: { x: 5, y: 8 }, layer: 'F.Cu' } } };
            }
        }
        class Board extends Schematic {
            outer!: Outer;
            constructor() {
                super({
                    name: 'Nested',
                    pcb: {
                        outline: [
                            { x: 0, y: 0 },
                            { x: 50, y: 0 },
                            { x: 50, y: 50 },
                            { x: 0, y: 50 },
                        ],
                    },
                });
            }
            generate() {
                this.outer = new Outer({ ref: 'A', pcbPosition: { x: 20, y: 20, rotation: 90 } });
                this.outer.pins;
            }
        }
        const board = new Board();
        const snapshot = board._generateWithCapture();
        expect(board.outer.inner.part.absolutePcbPosition).toEqual({
            x: 18,
            y: 15,
            rotation: 210,
            side: 'front',
        });
        expect(snapshot.pcb!.handoffs!.map((handoff) => handoff.at)).toEqual([
            { x: 28, y: 15 },
            { x: 12, y: 15 },
        ]);
        expect(render(snapshot)).toContain('(end 12 15)');
    });

    it('mirrors and flips module copper on the back side', () => {
        const { board, snapshot, render } = moduleBoard({
            x: 20,
            y: 20,
            rotation: 90,
            side: 'back',
        });
        expect(board.block.part.absolutePcbPosition).toEqual({
            x: 20,
            y: 22,
            rotation: 60,
            side: 'back',
        });
        expect(snapshot.pcb!.handoffs![0].at).toEqual({ x: 20, y: 28 });
        expect(snapshot.pcb!.exactRoutes![0].segments![0].layer).toBe('B.Cu');
        const content = render(snapshot);
        expect(content).toContain('(end 20 28)');
    });

    it('rejects unknown, wrong-net and wrong-layer handoffs', () => {
        const { snapshot, render } = moduleBoard();
        const external: PcbExactRoute = {
            id: 'external',
            net: 'OUTPUT',
            segments: [
                { start: { module: 'A', port: 'missing' }, end: { x: 30, y: 18 }, layer: 'F.Cu' },
            ],
        };
        snapshot.pcb!.exactRoutes!.push(external);
        expect(() => render(snapshot)).toThrow(/cannot resolve handoff/);
        external.segments![0].start = { module: 'A', port: 'OUT' };
        external.segments![0].layer = 'B.Cu';
        expect(() => render(snapshot)).toThrow(/requires layer/);
        external.segments![0].layer = 'F.Cu';
        snapshot.nets.push(new Net({ name: 'other' }));
        snapshot.pcb!.handoffs![0].net = 'other';
        expect(() => render(snapshot)).toThrow(/not on net/);
    });

    it('keeps schematic-only modules free of PCB copper', () => {
        class Board extends Schematic {
            constructor() {
                super({ name: 'OnlySchematic' });
            }
            generate() {
                new Block({ ref: 'A' });
            }
        }
        const snapshot = new Board()._generateWithCapture();
        expect(snapshot.components.map((part) => part.ref)).toContain('AR1');
        expect(snapshot.pcb).toBeUndefined();
    });

    it('gives repeated module instances distinct routes and handoffs after net merging', () => {
        const { render } = fixture();
        class Board extends Schematic {
            constructor() {
                super({
                    name: 'Repeated',
                    pcb: {
                        outline: [
                            { x: 0, y: 0 },
                            { x: 50, y: 0 },
                            { x: 50, y: 50 },
                            { x: 0, y: 50 },
                        ],
                    },
                });
            }
            generate() {
                const a = new Block({ ref: 'A', pcbPosition: { x: 10, y: 10 } });
                const b = new Block({ ref: 'B', pcbPosition: { x: 10, y: 20 } });
                const shared = new Net({ name: 'SHARED' });
                shared.tie(a.pins.OUT);
                shared.tie(b.pins.OUT);
            }
        }
        const snapshot = new Board()._generateWithCapture();
        expect(snapshot.pcb!.exactRoutes!.map((route) => route.id)).toEqual(['A/out', 'B/out']);
        expect(snapshot.pcb!.exactRoutes!.every((route) => route.net === 'SHARED')).toBe(true);
        expect(new Set(copperUuids(render(snapshot))).size).toBe(2);
    });
});
