import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportVerticalFrontPanel } from '../frontpanel/FrontPanelExporter';
import type { FrontPanelEdge, VerticalFrontPanelInterface } from '../frontpanel/types';
import { KicadFootprint } from '../synth/KicadFootprint';
import { Component, Schematic } from '../synth';
import { PcbGenerator } from '../kicad/PcbGenerator';
import { UuidManager } from '../kicad/UuidManager';

const directories: string[] = [];
afterEach(() =>
    directories.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })),
);

const face: VerticalFrontPanelInterface = {
    facing: 'top',
    anchor: { x: 2, y: -4, z: 15 },
    cutouts: [
        { type: 'circle', diameter: 20 },
        { type: 'circle', x: -12, y: 8, diameter: 3 },
        { type: 'circle', x: 12, y: -8, diameter: 3 },
    ],
    labelAnchor: { x: 0, y: 13, fontSize: 2 },
};

function board(rotation = 0, metadata: VerticalFrontPanelInterface = face, layer = 'F.Cu'): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-vertical-panel-'));
    directories.push(dir);
    const file = path.join(dir, 'Board.kicad_pcb');
    const quoted = (value: string) => JSON.stringify(value);
    fs.writeFileSync(
        file,
        `(kicad_pcb
    (gr_rect (start 100 200) (end 200 280) (layer "Edge.Cuts"))
    (footprint "Test:XLR" (layer "${layer}") (at 140 240 ${rotation})
      (property "Reference" "J1")
      (property "FrontPanelText" "DMX")
      (property "VerticalFrontPanelInterface" ${quoted(JSON.stringify(metadata))}))
    (footprint "Test:Unselected" (layer "F.Cu") (at 110 205)
      (property "Reference" "J2")
      (property "VerticalFrontPanelInterface" "bad json")))`,
    );
    return file;
}

function circles(file: string): number[][] {
    return fs
        .readFileSync(file, 'utf8')
        .split('0\nCIRCLE\n')
        .slice(1)
        .map((entity) => {
            const lines = entity.split('\n');
            const value = (code: string) => Number(lines[lines.indexOf(code) + 1]);
            return [value('10'), value('20'), value('40')];
        });
}

describe('vertical front-panel export', () => {
    it('carries library interfaces and instance overrides through PCB synthesis', () => {
        const file = board();
        const dir = path.dirname(file),
            pretty = path.join(dir, 'Test.pretty');
        fs.mkdirSync(pretty);
        fs.writeFileSync(
            path.join(pretty, 'XLR.kicad_mod'),
            new KicadFootprint({ name: 'XLR' }).setVerticalFrontPanelInterface(face).serialize(),
        );
        fs.writeFileSync(
            path.join(dir, 'fp-lib-table'),
            `(fp_lib_table (version 7) (lib (name "Test") (type "KiCad") (uri "${pretty}")))`,
        );
        class Board extends Schematic {
            generate() {
                new Component({
                    symbol: 'Device:R',
                    footprint: 'Test:XLR',
                    ref: 'J1',
                    pcbPosition: { x: 30, y: 30 },
                });
                new Component({
                    symbol: 'Device:R',
                    footprint: 'Test:XLR',
                    ref: 'J2',
                    pcbPosition: { x: 70, y: 30 },
                    verticalFrontPanelInterface: { ...face, anchor: { ...face.anchor, z: 20 } },
                });
            }
        }
        const schematic = new Board({
            name: 'Board',
            pcb: {
                outline: [
                    { x: 0, y: 0 },
                    { x: 100, y: 0 },
                    { x: 100, y: 80 },
                    { x: 0, y: 80 },
                ],
            },
        });
        const uuids = new UuidManager();
        uuids.load(path.join(dir, 'uuids.json'));
        fs.writeFileSync(
            file,
            new PcbGenerator(schematic._generateWithCapture(), uuids, dir).generate().content,
        );
        const result = exportVerticalFrontPanel(file, {
            edge: 'top',
            components: ['J1', 'J2'],
            height: 40,
        });
        expect(result.cutouts).toBe(6);
        expect(circles(result.dxfFile)[0]).toEqual([32, 15, 10]);
        expect(circles(result.dxfFile)[3]).toEqual([72, 20, 10]);
    });

    it('serializes a vertical interface without drawing it as a PCB-plane opening', () => {
        const serialized = new KicadFootprint({ name: 'XLR' })
            .setVerticalFrontPanelInterface(face)
            .serialize();
        expect(serialized).toContain('VerticalFrontPanelInterface');
        expect(serialized).not.toContain('FrontPanelCutouts');
        expect(serialized).not.toContain('fp_circle');
    });

    it('projects only the selected inward component, relative to the PCB top-left and surface', () => {
        const result = exportVerticalFrontPanel(board(), {
            edge: 'top',
            components: ['J1'],
            height: 40,
            bottomZ: -5,
        });
        expect(result).toMatchObject({ cutouts: 3, labels: 1, components: ['J1'] });
        expect(circles(result.dxfFile)).toEqual([
            [42, 20, 10],
            [30, 28, 1.5],
            [54, 12, 1.5],
        ]);
        expect(fs.readFileSync(result.dxfFile, 'utf8')).toContain('$INSUNITS\n70\n4');
        expect(fs.readFileSync(result.svgFile, 'utf8')).toContain('cx="30" cy="12"');
        expect(fs.readFileSync(result.svgFile, 'utf8')).toContain('>DMX</text>');
    });

    it.each([
        ['top', 0, 42, 30, 54],
        ['right', 270, 42, 30, 54],
        ['bottom', 180, 38, 50, 26],
        ['left', 90, 38, 50, 26],
    ] as Array<[FrontPanelEdge, number, number, number, number]>)(
        'uses saved KiCad rotation for the %s edge',
        (edge, rotation, center, screw1, screw2) => {
            const result = exportVerticalFrontPanel(board(rotation), {
                edge,
                components: ['J1'],
                height: 40,
            });
            const actual = circles(result.dxfFile);
            [center, screw1, screw2].forEach((x, index) => expect(actual[index][0]).toBeCloseTo(x));
            expect(actual.map((p) => p[1])).toEqual([15, 23, 7]);
        },
    );

    it('rejects unknown, repeated, undefined, mismatched, and back-side selections', () => {
        const file = board();
        const options = { edge: 'top' as const, components: ['J1'], height: 40 };
        expect(() =>
            exportVerticalFrontPanel(file, { ...options, components: ['missing'] }),
        ).toThrow('found 0');
        expect(() =>
            exportVerticalFrontPanel(file, { ...options, components: ['J1', 'J1'] }),
        ).toThrow('unique');
        expect(() => exportVerticalFrontPanel(file, { ...options, components: [] })).toThrow(
            'Select',
        );
        expect(() => exportVerticalFrontPanel(file, { ...options, components: ['J2'] })).toThrow(
            'Invalid J2',
        );
        expect(() => exportVerticalFrontPanel(file, { ...options, edge: 'right' })).toThrow(
            'does not face',
        );
        expect(() => exportVerticalFrontPanel(board(0, face, 'B.Cu'), options)).toThrow(
            'front-side',
        );
        expect(() =>
            exportVerticalFrontPanel(
                board(0, { ...face, cutouts: [{ type: 'circle', diameter: -1 }] }),
                options,
            ),
        ).toThrow('positive');
        expect(() => exportVerticalFrontPanel(file, { ...options, height: 5 })).toThrow(
            'outside the plate',
        );
        expect(fs.existsSync(path.join(path.dirname(file), 'front-panel'))).toBe(false);
    });

    it('retains rectangular and polygon openings and rotates them in the face plane', () => {
        const result = exportVerticalFrontPanel(
            board(0, {
                ...face,
                cutouts: [
                    { type: 'roundedRect', width: 8, height: 4, rotation: 90 },
                    {
                        type: 'polygon',
                        points: [
                            { x: 0, y: 0 },
                            { x: 2, y: 0 },
                            { x: 0, y: 3 },
                        ],
                    },
                ],
            }),
            { edge: 'top', components: ['J1'], height: 40 },
        );
        const svg = fs.readFileSync(result.svgFile, 'utf8');
        expect(svg).toContain('44,29 44,21 40,21 40,29');
        expect(svg).toContain('42,25 44,25 42,22');
    });
});
