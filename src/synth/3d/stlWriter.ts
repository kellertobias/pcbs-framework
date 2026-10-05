import fs from 'node:fs';
import path from 'node:path';
import type { OC, SolidHandle, TriangleMesh } from './types';
import { triangulateShape } from './vrmlWriter';

/** Binary STL uses millimetres directly, without KiCad VRML's 2.54 scale conversion. */
export function writeSTL(
    oc: OC,
    solids: SolidHandle[],
    file: string,
    supplied: TriangleMesh[] = [],
): void {
    const meshes = [
        ...solids.map((solid) => triangulateShape(oc, solid.shape)),
        ...supplied.map((mesh) => ({
            vertices: mesh.vertices.flatMap((p) => [p.x, p.y, p.z]),
            indices: mesh.triangles.flat(),
        })),
    ];
    const facets: number[][] = [];
    for (const mesh of meshes)
        for (let i = 0; i < mesh.indices.length; i += 3) {
            // Compute from the actual float32 output coordinates. OCC can emit tiny seam
            // triangles whose vertices collapse when stored in binary STL.
            const points = mesh.indices
                .slice(i, i + 3)
                .map((index) => mesh.vertices.slice(index * 3, index * 3 + 3).map(Math.fround));
            const u = points[1].map((v, j) => v - points[0][j]);
            const v = points[2].map((value, j) => value - points[0][j]);
            const normal = [
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0],
            ];
            const length = Math.hypot(...normal);
            if (!length) continue;
            facets.push([...normal.map((n) => n / length), ...points.flat()]);
        }
    if (!facets.length) throw new Error('STL needs nondegenerate triangles');
    const buffer = Buffer.alloc(84 + facets.length * 50);
    buffer.write('PCB framework STL - millimetres');
    buffer.writeUInt32LE(facets.length, 80);
    let offset = 84;
    for (const facet of facets) {
        for (const value of facet) {
            buffer.writeFloatLE(value, offset);
            offset += 4;
        }
        offset += 2;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
}
