import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
    compileArtwork,
    barrelPolaritySymbol,
    artworkPoints,
} from '../frontpanel/FrontPanelArtwork';
import { Component, Schematic, exportSchematicFrontPanel } from '../synth';
const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function fixture(content: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-art-'));
    dirs.push(dir);
    const file = path.join(dir, 'logo.svg');
    fs.writeFileSync(file, content);
    return file;
}
it('imports SVG curves, transforms, local references and separate open contours in physical millimetres', () => {
    const file = fixture(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><defs><path id="mark" d="M0 0 Q50 50 100 0 Z"/></defs><g transform="translate(0 5)"><use href="#mark"/></g><path fill="none" stroke="black" d="M0 40 C25 0 75 0 100 40"/></svg>',
    );
    const entities = compileArtwork(
        [{ type: 'svg', file, at: { x: 30, y: 10 }, width: 20 }],
        () => {
            throw new Error('unexpected anchor');
        },
    );
    expect(entities).toHaveLength(2);
    expect(entities[0]).toMatchObject({
        type: 'polyline',
        closed: true,
        layer: 'ENGRAVING',
    });
    expect(entities[1]).toMatchObject({ type: 'polyline', closed: false });
    expect(artworkPoints(entities[0])[0]).toEqual({ x: 20, y: 14 });
    expect(artworkPoints(entities[0]).length).toBeGreaterThan(10);
    expect(artworkPoints(entities[1]).slice(-1)[0]).toEqual({ x: 40, y: 7 });
});
it('rejects unsupported SVG contents with actionable messages', () => {
    for (const [content, message] of [
        ['<text>Logo</text>', 'Convert SVG logo text'],
        ['<image href="https://example.com/logo.png"/>', 'Unsupported SVG artwork'],
        ['<use href="https://example.com/logo.svg#mark"/>', 'local'],
    ] as const) {
        const file = fixture(`<svg viewBox="0 0 10 10">${content}</svg>`);
        expect(() =>
            compileArtwork([{ type: 'svg', file, at: { x: 0, y: 0 }, width: 10 }], () => ({
                x: 0,
                y: 0,
            })),
        ).toThrow(message);
    }
});
it('exports anchored symbols, imported contours and unicode text into the four layers and validates bounds before writing', () => {
    class Board extends Schematic {
        constructor() {
            super({ name: 'Art' });
        }
        generate() {
            new Component({
                symbol: 'Device:R',
                footprint: 'Test:Port',
                ref: 'J1',
                frontPanelInterface: {
                    facing: 'top',
                    anchor: { x: 0, y: 0, z: 10 },
                    cutouts: [{ type: 'circle', diameter: 4 }],
                },
            });
        }
    }
    const logo = fixture(
        '<svg viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10"/></svg>',
    );
    const pcbFile = path.join(path.dirname(logo), 'Art.kicad_pcb');
    fs.writeFileSync(
        pcbFile,
        '(kicad_pcb (gr_rect (start 0 0) (end 60 40) (layer "Edge.Cuts")) (footprint "Test:Port" (layer "F.Cu") (at 20 0) (property "Reference" "J1")))',
    );
    const definition = (s: Board) => ({
        edge: 'top' as const,
        textStyle: { bold: true },
        extends: { left: 0, right: 0, top: 30, bottom: 5 },
        components: [{ component: s.getComponent('J1') }],
        drawings: [
            barrelPolaritySymbol({
                polarity: 'center-positive',
                anchor: { component: s.getComponent('J1'), offset: { x: 0, y: 10 } },
            }),
            { type: 'svg' as const, file: logo, at: { x: 45, y: 20 }, width: 8 },
            {
                type: 'text' as const,
                at: { x: 20, y: 2 },
                text: '6–24 V',
                fontSize: 2,
            },
        ],
    });
    const result = exportSchematicFrontPanel(new Board(), { art: definition }, 'art', { pcbFile });
    const svg = fs.readFileSync(result.svgFile, 'utf8'),
        dxf = fs.readFileSync(result.dxfFile, 'utf8');
    expect(result.drawings).toBe(11);
    expect(svg).toContain('font-size="2" font-weight="bold"');
    expect(dxf).toContain('7\nPCBS_BOLD\n');
    expect(dxf).toContain('3\narialbd.ttf\n');
    expect(svg.match(/id="ENGRAVING"/g)).toHaveLength(1);
    expect(svg).toContain('cx="25" cy="-20" r="1"');
    expect(dxf).toContain('0\nARC\n');
    expect(dxf).toContain('6\\U+201324 V');
    const outputDir = path.join(path.dirname(logo), 'invalid');
    expect(() =>
        exportSchematicFrontPanel(
            new Board(),
            {
                art: (s) => ({
                    ...definition(s),
                    drawings: [{ type: 'circle', center: { x: 0, y: 0 }, radius: 5 }],
                }),
            },
            'art',
            { pcbFile, outputDir },
        ),
    ).toThrow('outside the plate');
    expect(fs.existsSync(outputDir)).toBe(false);
});
