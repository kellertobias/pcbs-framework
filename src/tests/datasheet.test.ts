import { describe, it, expect } from 'vitest';
import { inflateSync } from 'zlib';
import { renderFootprint, cropPng } from '../datasheet/FootprintRenderer';
import { renderModel } from '../datasheet/ModelRenderer';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exportDatasheet, datasheetRows } from '../datasheet/Datasheet';
const fp =
    '(footprint "Test" (fp_rect (start -3 -4) (end 3 4) (stroke (width .1)) (layer "F.Fab")) (pad "1" thru_hole oval (at 1 2 90) (size 2 4) (drill oval 1 2 (offset .2 .3)) (layers "*.Cu" "*.Mask")))';
describe('component datasheet rendering', () => {
    it('renders pads, oval drills and bottom-view mirroring without KiCad', () => {
        const top = renderFootprint(fp),
            bottom = renderFootprint(fp, { side: 'bottom' });
        expect(top.svg).toContain('translate(1 2) rotate(-90)');
        expect(bottom.svg).toContain('translate(1 -2) rotate(90)');
        expect(top.svg).toContain('cx="0.2" cy="0.3" rx="0.5" ry="1"');
        expect(top.png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        expect(top.pads).toEqual([{ number: '1', x: 1, y: 2, drill: { x: 1, y: 2 } }]);
        expect(renderFootprint(fp, { side: 'bottom', labels: false }).bounds.minY).toBe(
            -renderFootprint(fp, { labels: false }).bounds.maxY,
        );
        expect(top.body.lastIndexOf('<text')).toBeGreaterThan(top.body.lastIndexOf('<ellipse'));
    });
    it('crops illustrations and writes footers on existing PDF pages', async () => {
        const png = renderFootprint(fp).png,
            crop = cropPng(png, { x: 0, y: 0, width: 100, height: 100 });
        expect(crop.readUInt32BE(16)).toBe(100);
        expect(crop.readUInt32BE(20)).toBe(100);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-datasheet-'));
        try {
            const file = path.join(dir, 'test.pdf');
            await exportDatasheet({
                title: 'Test',
                output: file,
                footprints: [{ name: 'test', footprint: fp }],
            });
            expect(
                fs
                    .readFileSync(file)
                    .toString('latin1')
                    .match(/\/Type \/Page\b/g),
            ).toHaveLength(3);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('uses depth rather than draw order to hide rear model faces', () => {
        const face = (z: number, c: string) =>
            `Shape { appearance Appearance { material Material { diffuseColor ${c} } } geometry IndexedFaceSet { coord Coordinate { point [0 0 ${z},1 0 ${z},0 1 ${z}] } coordIndex [0,1,2,-1] } }`;
        const r = renderModel(face(1, '0 0 1') + face(0, '1 0 0'), {
            view: 'top',
            width: 300,
            height: 300,
        });
        const png = Buffer.from(/base64,([^"]+)/.exec(r.svg)![1], 'base64');
        let pos = 8;
        const chunks: Buffer[] = [];
        while (pos < png.length) {
            const len = png.readUInt32BE(pos),
                type = png.subarray(pos + 4, pos + 8).toString();
            if (type === 'IDAT') chunks.push(png.subarray(pos + 8, pos + 8 + len));
            pos += 12 + len;
        }
        const raw = inflateSync(Buffer.concat(chunks)),
            pixel = raw.subarray(
                140 * (300 * 3 + 1) + 1 + 120 * 3,
                140 * (300 * 3 + 1) + 1 + 120 * 3 + 3,
            );
        expect(pixel[0]).toBe(0);
        expect(pixel[2]).toBeGreaterThan(100);
        expect(r.bounds.max[2]).toBeCloseTo(2.54);
    });
    it('rejects unsupported model transforms and overlays on other views', () => {
        expect(() => renderModel('Transform { }')).toThrow('unsupported');
        expect(() =>
            renderFootprint('(footprint x (pad 1 smd custom (at 0 0) (size 2 2) (layers F.Cu)))'),
        ).toThrow('Unsupported pad shape');
        expect(() => renderFootprint('(symbol "x")')).toThrow('footprint');
    });
    it('preserves all electrical metadata and does not guess units', () => {
        expect(
            datasheetRows({ motor: { voltage: [6, 11], currentMa: 800 }, note: 'estimate' }),
        ).toEqual([
            { parameter: 'motor.voltage', value: '6, 11' },
            { parameter: 'motor.currentMa', value: '800' },
            { parameter: 'note', value: 'estimate' },
        ]);
    });
});

import { KicadFootprint } from '../synth/KicadFootprint';
import { KicadLibrary } from '../synth/KicadLibrary';
import { exportLibraryDatasheets } from '../datasheet/LibraryDatasheets';
describe('automatic library datasheets', () => {
    it('exports every variant, mechanical-only geometry and component ratings', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-library-pdfs-'));
        try {
            const lib = new KicadLibrary();
            lib.addFootprint(
                new KicadFootprint({ name: 'Mechanical' }).addRect({
                    x1: 0,
                    y1: 0,
                    x2: 10,
                    y2: 5,
                    layer: 'Cmts.User',
                }),
            );
            lib.addFootprint(
                new KicadFootprint({ name: 'ElectricalVariant' })
                    .addPad({
                        number: 'A',
                        type: 'thru_hole',
                        shape: 'circle',
                        x: 0,
                        y: 0,
                        width: 2,
                        height: 2,
                        drill: 1,
                    })
                    .setDatasheet({
                        electricalDetails: [
                            { parameter: 'Voltage', value: '6-11 V', source: 'Manufacturer' },
                        ],
                    }),
            );
            const results = await lib.writeDatasheets(dir);
            expect(results.map((r) => r.name)).toEqual(['Mechanical', 'ElectricalVariant']);
            expect(
                JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).failures,
            ).toEqual([]);
            expect(
                JSON.parse(fs.readFileSync(path.join(dir, 'ElectricalVariant.json'), 'utf8'))
                    .electricalDetails[0].value,
            ).toBe('6-11 V');
            for (const result of results)
                expect(fs.readFileSync(result.pdf).subarray(0, 5).toString()).toBe('%PDF-');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('attempts all footprints and reports errors instead of skipping them', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-library-errors-'));
        try {
            await expect(
                exportLibraryDatasheets(
                    [
                        {
                            name: 'Broken',
                            footprint:
                                '(footprint Broken (pad 1 smd custom (at 0 0) (size 2 2) (layers F.Cu)))',
                        },
                        { name: 'Good', footprint: fp },
                    ],
                    dir,
                ),
            ).rejects.toThrow('Broken: Unsupported pad shape');
            const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
            expect(index.footprints.map((f: any) => f.name)).toEqual(['Good']);
            expect(index.failures).toHaveLength(1);
            await expect(
                exportLibraryDatasheets([{ name: '../escape', footprint: fp }], dir),
            ).rejects.toThrow('Unsafe footprint name');
            await expect(
                exportLibraryDatasheets(
                    [
                        { name: 'x', footprint: fp },
                        { name: 'x', footprint: fp },
                    ],
                    dir,
                ),
            ).rejects.toThrow('Duplicate');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
