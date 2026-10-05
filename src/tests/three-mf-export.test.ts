import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { expect, it } from 'vitest';
import { Kicad3DModel } from '../synth/3d/Kicad3DModel';

it('exports named, colored objects in millimetres with mesh rotation and exact topology', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'three-mf-test-'));
    try {
        const model = new Kicad3DModel({ rotZ: 90 });
        for (const name of ['PCB & SSD <1>', 'Pi']) {
            model.mesh({
                name,
                color: { r: 0, g: 0.5, b: 1, a: 0.5 },
                vertices: [
                    { x: 0, y: 0, z: 2 },
                    { x: 25.4, y: 0, z: 2 },
                    { x: 0, y: 10, z: 2 },
                ],
                triangles: [[0, 1, 2]],
            });
        }
        const result = await model.export({
            outDir: dir,
            baseName: 'display',
            formats: ['3mf'],
        });
        const archive = unzipSync(fs.readFileSync(result.threeMfPath!));
        expect(Object.keys(archive).sort()).toEqual([
            '3D/3dmodel.model',
            '[Content_Types].xml',
            '_rels/.rels',
        ]);
        expect(strFromU8(archive['_rels/.rels'])).toContain('Target="/3D/3dmodel.model"');
        expect(strFromU8(archive['[Content_Types].xml'])).toContain(
            'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
        );
        const xml = strFromU8(archive['3D/3dmodel.model']);
        expect(xml).toContain('unit="millimeter"');
        expect(xml).toContain('name="PCB &amp; SSD &lt;1&gt;"');
        expect(xml).toContain('displaycolor="#0080FF80"');
        expect([...xml.matchAll(/<object /g)]).toHaveLength(2);
        expect([...xml.matchAll(/<item objectid=/g)]).toHaveLength(2);
        expect([...xml.matchAll(/<triangle v1="0" v2="1" v3="2"/g)]).toHaveLength(2);
        const vertices = [...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map(
            (match) => match.slice(1).map(Number),
        );
        expect(vertices[1][0]).toBeCloseTo(0, 10);
        expect(vertices[1][1]).toBeCloseTo(25.4, 10);
        expect(vertices[1][2]).toBe(2);
        expect(result.wrlPath).toBeUndefined();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

it('tessellates colored solids and rejects empty exports', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'three-mf-solid-'));
    try {
        await expect(
            new Kicad3DModel().export({
                outDir: dir,
                baseName: 'empty',
                formats: ['3mf'],
            }),
        ).rejects.toThrow('at least one');
        const model = await new Kicad3DModel().init();
        model.box({ x: 10, y: 20, z: 3 }).name('Box').color('#123456');
        const result = await model.export({
            outDir: dir,
            baseName: 'box',
            formats: ['3mf'],
        });
        const xml = strFromU8(unzipSync(fs.readFileSync(result.threeMfPath!))['3D/3dmodel.model']);
        expect(xml).toContain('name="Box"');
        expect(xml).toContain('displaycolor="#123456FF"');
        expect([...xml.matchAll(/<triangle /g)].length).toBeGreaterThanOrEqual(12);
        const vertices = [...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map(
            (match) => match.slice(1).map(Number),
        );
        for (const [axis, size] of [10, 20, 3].entries()) {
            expect(
                Math.max(...vertices.map((v) => v[axis])) -
                    Math.min(...vertices.map((v) => v[axis])),
            ).toBe(size);
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}, 30000);
