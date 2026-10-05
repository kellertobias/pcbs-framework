import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Assembly } from '../synth/Assembly';
import { assemblyWorldMatrix, validateAssemblyHierarchy } from '../assembly/transforms';
import { bentSheetMesh, bentSheetProfile } from '../synth/3d/bentSheet';

describe('assembly groups and formed sheets', () => {
    it('composes nested groups and applies saved group placements to all children', () => {
        const a = new Assembly({ name: 'nested' })
            .addGroup({ id: 'parent', position: [10, 20, 30], rotation: [90, 0, 0] })
            .addGroup({ id: 'child', group: 'parent', position: [0, 5, 0] })
            .addModel({ id: 'model', group: 'child', file: 'part.stl', position: [0, 2, 0] });
        const position = () =>
            new Vector3().applyMatrix4(assemblyWorldMatrix(a.parts[2], a.parts)).toArray();
        expect(position()).toEqual([10, 20, 37]);
        a.applyPlacements({ unit: 'mm', parts: [{ id: 'parent', position: [11, 21, 31] }] });
        expect(position()).toEqual([11, 21, 38]);
    });
    it('rejects cycles and non-group parents before preparing geometry', () => {
        const a = new Assembly({ name: 'cycle' })
            .addGroup({ id: 'a', group: 'b' })
            .addGroup({ id: 'b', group: 'a' });
        expect(() => validateAssemblyHierarchy(a.parts)).toThrow('cycle');
        const b = new Assembly({ name: 'bad' })
            .addModel({ id: 'a', file: 'a.stl' })
            .addGroup({ id: 'b', group: 'a' });
        expect(() => validateAssemblyHierarchy(b.parts)).toThrow('Unknown assembly group');
    });
    it('builds a consistently wound closed sheet with the requested gauge and bend radius', () => {
        const p = {
            xMin: 0,
            xMax: 20,
            path: [
                [0, 10],
                [30, 10],
                [30, 0],
                [10, 0],
            ] as [number, number][],
            thickness: 2,
            insideRadius: 2,
        };
        const mesh = bentSheetMesh(p),
            edges = new Map<string, number>();
        let volume = 0;
        for (const face of mesh.triangles) {
            const [a, b, c] = face.map(
                (i) => new Vector3(mesh.vertices[i].x, mesh.vertices[i].y, mesh.vertices[i].z),
            );
            volume += a.dot(b.clone().cross(c)) / 6;
            for (let i = 0; i < 3; i++) {
                const first = face[i],
                    second = face[(i + 1) % 3],
                    key = [first, second].sort((a, b) => a - b).join(',');
                edges.set(key, (edges.get(key) ?? 0) + (first < second ? 1 : -1));
            }
        }
        expect([...edges.values()].every((v) => v === 0)).toBe(true);
        expect(volume).toBeGreaterThan(0);
        expect(volume).toBeCloseTo(bentSheetProfile(p).centrelineLength * 2 * 20, -1);
        expect(() => bentSheetMesh({ ...p, thickness: Infinity })).toThrow('Invalid');
        expect(() => bentSheetMesh({ ...p, insideRadius: 20 })).toThrow('too short');
    });
});
