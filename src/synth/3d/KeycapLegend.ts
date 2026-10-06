import { createHash } from 'node:crypto';
import * as path from 'node:path';
import {
    BufferGeometry,
    Float32BufferAttribute,
    ShapeGeometry,
    ShapePath,
    type Shape,
} from '../../runtime/three.mjs';
import font from './legend-font.json';
import { writeVRML } from './vrmlWriter';
import type { OC, TriangleMesh } from './types';

/** Model-local printable area. z is the flat top, or rim of a cylindrical dish. */
export interface KeycapLegendSurface {
    x: number;
    y: number;
    z: number;
    width: number;
    height: number;
    fontSize?: number;
    /** Separate bottom-of-cap symbol area in model-local coordinates. */
    bottomMark?: { y: number; width: number };
    dish?: { radius: number; depth: number; centerX: number };
}

/** Font outlines become triangles, preserving counters (O, B, etc.). No texture/font
 * support is needed in either viewer. Curved faces use small triangles to avoid
 * bridging the dish. Opaque white sits 0.035 mm above the plastic. */
export function keycapLegendMesh(
    text: string,
    surface: KeycapLegendSurface,
    secondaryText?: string,
    bottomBars = 0,
): TriangleMesh {
    if (
        ![
            surface.x,
            surface.y,
            surface.z,
            surface.width,
            surface.height,
            surface.fontSize ?? 2.2,
        ].every(Number.isFinite) ||
        surface.width <= 0 ||
        surface.height <= 0 ||
        (surface.fontSize ?? 2.2) <= 0
    )
        throw new Error('Invalid keycap legend surface');
    if (
        surface.dish &&
        (!Number.isFinite(surface.dish.centerX) ||
            !Number.isFinite(surface.dish.depth) ||
            !Number.isFinite(surface.dish.radius) ||
            surface.dish.radius <= surface.width / 2 ||
            surface.dish.depth < 0)
    )
        throw new Error('Invalid keycap dish');
    const lines = text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line, index) => ({
            text: line,
            size: index === 0 && line === 'PB' ? 0.58 : text === '=' ? 2.3 : text === '.' ? 3 : 1,
        }));
    if (!lines.length && !bottomBars) throw new Error('Empty keycap legend');
    if (
        bottomBars &&
        (!Number.isInteger(bottomBars) ||
            bottomBars < 1 ||
            bottomBars > 3 ||
            !surface.bottomMark ||
            !Number.isFinite(surface.bottomMark.y) ||
            !Number.isFinite(surface.bottomMark.width) ||
            surface.bottomMark.width <= 0)
    )
        throw new Error('Invalid bottom keycap bars');
    if (secondaryText?.trim())
        lines.push(
            ...secondaryText
                .trim()
                .split('\n')
                .filter(Boolean)
                .map((line) => ({ text: line, size: 0.58 })),
        );
    const outlineVertices: number[] = [],
        outlineIndices: number[] = [];
    let previousBottom: number | undefined;
    // Explicit lines retain spaces. Alternate actions have 58% of the cap height.
    lines.forEach((line) => {
        const shapes: Shape[] = [];
        const glyphs = Array.from(line.text).map((char) => {
            const glyph = (font.glyphs as Record<string, { ha: number; o?: string }>)[char];
            if (!glyph) throw new Error(`Unsupported key legend character: ${char}`);
            return glyph;
        });
        let x = -glyphs.reduce((sum, glyph) => sum + glyph.ha * line.size, 0) / 2;
        const y = 0;
        for (const glyph of glyphs) {
            const outline = glyph.o?.split(' ') ?? [];
            const p = new ShapePath();
            let i = 0;
            const point = () =>
                [
                    Number(outline[i++]) * line.size + x,
                    Number(outline[i++]) * line.size + y,
                ] as const;
            while (i < outline.length) {
                const command = outline[i++];
                if (!command) continue;
                const end = point();
                if (command === 'm') p.moveTo(...end);
                else if (command === 'l') p.lineTo(...end);
                else if (command === 'q') p.quadraticCurveTo(...point(), ...end);
                else if (command === 'b') {
                    const c1 = point(),
                        c2 = point();
                    p.bezierCurveTo(...c1, ...c2, ...end);
                } else throw new Error(`Unsupported font command: ${command}`);
            }
            shapes.push(...p.toShapes());
            x += glyph.ha * line.size;
        }
        const rowGeometry = new ShapeGeometry(shapes, 10);
        rowGeometry.computeBoundingBox();
        const rowBounds = rowGeometry.boundingBox!;
        // Place actual glyph bounds, rather than baselines, 0.24 mm apart at
        // the nominal 2.4 mm font size. Fitting into the face may reduce this.
        const shiftY =
            previousBottom === undefined
                ? -rowBounds.max.y
                : previousBottom - 100 - rowBounds.max.y;
        previousBottom = rowBounds.min.y + shiftY;
        const vertices = rowGeometry.getAttribute('position');
        const offset = outlineVertices.length / 3;
        for (let i = 0; i < vertices.count; i++)
            outlineVertices.push(vertices.getX(i), vertices.getY(i) + shiftY, 0);
        const indices = rowGeometry.index!;
        for (let i = 0; i < indices.count; i++) outlineIndices.push(indices.getX(i) + offset);
        rowGeometry.dispose();
    });
    const geometry = new BufferGeometry()
        .setAttribute('position', new Float32BufferAttribute(outlineVertices, 3))
        .setIndex(outlineIndices);
    geometry.computeBoundingBox();
    const bounds = outlineVertices.length
        ? geometry.boundingBox!
        : { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } };
    const scale = Math.min(
        ((surface.fontSize ?? 2.2) * (text === 'ENC/\nPBK' ? 1.25 : 1)) / 1000,
        surface.width / (bounds.max.x - bounds.min.x),
        (surface.height * (text === 'ENC/\nPBK' ? 1.18 : 1)) / (bounds.max.y - bounds.min.y),
    );
    const cx = (bounds.min.x + bounds.max.x) / 2,
        cy = (bounds.min.y + bounds.max.y) / 2;
    const positions = geometry.getAttribute('position');
    const planar = Array.from({ length: positions.count }, (_, i) => ({
        x: surface.x + (positions.getX(i) - cx) * scale,
        y: surface.y + (positions.getY(i) - cy) * scale,
    }));
    const mesh: TriangleMesh = {
        vertices: [],
        triangles: [],
        color: { r: 0.96, g: 0.96, b: 0.94 },
        name: `key legend ${[text, secondaryText].filter(Boolean).join(' / ').replace(/\n/g, ' ')}`,
    };
    type Point = { x: number; y: number };
    function triangle(a: Point, b: Point, c: Point) {
        if (
            surface.dish &&
            Math.max(
                Math.hypot(a.x - b.x, a.y - b.y),
                Math.hypot(a.x - c.x, a.y - c.y),
                Math.hypot(b.x - c.x, b.y - c.y),
            ) > 0.45
        ) {
            const ab = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                ac = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 },
                bc = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
            triangle(a, ab, ac);
            triangle(ab, b, bc);
            triangle(ac, bc, c);
            triangle(ab, bc, ac);
            return;
        }
        const start = mesh.vertices.length;
        for (const p of [a, b, c]) {
            let z = surface.z;
            if (surface.dish) {
                const d = surface.dish,
                    dx = p.x - d.centerX;
                if (Math.abs(dx) >= d.radius) throw new Error('Legend lies outside dish radius');
                z += d.radius - d.depth - Math.sqrt(d.radius * d.radius - dx * dx);
            }
            mesh.vertices.push({ ...p, z: z + 0.035 });
        }
        mesh.triangles.push([start, start + 1, start + 2]);
    }
    const indices = geometry.index!;
    for (let i = 0; i < indices.count; i += 3)
        triangle(planar[indices.getX(i)], planar[indices.getX(i + 1)], planar[indices.getX(i + 2)]);
    if (bottomBars) {
        const area = surface.bottomMark!;
        const left = surface.x - area.width / 2,
            right = surface.x + area.width / 2;
        for (let row = 0; row < bottomBars; row++) {
            const centerY = area.y + ((bottomBars - 1) / 2 - row) * 1.0;
            const a = { x: left, y: centerY - 0.175 },
                b = { x: right, y: centerY - 0.175 },
                c = { x: right, y: centerY + 0.175 },
                d = { x: left, y: centerY + 0.175 };
            triangle(a, b, c);
            triangle(a, c, d);
        }
        mesh.name += ` / ${bottomBars} bottom bars`;
    }
    geometry.dispose();
    return mesh;
}

/** Content-addressed names invalidate viewer/KiCad caches when text or face changes. */
export function writeKeycapLegend(
    text: string,
    surface: KeycapLegendSurface,
    outDir: string,
    secondaryText?: string,
    bottomBars = 0,
): string {
    const mesh = keycapLegendMesh(text, surface, secondaryText, bottomBars);
    const hash = createHash('sha256').update(JSON.stringify(mesh)).digest('hex').slice(0, 20);
    const file = path.resolve(outDir, `legend-${hash}.wrl`);
    writeVRML(undefined as unknown as OC, [], file, [mesh]);
    return file;
}
