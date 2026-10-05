import { measureAssemblyPoints } from '../assembly/measurement';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { Assembly } from '../synth/Assembly';
import { Kicad3DModel } from '../synth/3d/Kicad3DModel';
import { prepareAssembly } from '../assembly/prepare';
import { resolveViewerAsset } from '../assembly/server';
import { threeMFMillimetreScale } from '../assembly/model-units';

function temp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-test-'));
}
describe('independent physical assemblies', () => {
    it('rejects duplicate identities, invalid transforms and ambiguous board sources', () => {
        const assembly = new Assembly({ name: 'bench' });
        assembly.addModel({ id: 'case', file: 'case.stl' });
        expect(() => assembly.addModel({ id: 'case', file: 'other.stl' })).toThrow('duplicate');
        expect(() => assembly.addModel({ id: '../case', file: 'case.stl' })).toThrow();
        expect(() =>
            assembly.addModel({ id: 'bad', file: 'case.stl', position: [0, NaN, 0] }),
        ).toThrow();
        expect(() => assembly.addBoard({ id: 'board' })).toThrow();
        expect(() => assembly.addBoard({ id: 'board', schematic: {} as never })).toThrow();
    });
    it('preflights all file inputs before invoking the native exporter', async () => {
        const dir = temp();
        try {
            fs.writeFileSync(path.join(dir, 'board.kicad_pcb'), 'pcb');
            const assembly = new Assembly({ name: 'bench' })
                .addBoard({ id: 'board', file: 'board.kicad_pcb' })
                .addModel({ id: 'missing', file: 'missing.stl' });
            const exporter = vi.fn();
            await expect(
                prepareAssembly(assembly, dir, path.join(dir, 'out'), exporter),
            ).rejects.toThrow('Model missing');
            expect(exporter).not.toHaveBeenCalled();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('retains board identity/origin, generated geometry, unit metadata and placements', async () => {
        const dir = temp();
        try {
            fs.writeFileSync(path.join(dir, 'board.kicad_pcb'), 'untouched pcb');
            fs.writeFileSync(path.join(dir, 'board.kicad_sch'), 'schematic');
            fs.writeFileSync(path.join(dir, 'case.stl'), 'solid test');
            const model = new Kicad3DModel().mesh({
                vertices: [
                    { x: 0, y: 0, z: 0 },
                    { x: 1, y: 0, z: 0 },
                    { x: 0, y: 1, z: 0 },
                ],
                triangles: [[0, 1, 2]],
            });
            const assembly = new Assembly({ name: 'bench' })
                .addBoard({
                    id: 'board',
                    file: 'board.kicad_sch',
                    origin: [10, 20],
                    position: [1, 2, 3],
                    rotation: [0, 180, 0],
                })
                .addGenerated({ id: 'mount', model: async () => model })
                .addModel({ id: 'case', file: 'case.stl', visible: false });
            const exporter = vi.fn(async (_source, target) => {
                fs.writeFileSync(target, '#VRML V2.0 utf8');
            });
            const manifest = await prepareAssembly(assembly, dir, path.join(dir, 'out'), exporter);
            expect(exporter).toHaveBeenCalledWith(
                path.join(dir, 'board.kicad_pcb'),
                path.join(dir, 'out/assets/board/model.wrl'),
                [10, 20],
            );
            expect(manifest.parts[0]).toMatchObject({
                position: [1, 2, 3],
                rotation: [0, 180, 0],
                unitScale: 1,
            });
            expect(manifest.parts[1]).toMatchObject({ kind: 'generated', unitScale: 2.54 });
            expect(manifest.parts[2]).toMatchObject({
                format: 'stl',
                unitScale: 1,
                visible: false,
            });
            expect(fs.readFileSync(path.join(dir, 'board.kicad_pcb'), 'utf8')).toBe(
                'untouched pcb',
            );
            expect(fs.existsSync(path.join(dir, 'out/assets/mount/model.wrl'))).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('honors 3MF units and rejects mixed or unknown units', () => {
        const archive = (unit: string) =>
            zipSync({ '3D/3dmodel.model': strToU8(`<model unit="${unit}"/>`) });
        expect(threeMFMillimetreScale(archive('inch'))).toBe(25.4);
        expect(threeMFMillimetreScale(archive('millimeter'))).toBe(1);
        expect(() => threeMFMillimetreScale(archive('banana'))).toThrow();
        expect(() =>
            threeMFMillimetreScale(
                zipSync({
                    'a.model': strToU8('<model unit="inch"/>'),
                    'b.model': strToU8('<model unit="meter"/>'),
                }),
            ),
        ).toThrow('mixed');
    });
    it('serves only assembly assets, blocking traversal and symlink escapes', () => {
        const dir = temp();
        try {
            fs.mkdirSync(path.join(dir, 'assets'));
            fs.writeFileSync(path.join(dir, 'assets/part.wrl'), 'model');
            fs.writeFileSync(path.join(dir, 'secret'), 'private');
            expect(resolveViewerAsset(dir, '/assets/part.wrl')).toBe(
                path.join(dir, 'assets/part.wrl'),
            );
            expect(resolveViewerAsset(dir, '/assets/%2e%2e/secret')).toBeUndefined();
            expect(resolveViewerAsset(dir, '/assets/%zz')).toBeUndefined();
            fs.symlinkSync(path.join(dir, 'secret'), path.join(dir, 'assets/link.wrl'));
            expect(resolveViewerAsset(dir, '/assets/link.wrl')).toBeUndefined();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('round-trips viewer placements atomically and measures millimetre distances', () => {
        const assembly = new Assembly({ name: 'roundtrip' }).addModel({
            id: 'case',
            file: 'case.stl',
        });
        assembly.applyPlacements({
            unit: 'mm',
            parts: [{ id: 'case', position: [10, 20, 30], rotation: [0, 90, 0], visible: false }],
        });
        expect(assembly.parts[0]).toMatchObject({
            position: [10, 20, 30],
            rotation: [0, 90, 0],
            visible: false,
        });
        expect(() =>
            assembly.applyPlacements({
                unit: 'mm',
                parts: [{ id: 'case', position: [0, 0, 0] }, { id: 'missing' }],
            }),
        ).toThrow();
        expect(assembly.parts[0].position).toEqual([10, 20, 30]);
        expect(measureAssemblyPoints([10, 20, 30], [13, 24, 30])).toEqual({
            distance: 5,
            delta: [3, 4, 0],
        });
    });
    it('copies local GLTF resources and rejects directory escapes', async () => {
        const dir = temp();
        try {
            fs.writeFileSync(path.join(dir, 'mesh.bin'), 'mesh');
            fs.writeFileSync(
                path.join(dir, 'part.gltf'),
                JSON.stringify({ buffers: [{ uri: 'mesh.bin' }] }),
            );
            const assembly = new Assembly({ name: 'gltf' }).addModel({
                id: 'model',
                file: 'part.gltf',
            });
            const result = await prepareAssembly(assembly, dir, path.join(dir, 'out'));
            expect(result.parts[0]).toMatchObject({ unitScale: 1000, upAxis: 'y' });
            expect(fs.existsSync(path.join(dir, 'out/assets/model/mesh.bin'))).toBe(true);
            fs.writeFileSync(
                path.join(dir, 'part.gltf'),
                JSON.stringify({ buffers: [{ uri: '../secret' }] }),
            );
            await expect(prepareAssembly(assembly, dir, path.join(dir, 'bad'))).rejects.toThrow(
                'escapes',
            );
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
