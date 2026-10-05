import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Kicad3DModel } from '../synth/3d/Kicad3DModel';
import type { TriangleMesh } from '../synth/3d/types';
const triangle = (): TriangleMesh => ({
    vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 2.54, y: 0, z: 0 },
        { x: 0, y: 2.54, z: 0 },
    ],
    triangles: [[0, 1, 2]],
    name: 'fixture',
    color: { r: 1, g: 0, b: 0 },
});
describe('dimension-preserving triangle models', () => {
    it('exports millimetres in KiCad VRML units and rotates without mutating input', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-test-'));
        try {
            const mesh = triangle();
            const model = new Kicad3DModel({ rotZ: 90 }).mesh(mesh);
            mesh.vertices[1].x = 500;
            const result = await model.export({ outDir: dir, baseName: 'fixture' });
            const wrl = fs.readFileSync(result.wrlPath!, 'utf8');
            expect(wrl).toContain('0 1 0');
            expect(wrl).toContain('-1 0 0');
            expect(wrl).toContain('0,1,2,-1');
            expect(wrl).toContain('diffuseColor 1 0 0');
            expect(mesh.vertices[1].x).toBe(500);
            expect(() => model.oc).toThrow('OCC not initialized');
            await expect(
                model.export({ outDir: dir, baseName: 'bad', formats: ['wrl', 'step'] }),
            ).rejects.toThrow('STEP requires solid geometry');
            expect(fs.existsSync(path.join(dir, 'bad.wrl'))).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('rejects malformed coordinates and triangle indices', () => {
        const model = new Kicad3DModel();
        const invalid = triangle();
        invalid.vertices[0].x = NaN;
        expect(() => model.mesh(invalid)).toThrow();
        expect(() => model.mesh({ ...triangle(), triangles: [[0, 1, 3]] })).toThrow();
        expect(() => model.mesh({ ...triangle(), triangles: [[0, 1, 1.5]] })).toThrow();
        expect(() => model.mesh({ ...triangle(), triangles: [] })).toThrow();
    });
    it('retains both solid and indexed geometry in a mixed model', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-solid-'));
        try {
            const model = await new Kicad3DModel().init();
            model.box({ x: 1, y: 1, z: 1 }).name('solid_box');
            model.mesh(triangle());
            const result = await model.export({ outDir: dir, baseName: 'mixed' });
            const wrl = fs.readFileSync(result.wrlPath!, 'utf8');
            expect(wrl).toContain('# solid_box');
            expect(wrl).toContain('# fixture');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }, 30000);
});
