import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { Kicad3DModel } from '../synth/3d/Kicad3DModel';

it('exports STL vertices in millimetres with winding-derived normals', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stl-test-'));
    try {
        const model = new Kicad3DModel().mesh({
            vertices: [
                { x: 0, y: 0, z: 0 },
                { x: 25.4, y: 0, z: 0 },
                { x: 0, y: 10, z: 0 },
            ],
            triangles: [
                [0, 1, 2],
                [0, 0, 1],
            ],
        });
        const result = await model.export({ outDir: dir, baseName: 'part', formats: ['stl'] });
        const file = fs.readFileSync(result.stlPath!);
        expect(file.length).toBe(134);
        expect(file.readUInt32LE(80)).toBe(1);
        expect(file.readFloatLE(92)).toBe(1);
        expect(file.readFloatLE(108)).toBeCloseTo(25.4, 5);
        expect(file.readFloatLE(124)).toBe(10);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
it('exports a solid as a closed millimetre mesh', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stl-solid-'));
    try {
        const model = await new Kicad3DModel().init();
        model.box({ x: 10, y: 20, z: 3 });
        const result = await model.export({ outDir: dir, baseName: 'box', formats: ['stl'] });
        const file = fs.readFileSync(result.stlPath!);
        const count = file.readUInt32LE(80);
        expect(file.length).toBe(84 + 50 * count);
        const points: number[][] = [];
        const edges = new Map<string, number>();
        for (let i = 0; i < count; i++) {
            const triangle = [0, 1, 2].map((j) =>
                [0, 1, 2].map((k) => file.readFloatLE(84 + i * 50 + 12 + j * 12 + k * 4)),
            );
            points.push(...triangle);
            for (let j = 0; j < 3; j++) {
                const key = [triangle[j].join(','), triangle[(j + 1) % 3].join(',')]
                    .sort()
                    .join('|');
                edges.set(key, (edges.get(key) ?? 0) + 1);
            }
        }
        expect([...edges.values()].every((n) => n === 2)).toBe(true);
        for (const [axis, size] of [10, 20, 3].entries())
            expect(
                Math.max(...points.map((p) => p[axis])) - Math.min(...points.map((p) => p[axis])),
            ).toBe(size);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}, 30000);
