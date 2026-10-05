import { refreshBoardKeycapLegends } from '../kicad/PcbSynchronizer';
import { SExpressionParser } from '../kicad/SExpressionParser';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { keycapLegendMesh, writeKeycapLegend } from '../synth/3d/KeycapLegend';
import { Component, KicadFootprint, Schematic } from '../synth';
import { PcbGenerator } from '../kicad/PcbGenerator';
import { UuidManager } from '../kicad/UuidManager';
const face = {
    x: -2.54,
    y: -5.08,
    z: 17.526,
    width: 11.2,
    height: 10.8,
    fontSize: 2.4,
    dish: { radius: 32, depth: 0.6, centerX: -2.54 },
};
describe('keycap legends', () => {
    it('keeps playback headings small above their numbers and draws bars separately at the bottom', () => {
        const surface = {
            ...face,
            x: 0,
            y: 13.4 / 3,
            height: 13.4 / 3 - 0.6,
            dish: undefined,
            bottomMark: { y: -13.4 / 3, width: 6.8 },
        };
        const mesh = keycapLegendMesh('PB\n101', surface, undefined, 1);
        const textVertices = mesh.vertices.filter((point) => point.y > 0);
        expect(Math.min(...textVertices.map((p) => p.y))).toBeGreaterThan(13.4 / 6);
        expect(Math.max(...textVertices.map((p) => p.y))).toBeLessThan(13.4 / 2);
        const bars = keycapLegendMesh('', surface, undefined, 3);
        expect(bars.vertices.every((p) => p.y < -13.4 / 6)).toBe(true);
        expect(
            new Set(bars.vertices.map((p) => Math.round((p.y - surface.bottomMark.y) / 1.0))).size,
        ).toBe(3);
        const wide = { ...surface, width: 40, height: 40 };
        const playback = keycapLegendMesh('PB\n101', wide);
        const firstCount = keycapLegendMesh('PB', wide).vertices.length;
        const heading = playback.vertices.slice(0, firstCount).map((p) => p.y);
        const number = playback.vertices.slice(firstCount).map((p) => p.y);
        expect(
            (Math.max(...heading) - Math.min(...heading)) /
                (Math.max(...number) - Math.min(...number)),
        ).toBeLessThan(0.65);
    });
    it('retains spaces and gives alternate actions a smaller cap height', () => {
        const surface = { ...face, dish: undefined, width: 40, height: 40 };
        const mesh = keycapLegendMesh('A', surface, 'A');
        const primaryCount = keycapLegendMesh('A', surface).vertices.length;
        const upper = mesh.vertices.slice(0, primaryCount).map((point) => point.y);
        const lower = mesh.vertices.slice(primaryCount).map((point) => point.y);
        expect(Math.min(...upper) - Math.max(...lower)).toBeLessThanOrEqual(0.25);
        expect(
            (Math.max(...lower) - Math.min(...lower)) / (Math.max(...upper) - Math.min(...upper)),
        ).toBeCloseTo(0.58, 5);
        const singleLine = keycapLegendMesh('PB 101', surface);
        expect(
            Math.max(...singleLine.vertices.map((p) => p.y)) -
                Math.min(...singleLine.vertices.map((p) => p.y)),
        ).toBeLessThan(3);
    });
    it('fits long multiline labels and follows the MX dish', () => {
        for (const text of ['SHARED PLAYBACK', 'PAGE DOWN', 'ENC/PBK', 'F15 GO', '0']) {
            const mesh = keycapLegendMesh(text, face);
            expect(mesh.triangles.length).toBeGreaterThan(0);
            for (const p of mesh.vertices) {
                expect(Math.abs(p.x - face.x)).toBeLessThanOrEqual(face.width / 2 + 1e-6);
                expect(Math.abs(p.y - face.y)).toBeLessThanOrEqual(face.height / 2 + 1e-6);
                expect(p.z).toBeCloseTo(
                    face.z + 32 - 0.6 - Math.sqrt(32 ** 2 - (p.x - face.x) ** 2) + 0.035,
                    8,
                );
            }
        }
    });
    it('preserves the hole inside O', () => {
        const mesh = keycapLegendMesh('O', { ...face, dish: undefined });
        const point = { x: face.x, y: face.y };
        const cross = (a: typeof point, b: typeof point) =>
            (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
        for (const t of mesh.triangles) {
            const [a, b, c] = t.map((i) => mesh.vertices[i]);
            const signs = [cross(a, b), cross(b, c), cross(c, a)];
            expect(signs.every((s) => s >= 0) || signs.every((s) => s <= 0)).toBe(false);
        }
    });
    it('attaches a deterministic legend alongside the original model, including back/rotated placements', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'key-legend-'));
        try {
            const pretty = path.join(dir, 'Test.pretty');
            fs.mkdirSync(pretty);
            const fp = new KicadFootprint({ name: 'Key' })
                .setKeycapLegendSurface(face)
                .set3DModel({ path: 'base.wrl' });
            fs.writeFileSync(path.join(pretty, 'Key.kicad_mod'), fp.serialize());
            fs.writeFileSync(
                path.join(dir, 'fp-lib-table'),
                `(fp_lib_table (lib (name "Test")(type "KiCad")(uri "${pretty}")))`,
            );
            class Board extends Schematic {
                generate() {
                    new Component({
                        ref: 'SW1',
                        symbol: 'Device:R',
                        footprint: 'Test:Key',
                        frontPanelLabel: 'PAGE\nDOWN',
                        pcbPosition: { x: 20, y: 20, rotation: 90 },
                    });
                    new Component({
                        ref: 'SW2',
                        symbol: 'Device:R',
                        footprint: 'Test:Key',
                        frontPanelLabel: 'PAGE DOWN',
                        pcbPosition: { x: 40, y: 20, rotation: 180, side: 'back' },
                    });
                    new Component({
                        ref: 'SW3',
                        symbol: 'Device:R',
                        footprint: 'Test:Key',
                        pcbPosition: { x: 60, y: 20 },
                    });
                }
            }
            const board = new Board({
                name: 'Legends',
                pcb: {
                    outline: [
                        { x: 0, y: 0 },
                        { x: 80, y: 0 },
                        { x: 80, y: 40 },
                        { x: 0, y: 40 },
                    ],
                    place: ['*'],
                },
            });
            const result = new PcbGenerator(
                board._generateWithCapture(),
                new UuidManager(),
                dir,
            ).generate();
            expect(result.content.match(/\(model/g)).toHaveLength(5);
            expect(result.content).toContain('\"PAGE\\nDOWN\"');
            expect(result.content).not.toContain('\"PAGE\nDOWN\"');
            const existing = result.content.replace(
                /\n\)$/,
                '\n(segment (start 1 2) (end 3 4) (width 0.25) (layer "F.Cu") (net 1))\n)',
            );
            const refreshed = refreshBoardKeycapLegends(existing, result.content);
            const withoutLegends = (source: string) => {
                const tree = SExpressionParser.parse(source)[0];
                if (!Array.isArray(tree)) throw new Error('Invalid board');
                for (const fp of tree) {
                    if (!Array.isArray(fp) || fp[0] !== 'footprint') continue;
                    for (let i = fp.length - 1; i >= 0; i--) {
                        const item = fp[i];
                        if (!Array.isArray(item)) continue;
                        if (
                            (item[0] === 'property' &&
                                ['"KeycapLegendSurface"', '"FrontPanelText"'].includes(
                                    String(item[1]),
                                )) ||
                            (item[0] === 'model' && String(item[1]).includes('key-legends/'))
                        )
                            fp.splice(i, 1);
                    }
                }
                return tree;
            };
            expect(withoutLegends(refreshed)).toEqual(withoutLegends(existing));
            expect(refreshBoardKeycapLegends(refreshed, result.content)).toBe(refreshed);
            const files = fs.readdirSync(path.join(dir, '3d/key-legends'));
            expect(files).toHaveLength(2);
            const wrl = fs.readFileSync(path.join(dir, '3d/key-legends', files[0]), 'utf8');
            expect(wrl).toContain('IndexedFaceSet');
            expect(wrl).not.toContain('geometry Text');
            expect(
                writeKeycapLegend('PAGE\nDOWN', face, path.join(dir, '3d/key-legends')),
            ).toContain('legend-');
            expect(
                writeKeycapLegend('PAGE UP', face, path.join(dir, '3d/key-legends')),
            ).not.toContain(files[0]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
