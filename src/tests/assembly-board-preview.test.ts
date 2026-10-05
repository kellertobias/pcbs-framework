import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { Component, Schematic, Module, KicadFootprint } from '../synth';
import { prepareBoardPreview, preferSavedBoard } from '../assembly/board-preview';

it('regenerates source placements in temporary assets without changing saved PCB or UUIDs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-source-'));
    try {
        fs.mkdirSync(path.join(dir, 'Test.pretty'));
        fs.writeFileSync(
            path.join(dir, 'Test.pretty', 'Part.kicad_mod'),
            '(footprint "Part" (layer "F.Cu") (property "Reference" "REF**" (at 0 0) (layer "F.SilkS") (effects (font (size 1 1)(thickness .15)))) (pad "1" thru_hole circle (at 0 0)(size 1.5 1.5)(drill .8)(layers "*.Cu" "*.Mask")))',
        );
        fs.writeFileSync(
            path.join(dir, 'fp-lib-table'),
            `(fp_lib_table (lib (name "Test")(type "KiCad")(uri "${path.join(dir, 'Test.pretty')}")))`,
        );
        const saved = path.join(dir, 'Source.kicad_pcb');
        fs.writeFileSync(saved, 'original native board');
        const uuids = path.join(dir, 'uuids.json');
        fs.writeFileSync(uuids, '{}');
        class Board extends Schematic {
            constructor(private x: number) {
                super({
                    name: 'Source',
                    pcb: {
                        outline: [
                            { x: 0, y: 0 },
                            { x: 40, y: 0 },
                            { x: 40, y: 40 },
                            { x: 0, y: 40 },
                        ],
                    },
                });
            }
            generate() {
                new Component({
                    ref: 'J1',
                    symbol: 'Connector:Conn_01x01_Pin',
                    footprint: 'Test:Part',
                    pcbPosition: { x: this.x, y: 10 },
                }).pins[1].dnc();
            }
        }
        const first = await prepareBoardPreview(
            { kind: 'board', id: 'board', schematic: new Board(10), sourceDirectory: dir },
            dir,
            saved,
            path.join(dir, 'one'),
        );
        const second = await prepareBoardPreview(
            { kind: 'board', id: 'board', schematic: new Board(22), sourceDirectory: dir },
            dir,
            saved,
            path.join(dir, 'two'),
        );
        expect(fs.readFileSync(first, 'utf8')).toContain('(at 10 10');
        expect(fs.readFileSync(second, 'utf8')).toContain('(at 22 10');
        // Exercise both source-driven and native saves using the same board declaration.
        const entry = path.join(dir, 'board.js');
        fs.writeFileSync(entry, 'module.exports = {};');
        const now = Date.now() / 1000;
        fs.utimesSync(saved, now - 10, now - 10);
        fs.utimesSync(entry, now, now);
        expect(preferSavedBoard(entry, saved)).toBe(false);
        fs.utimesSync(saved, now + 10, now + 10);
        expect(preferSavedBoard(entry, saved)).toBe(true);
        fs.utimesSync(entry, now + 20, now + 20);
        expect(preferSavedBoard(entry, saved)).toBe(false);
        expect(fs.readFileSync(saved, 'utf8')).toBe('original native board');
        expect(fs.readFileSync(uuids, 'utf8')).toBe('{}');
        expect(
            await prepareBoardPreview(
                { kind: 'board', id: 'native', file: saved },
                dir,
                saved,
                path.join(dir, 'native'),
            ),
        ).toBe(saved);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

it('regenerates module models and retains their footprint mounting transform', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-module-'));
    let revision = 1;
    class Device extends Module {
        constructor() {
            super({
                ref: 'M1',
                symbol: 'Device:R',
                footprint: 'Test:Device',
                pcbPosition: { x: 10, y: 10 },
                pins: (pin) => ({ 1: pin(1) }),
            });
            this.pins[1].dnc();
        }
        static makeFootprint() {
            return new KicadFootprint({ name: 'Device' }).set3DModel({
                path: 'old.wrl',
                offset: { x: 1, y: 2, z: 7 },
                scale: { x: 1, y: 1, z: 1 },
                rotate: { x: 0, y: 0, z: 90 },
            });
        }
        static make3DModel() {
            return {
                export: async ({ outDir, baseName }: { outDir: string; baseName: string }) => {
                    fs.mkdirSync(outDir, { recursive: true });
                    const wrlPath = path.join(outDir, baseName + '.wrl');
                    fs.writeFileSync(wrlPath, 'model revision ' + revision);
                    return { wrlPath };
                },
            } as never;
        }
    }
    class Board extends Schematic {
        constructor() {
            super({
                name: 'Source',
                pcb: {
                    outline: [
                        { x: 0, y: 0 },
                        { x: 30, y: 0 },
                        { x: 30, y: 30 },
                        { x: 0, y: 30 },
                    ],
                },
            });
        }
        generate() {
            new Device();
        }
    }
    try {
        const saved = path.join(dir, 'Source.kicad_pcb');
        fs.writeFileSync(saved, 'saved');
        const part = {
            kind: 'board' as const,
            id: 'device',
            schematic: new Board(),
            sourceDirectory: dir,
        };
        for (revision of [1, 2]) {
            const output = path.join(dir, String(revision));
            const preview = await prepareBoardPreview(part, dir, saved, output);
            const content = fs.readFileSync(preview, 'utf8');
            expect(content).toContain('(offset (xyz 1 2 7))');
            expect(content).toContain('(rotate (xyz 0 0 90))');
            expect(fs.readFileSync(path.join(output, 'models', 'Device.wrl'), 'utf8')).toBe(
                'model revision ' + revision,
            );
        }
        expect(fs.readFileSync(saved, 'utf8')).toBe('saved');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
