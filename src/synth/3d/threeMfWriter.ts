import fs from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import type { ColorRGBA, OC, SolidHandle, TriangleMesh } from './types';
import { triangulateShape } from './vrmlWriter';

const escapeXml = (text: string) =>
    text.replace(
        /[<>&"']/g,
        (c) =>
            ({
                '<': '&lt;',
                '>': '&gt;',
                '&': '&amp;',
                '"': '&quot;',
                "'": '&apos;',
            })[c]!,
    );
const colorHex = (color?: ColorRGBA) =>
    '#' +
    [color?.r ?? 0.7, color?.g ?? 0.7, color?.b ?? 0.7, color?.a ?? 1]
        .map((value) =>
            Math.round(Math.max(0, Math.min(1, value)) * 255)
                .toString(16)
                .padStart(2, '0'),
        )
        .join('')
        .toUpperCase();

/** 3MF core package: millimetres, named objects and per-object base materials.
 * Supplied triangle meshes retain their vertices/faces; OCC solids are tessellated.
 */
export function write3MF(
    oc: OC,
    solids: SolidHandle[],
    file: string,
    supplied: TriangleMesh[] = [],
): void {
    const meshes: TriangleMesh[] = [
        ...solids.map((solid) => {
            const mesh = triangulateShape(oc, solid.shape);
            return {
                name: solid.name,
                color: solid.color,
                vertices: Array.from({ length: mesh.vertices.length / 3 }, (_, i) => ({
                    x: mesh.vertices[i * 3],
                    y: mesh.vertices[i * 3 + 1],
                    z: mesh.vertices[i * 3 + 2],
                })),
                triangles: Array.from(
                    { length: mesh.indices.length / 3 },
                    (_, i): [number, number, number] => [
                        mesh.indices[i * 3],
                        mesh.indices[i * 3 + 1],
                        mesh.indices[i * 3 + 2],
                    ],
                ),
            };
        }),
        ...supplied,
    ];
    if (!meshes.length) throw new Error('3MF needs at least one mesh or solid');
    const objects = meshes
        .map((mesh, i) => {
            const vertices = mesh.vertices
                .map(({ x, y, z }) => `<vertex x="${x}" y="${y}" z="${z}"/>`)
                .join('');
            const triangles = mesh.triangles
                .map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`)
                .join('');
            return `<object id="${i + 2}" type="model" name="${escapeXml(mesh.name ?? `Part ${i + 1}`)}" pid="1" pindex="${i}"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`;
        })
        .join('');
    const materials = meshes
        .map(
            (mesh, i) =>
                `<base name="${escapeXml(mesh.name ?? `Part ${i + 1}`)}" displaycolor="${colorHex(mesh.color)}"/>`,
        )
        .join('');
    const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">PCB framework</metadata><resources><basematerials id="1">${materials}</basematerials>${objects}</resources><build>${meshes.map((_, i) => `<item objectid="${i + 2}"/>`).join('')}</build></model>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
    const relationships = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/></Relationships>`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
        file,
        zipSync({
            '[Content_Types].xml': strToU8(contentTypes),
            '_rels/.rels': strToU8(relationships),
            '3D/3dmodel.model': strToU8(model),
        }),
    );
}
