import { describe, expect, it } from 'vitest';
import { Component, KicadSymbol, Net, Schematic } from '../synth';
import { SchematicGenerator } from '../kicad/SchematicGenerator';
import { SymbolLibrary } from '../kicad/SymbolLibrary';
import { UuidManager } from '../kicad/UuidManager';
import { SExpressionParser as Parser, type SExpr } from '../kicad/SExpressionParser';

function symbol() {
    const result = new KicadSymbol({ name: 'Split', reference: 'RV' });
    for (const unit of [1, 2]) {
        const drawing = new KicadSymbol({ name: `Drawing${unit}`, reference: 'RV' });
        drawing.addRect({ x1: -2.54, y1: -2.54, x2: 2.54, y2: 2.54 });
        for (const offset of [0, 1])
            drawing.addPin({
                name: `P${unit * 2 - 1 + offset}`,
                number: String(unit * 2 - 1 + offset),
                x: offset ? 5.08 : -5.08,
                y: 0,
                side: offset ? 'right' : 'left',
                type: 'passive',
            });
        result.addUnit(unit, drawing);
    }
    return result;
}
class Circuit extends Schematic {
    constructor() {
        super({
            name: 'SplitTest',
            placementAlgorithm: 'none',
            connectionStyle: 'routed',
            schematicRouting: {
                interfaceComponents: [],
                symbolOverrides: { 'Test:Split': symbol() },
                units: {
                    RV1: [
                        { unit: 1, position: { x: 50.8, y: 50.8, rotation: 0 } },
                        { unit: 2, position: { x: 101.6, y: 50.8, rotation: 0 } },
                    ],
                },
            },
        });
    }
    generate() {
        const part = new Component({
            ref: 'RV1',
            symbol: 'Test:Split',
            value: 'one physical part',
            footprint: 'Test:OneFootprint',
            schematicPosition: { x: 0, y: 0, rotation: 0 },
        });
        const a = new Net({ name: 'A' }),
            b = new Net({ name: 'B' });
        part.pins[1].tie(a);
        part.pins[3].tie(a);
        part.pins[2].tie(b);
        part.pins[4].tie(b);
    }
}
const children = (node: SExpr[], key: string) =>
    node.filter((item): item is SExpr[] => Array.isArray(item) && item[0] === key);
function generator(snapshot: ReturnType<Circuit['_generateWithCapture']>) {
    return new SchematicGenerator(snapshot, new SymbolLibrary([]), new UuidManager());
}
describe('native schematic units', () => {
    it('draws independent units without duplicating the physical part or changing its pins', () => {
        const snapshot = new Circuit()._generateWithCapture();
        const part = snapshot.components[0],
            originalPosition = part.schematicPosition;
        const gen = generator(snapshot),
            content = gen.generate();
        const instances = children(Parser.parse(content)[0] as SExpr[], 'symbol');
        expect(instances).toHaveLength(2);
        expect(instances.map((node) => children(node, 'unit')[0][1])).toEqual(['1', '2']);
        expect(instances.map((node) => children(node, 'pin').map((pin) => pin[1]))).toEqual([
            ['"1"', '"2"'],
            ['"3"', '"4"'],
        ]);
        expect(new Set(instances.map((node) => children(node, 'uuid')[0][1])).size).toBe(2);
        expect(instances.map((node) => children(node, 'at')[0].slice(1, 3))).toEqual([
            ['50.80', '50.80'],
            ['101.60', '50.80'],
        ]);
        expect(gen.errors).toEqual([]);
        expect(gen.generate()).toBe(content);
        expect(snapshot.components).toEqual([part]);
        expect(part.schematicPosition).toBe(originalPosition);
        expect([...part.allPins.keys()]).toEqual(['1', '3', '2', '4']);
    });
    it('reports an excessive authored routing detour without changing connectivity', () => {
        const snapshot = new Circuit()._generateWithCapture();
        snapshot.schematicRouting!.routeHints = [
            {
                id: 'long-return',
                nets: ['A'],
                waypoints: [
                    { x: 30.48, y: 139.7 },
                    { x: 121.92, y: 139.7 },
                ],
            },
        ];
        const gen = generator(snapshot);
        gen.generate();
        expect(gen.warnings.some((w) => w.startsWith('SCHEMATIC_ROUTE_DETOUR A:'))).toBe(true);
        expect(gen.errors).toEqual([]);
    });
    it('rejects duplicate, nonexistent, or omitted units rather than losing circuit pins', () => {
        for (const units of [[1, 1], [1, 3], [1]]) {
            const snapshot = new Circuit()._generateWithCapture();
            snapshot.schematicRouting!.units!.RV1 = units.map((unit, index) => ({
                unit,
                position: { x: 50.8 + index * 50.8, y: 50.8, rotation: 0 },
            }));
            expect(() => generator(snapshot).generate()).toThrow(
                /duplicate unit|Empty unit|Not all units/,
            );
        }
        const unplaced = new Circuit()._generateWithCapture();
        delete unplaced.schematicRouting!.units;
        expect(() => generator(unplaced).generate()).toThrow(/requires schematicRouting.units/);
        expect(() => symbol().addUnit(1, new KicadSymbol({ name: 'Duplicate' }))).toThrow();
    });
});
