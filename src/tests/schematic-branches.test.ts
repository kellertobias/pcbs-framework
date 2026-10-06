import { describe, expect, it } from 'vitest';
import { Component, KicadSymbol, Net, Schematic } from '../synth';
import { SchematicGenerator } from '../kicad/SchematicGenerator';
import { SymbolLibrary } from '../kicad/SymbolLibrary';
import { UuidManager } from '../kicad/UuidManager';
import { SExpressionParser as Parser, type SExpr } from '../kicad/SExpressionParser';

class BranchCircuit extends Schematic {
    constructor() {
        super({
            name: 'Branches',
            placementAlgorithm: 'none',
            connectionStyle: 'routed',
            schematicRouting: {
                interfaceComponents: [],
                hideValues: ['U1'],
                compactFields: true,
                symbolClearance: 2.54,
                branches: [{ component: 'R1', anchor: 'U1.1', direction: 'down', gap: 10.16 }],
            },
        });
    }
    generate() {
        const signal = new Net({ name: 'SIGNAL' }),
            ground = new Net({ name: 'GND', class: 'Power' });
        const chip = new Component({
            ref: 'U1',
            symbol: 'Test:Chip',
            footprint: 'Test:Chip',
            schematicPosition: { x: 50.8, y: 50.8, rotation: 0 },
        });
        const resistor = new Component({
            ref: 'R1',
            symbol: 'Device:R',
            footprint: 'Test:R',
            value: '47k',
        });
        chip.pins[1].tie(signal);
        resistor.pins[1].tie(signal);
        resistor.pins[2].tie(ground);
    }
}
function fixture() {
    const resistor = new KicadSymbol({ name: 'R' });
    resistor.addRect({ x1: -1.016, y1: -2.54, x2: 1.016, y2: 2.54 });
    resistor.addPin({
        number: '1',
        name: '',
        x: 0,
        y: 3.81,
        side: 'top',
        type: 'passive',
        length: 1.27,
    });
    resistor.addPin({
        number: '2',
        name: '',
        x: 0,
        y: -3.81,
        side: 'bottom',
        type: 'passive',
        length: 1.27,
    });
    const chip = new KicadSymbol({ name: 'Chip' });
    chip.addRect({ x1: -2.54, y1: -2.54, x2: 2.54, y2: 2.54 });
    chip.addPin({
        number: '1',
        name: '',
        x: 5.08,
        y: 0,
        side: 'right',
        type: 'passive',
        length: 2.54,
    });
    const library = new SymbolLibrary([]);
    library.registerSymbol('Device:R', resistor.serialize());
    library.registerSymbol('Test:Chip', chip.serialize());
    const snapshot = new BranchCircuit()._generateWithCapture();
    return { snapshot, gen: new SchematicGenerator(snapshot, library, new UuidManager()) };
}
const children = (node: SExpr[], name: string) =>
    node.filter((n): n is SExpr[] => Array.isArray(n) && n[0] === name);
function resistorInstance(content: string) {
    const root = Parser.parse(content)[0] as SExpr[];
    return children(root, 'symbol').find((n) =>
        children(n, 'property').some((p) => p[1] === '"Reference"' && p[2] === '"R1"'),
    )!;
}
describe('connected passive placement', () => {
    it('infers the shared pin and orientation, aligns perpendicular branches with the escaped signal lane, and preserves source placements', () => {
        const { snapshot, gen } = fixture();
        const before = snapshot.components.map(
            (c) => c.schematicPosition && { ...c.schematicPosition },
        );
        const content = gen.generate(),
            instance = resistorInstance(content);
        expect(children(instance, 'at')[0]).toEqual(['at', '60.96', '64.77', '0.00']);
        expect(snapshot.components.map((c) => c.schematicPosition)).toEqual(before);
        expect(gen.generate()).toEqual(content);
        expect(gen.warnings).toEqual([]);
        const value = children(instance, 'property').find((p) => p[1] === '"Value"')!;
        expect(children(value, 'at')[0]).toEqual(['at', '60.96', '64.77', '90']);
    });
    it('rotates horizontal series branches and keeps values centered and references above the body', () => {
        const { snapshot, gen } = fixture();
        snapshot.schematicRouting!.branches![0].direction = 'right';
        const instance = resistorInstance(gen.generate());
        expect(children(instance, 'at')[0]).toEqual(['at', '69.85', '50.80', '90.00']);
        const value = children(instance, 'property').find((p) => p[1] === '"Value"')!;
        expect(children(value, 'at')[0]).toEqual(['at', '69.85', '50.80', '90']);
        const reference = children(instance, 'property').find((p) => p[1] === '"Reference"')!;
        expect(Number(children(reference, 'at')[0][2])).toBeLessThan(49.8);
        expect(gen.warnings).toEqual([]);
    });
    it('rejects disconnected anchors and invalid spacing instead of inventing a connection', () => {
        const { snapshot, gen } = fixture();
        snapshot.schematicRouting!.branches![0].anchor = 'U1.2';
        expect(() => gen.generate()).toThrow('Invalid schematic branch');
        snapshot.schematicRouting!.branches![0].anchor = 'U1.1';
        snapshot.schematicRouting!.branches![0].gap = -1;
        expect(() => gen.generate()).toThrow('Invalid schematic branch');
    });
});
