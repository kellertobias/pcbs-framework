import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { Component, Net, Schematic } from '../synth';
import { PcbGenerator } from '../kicad/PcbGenerator';
import { UuidManager } from '../kicad/UuidManager';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});

describe('PcbGenerator', () => {
    it('emits an outline and only explicitly positioned footprints', () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-board-'));
        temporaryDirectories.push(outputDir);
        const prettyDir = path.join(outputDir, 'Test.pretty');
        fs.mkdirSync(prettyDir);
        fs.writeFileSync(
            path.join(prettyDir, 'Part.kicad_mod'),
            `(footprint "Part"
\t(version 20241229)
\t(generator "test")
\t(layer "F.Cu")
\t(property "Reference" "REF**" (at 0 -2 0) (layer "F.SilkS") (uuid "00000000-0000-0000-0000-000000000001") (effects (font (size 1 1) (thickness 0.15))))
\t(property "Value" "Part" (at 0 2 0) (layer "F.Fab") (uuid "00000000-0000-0000-0000-000000000002") (effects (font (size 1 1) (thickness 0.15))))
\t(attr smd)
\t(model "fixture.wrl" (offset (xyz 1 2 3)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 30)))
\t(pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (uuid "00000000-0000-0000-0000-000000000003"))
\t(pad "2" smd rect (at 2 0 270) (size 2 1) (layers "F.Cu" "F.Paste" "F.Mask") (uuid "00000000-0000-0000-0000-000000000004"))
)\n`,
        );
        fs.writeFileSync(
            path.join(outputDir, 'fp-lib-table'),
            `(fp_lib_table (version 7) (lib (name "Test")(type "KiCad")(uri "${prettyDir}")(options "")(descr "")))`,
        );

        class Board extends Schematic {
            generate() {
                new Component({
                    symbol: 'Device:R',
                    ref: 'R1',
                    footprint: 'Test:Part',
                    pcbPosition: { x: 20, y: 30, rotation: 90, side: 'back' },
                });
                new Component({ symbol: 'Device:R', ref: 'R2', footprint: 'Test:Part' });
            }
        }
        const board = new Board({
            name: 'Partial',
            pcb: {
                outline: [
                    { x: 10, y: 10 },
                    { x: 50, y: 10 },
                    { x: 50, y: 40 },
                    { x: 10, y: 40 },
                ],
                place: ['R1'],
            },
        });
        const uuids = new UuidManager();
        uuids.load(path.join(outputDir, 'uuids.json'));
        const generator = new PcbGenerator(board._generateWithCapture(), uuids, outputDir);
        const result = generator.generate();
        const repeated = generator.generate();

        expect(repeated.content).toBe(result.content);
        expect(result.placed).toBe(1);
        expect(result.content).toContain('(property "Reference" "R1"');
        expect(result.content).not.toContain('(property "Reference" "R2"');
        expect(result.content).toContain('(version 20260206)');
        expect(result.content).toContain('(generator_version "10.0")');
        expect(result.content).toContain('(layer "B.Cu")');
        expect(result.content).toContain('(at 20 30 90)');
        expect(result.content).toMatch(/\(pad "1" smd rect\s+\(at 0 0 90\)/);
        expect(result.content).toMatch(/\(pad "2" smd rect\s+\(at -2 0 180\)/);
        expect(result.content).toContain('(justify mirror)');
        expect(result.content).toContain('(xyz -1 -2 3)');
        expect(result.content).toContain('(xyz 0 0 210)');
        expect(result.content.match(/\(gr_line/g)).toHaveLength(4);
        expect(result.content).toContain('(path "/');
    });

    it('emits PCB nets and assigns connected footprint pads', () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-board-net-'));
        temporaryDirectories.push(outputDir);
        const prettyDir = path.join(outputDir, 'Test.pretty');
        fs.mkdirSync(prettyDir);
        fs.writeFileSync(
            path.join(prettyDir, 'Part.kicad_mod'),
            `(footprint "Part"
\t(version 20241229)
\t(generator "test")
\t(layer "F.Cu")
\t(property "Reference" "REF**" (at 0 -2 0) (layer "F.SilkS") (uuid "00000000-0000-0000-0000-000000000001") (effects (font (size 1 1) (thickness 0.15))))
\t(property "Value" "Part" (at 0 2 0) (layer "F.Fab") (uuid "00000000-0000-0000-0000-000000000002") (effects (font (size 1 1) (thickness 0.15))))
\t(attr smd)
\t(pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (uuid "00000000-0000-0000-0000-000000000003"))
\t(pad "2" smd rect
\t\t(at 2 0)
\t\t(size 1 1)
\t\t(layers "F.Cu" "F.Paste" "F.Mask")
\t\t(uuid "00000000-0000-0000-0000-000000000004")
\t)
)\n`,
        );
        fs.writeFileSync(
            path.join(outputDir, 'fp-lib-table'),
            `(fp_lib_table (version 7) (lib (name "Test")(type "KiCad")(uri "${prettyDir}")(options "")(descr "")))`,
        );

        class Board extends Schematic {
            generate() {
                const signal = new Net({ name: 'SIGNAL_A' });
                const ground = new Net({ name: 'GND', class: 'Power' });
                const part = new Component({
                    symbol: 'Device:R',
                    ref: 'R1',
                    footprint: 'Test:Part',
                    pcbPosition: { x: 20, y: 30 },
                });
                part.pins[1].tie(signal);
                part.pins[2].tie(ground);
            }
        }
        const board = new Board({
            name: 'Nets',
            pcb: {
                outline: [
                    { x: 0, y: 0 },
                    { x: 40, y: 0 },
                    { x: 40, y: 40 },
                    { x: 0, y: 40 },
                ],
            },
        });
        const uuids = new UuidManager();
        uuids.load(path.join(outputDir, 'uuids.json'));
        const result = new PcbGenerator(board._generateWithCapture(), uuids, outputDir).generate();

        expect(result.content).toContain('(net 1 "GND")');
        expect(result.content).toContain('(net 2 "SIGNAL_A")');
        expect(result.content).toMatch(/\(pad "1"[\s\S]*?\(net 2 "SIGNAL_A"\)[\s\S]*?\)/);
        expect(result.content).toMatch(/\(pad "2"[\s\S]*?\(net 1 "GND"\)[\s\S]*?\)/);
    });
});
