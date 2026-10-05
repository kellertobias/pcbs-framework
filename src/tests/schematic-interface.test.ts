import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { Component, KicadSymbol, Net, Schematic } from '../synth';
import { assertParallelWireSpacing } from '../kicad/Router';
import { SchematicGenerator } from '../kicad/SchematicGenerator';
import { SymbolLibrary } from '../kicad/SymbolLibrary';
import { UuidManager } from '../kicad/UuidManager';
import { SExpressionParser as Parser, type SExpr } from '../kicad/SExpressionParser';

const symbols = '/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols';
const cli = '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli';
class Circuit extends Schematic {
    constructor() {
        super({
            name: 'Interface',
            placementAlgorithm: 'none',
            connectionStyle: 'routed',
            schematicRouting: {
                interfaceComponents: ['J1'],
                hideValues: ['J1'],
                annotations: [{ text: 'EXTERNAL INTERFACE', x: 20.32, y: 15.24 }],
            },
        });
    }
    generate() {
        const connector = new Component({
            ref: 'J1',
            symbol: 'Connector_Generic:Conn_01x02',
            footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical',
            schematicPosition: { x: 20.32, y: 30.48, rotation: 0 },
        });
        const resistors = ['R1', 'R2', 'R3'].map(
            (ref, index) =>
                new Component({
                    ref,
                    symbol: 'Device:R',
                    footprint: 'Resistor_SMD:R_0603_1608Metric',
                    value: '1k',
                    schematicPosition: {
                        x: 60.96 + index * 20.32,
                        y: 30.48 + index * 20.32,
                        rotation: 0,
                    },
                }),
        );
        const external = new Net({ name: 'EXTERNAL' }),
            ground = new Net({ name: 'RETURN' }),
            internal = new Net({ name: 'INTERNAL' });
        connector.pins[1].tie(external);
        connector.pins[2].tie(ground);
        resistors[0].pins[1].tie(external);
        resistors[0].pins[2].tie(internal);
        for (const resistor of resistors.slice(1)) {
            resistor.pins[1].tie(internal);
            resistor.pins[2].tie(ground);
        }
    }
}
const children = (node: SExpr[], key: string) =>
    node.filter((item): item is SExpr[] => Array.isArray(item) && item[0] === key);

describe.skipIf(!fs.existsSync(symbols))('wired schematic interfaces', () => {
    it('wires the core, labels only connector nets, and retains exact authored placement', () => {
        const snapshot = new Circuit()._generateWithCapture();
        const before = snapshot.components.map((component) => component.schematicPosition);
        const generator = new SchematicGenerator(
            snapshot,
            new SymbolLibrary([symbols]),
            new UuidManager(),
        );
        const content = generator.generate(),
            root = Parser.parse(content)[0] as SExpr[];
        expect(snapshot.components.map((component) => component.schematicPosition)).toEqual(before);
        expect(generator.errors).toEqual([]);
        const labels = children(root, 'global_label').map((label) =>
            Parser.unquote(String(label[1])),
        );
        expect(new Set(labels)).toEqual(new Set(['EXTERNAL', 'RETURN']));
        expect(children(root, 'wire').length).toBeGreaterThan(5);
        expect(children(root, 'text')).toHaveLength(1);
        const connector = children(root, 'symbol').find((symbol) =>
            children(symbol, 'property').some(
                (property) => property[1] === '"Reference"' && property[2] === '"J1"',
            ),
        )!;
        const value = children(connector, 'property').find(
            (property) => property[1] === '"Value"',
        )!;
        expect(children(children(value, 'effects')[0], 'hide')).toEqual([['hide', 'yes']]);

        if (!fs.existsSync(cli)) return;
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'schematic-interface-'));
        try {
            const file = path.join(temporary, 'Interface.kicad_sch'),
                netlist = path.join(temporary, 'Interface.xml');
            fs.writeFileSync(file, content);
            const result = spawnSync(
                cli,
                ['sch', 'export', 'netlist', '--format', 'kicadxml', '--output', netlist, file],
                { encoding: 'utf8' },
            );
            expect(result.status, result.stderr).toBe(0);
            const xml = fs.readFileSync(netlist, 'utf8');
            const actual = [...xml.matchAll(/<net\b[^>]*>([\s\S]*?)<\/net>/g)].map((match) =>
                [...match[1].matchAll(/<node ref="([^"]+)" pin="([^"]+)"/g)]
                    .map((pin) => `${pin[1]}.${pin[2]}`)
                    .sort(),
            );
            const expected = snapshot.nets.map((net) =>
                snapshot.components
                    .flatMap((component) =>
                        [...new Set(component.allPins.values())]
                            .filter((pin) => pin.net === net)
                            .map((pin) => `${component.ref}.${pin.name}`),
                    )
                    .sort(),
            );
            expect(actual.sort()).toEqual(expected.sort());
        } finally {
            fs.rmSync(temporary, { recursive: true, force: true });
        }
    });

    it('joins local power branches through native glyphs after wire normalization', () => {
        const snapshot = new Circuit()._generateWithCapture();
        snapshot.schematicRouting = {
            interfaceComponents: ['J1'],
            powerSymbols: { RETURN: 'power:GND' },
            powerGroups: [{ net: 'RETURN', pins: ['R2.2', 'R3.2'] }],
            symbolClearance: 2.54,
            pinEscape: 5.08,
        };
        const content = new SchematicGenerator(
            snapshot,
            new SymbolLibrary([symbols]),
            new UuidManager(),
        ).generate();
        expect(content).toContain('(lib_id "power:GND")');
        expect(content).not.toContain('(global_label "RETURN"');
        snapshot.schematicRouting.powerGroups = [{ net: 'RETURN', pins: ['R1.1'] }];
        expect(() =>
            new SchematicGenerator(
                snapshot,
                new SymbolLibrary([symbols]),
                new UuidManager(),
            ).generate(),
        ).toThrow(/Unknown power terminal/);
    });
    it('uses inward-facing vertical pins for native KiCad symbols', () => {
        const symbol = new KicadSymbol({ name: 'Orientation', reference: 'U' });
        symbol.addPin({ name: 'VCC', number: '1', x: 0, y: 10, side: 'top', type: 'power_in' });
        symbol.addPin({ name: 'GND', number: '2', x: 0, y: -10, side: 'bottom', type: 'power_in' });
        const content = symbol.serialize();
        expect(content).toMatch(/at 0 10 270/);
        expect(content).toMatch(/at 0 -10 90/);
    });
    it('rejects unknown interface references and drawing overrides that change pin numbers', () => {
        const snapshot = new Circuit()._generateWithCapture();
        snapshot.schematicRouting = { interfaceComponents: ['MISSING'] };
        expect(() =>
            new SchematicGenerator(
                snapshot,
                new SymbolLibrary([symbols]),
                new UuidManager(),
            ).generate(),
        ).toThrow(/Unknown schematic interface/);
        const symbol = new KicadSymbol({ name: 'R', reference: 'R' });
        symbol.addPin({ name: 'BAD', number: '3', x: 0, y: 0, side: 'left', type: 'passive' });
        snapshot.schematicRouting = { symbolOverrides: { 'Device:R': symbol } };
        expect(() =>
            new SchematicGenerator(
                snapshot,
                new SymbolLibrary([symbols]),
                new UuidManager(),
            ).generate(),
        ).toThrow(/changes electrical pin numbers/);
    });
});

describe('schematic parallel spacing', () => {
    it('rejects sub-2mm parallel gaps, permits exactly 2mm and perpendicular crossings', () => {
        const a = { p1: { x: 0, y: 0 }, p2: { x: 20, y: 0 }, netName: 'A' };
        const b = { p1: { x: 5, y: 1.999 }, p2: { x: 15, y: 1.999 }, netName: 'B' };
        expect(() => assertParallelWireSpacing([a, b], 2)).toThrow(/at least 2 mm/);
        b.p1.y = b.p2.y = 2;
        expect(() => assertParallelWireSpacing([a, b], 2)).not.toThrow();
        expect(() =>
            assertParallelWireSpacing(
                [a, { p1: { x: 10, y: -5 }, p2: { x: 10, y: 5 }, netName: 'C' }],
                2,
            ),
        ).not.toThrow();
    });
});
