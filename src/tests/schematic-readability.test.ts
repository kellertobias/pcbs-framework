import { describe, expect, it } from 'vitest';
import { schematicReadabilityWarnings } from '../kicad/SchematicReadability';
import { SExpressionParser as Parser, type SExpr } from '../kicad/SExpressionParser';
import { SchematicGenerator } from '../kicad/SchematicGenerator';
import { SymbolLibrary } from '../kicad/SymbolLibrary';
import { UuidManager } from '../kicad/UuidManager';
import { Component, KicadSymbol, Net, Schematic } from '../synth';
const warnings = (body: string) =>
    schematicReadabilityWarnings(Parser.parse(`(kicad_sch ${body})`)[0] as SExpr[]);
const fields = (name: string, text: string, x: number, y: number, extra = '') =>
    `(property "${name}" ${JSON.stringify(text)} (at ${x} ${y} 0) (effects (font (size 1.27 1.27)) ${extra}))`;
const tiny =
    '(lib_symbols (symbol "Test:Tiny" (symbol "Tiny_1_1" (rectangle (start -1 -1) (end 1 1)) (pin passive line (at -5 0 0) (length 4) (number "1")))))';
describe('schematic readability diagnostics', () => {
    it('identifies visible fields colliding with symbols, including power labels and test-point graphics', () => {
        const result = warnings(
            `${tiny} (symbol (lib_id "Test:Tiny") (at 50 50 0) (unit 1) ${fields('Reference', 'U1', 50, 40)}) (symbol (lib_id "Test:Tiny") (at 80 50 0) (unit 1) ${fields('Reference', '#PWR1', 80, 50, '(hide yes)')} ${fields('Value', 'GND', 50, 50)})`,
        );
        expect(
            result.some((w) =>
                w.includes('SCHEMATIC_TEXT_SYMBOL_OVERLAP #PWR1 (GND).Value intersects U1/1'),
            ),
        ).toBe(true);
        expect(result.every((w) => !w.includes('.Reference'))).toBe(true);
    });
    it('reports text/text and wire/text collisions, while ignoring hidden fields', () => {
        const result = warnings(
            `(symbol (at 0 0 0) (unit 1) ${fields('Reference', 'R1', 20, 20)} ${fields('Value', '10k', 20, 20)} ${fields('Hidden', 'ignored', 20, 20, '(hide yes)')}) (wire (pts (xy 10 20) (xy 30 20)))`,
        );
        expect(result.some((w) => w.startsWith('SCHEMATIC_TEXT_OVERLAP'))).toBe(true);
        expect(result.filter((w) => w.startsWith('SCHEMATIC_WIRE_TEXT_OVERLAP'))).toHaveLength(2);
        expect(result.every((w) => !w.includes('.Hidden'))).toBe(true);
    });
    it('warns about a foreign wire through the interior of a pin, but permits endpoint attachment', () => {
        const component = `${tiny} (symbol (lib_id "Test:Tiny") (at 50 50 0) (unit 1) ${fields('Reference', 'U1', 50, 40)})`;
        expect(
            warnings(`${component} (wire (pts (xy 47 40) (xy 47 60)))`).some((w) =>
                w.startsWith('SCHEMATIC_PIN_WIRE_CROSSING'),
            ),
        ).toBe(true);
        expect(warnings(`${component} (wire (pts (xy 45 40) (xy 45 50)))`)).toEqual([]);
    });
    it('decodes multiline notes, respects units and rotated field justification, and checks interface label text', () => {
        expect(
            warnings(
                `(text "First line\\nSecond line" (at 10 10 0) (effects (font (size 1 1)) (justify left top))) (text "Other column" (at 30 10 0) (effects (font (size 1 1)) (justify left top)))`,
            ),
        ).toEqual([]);
        expect(
            warnings(
                `(lib_symbols (symbol "Test:Split" (symbol "Split_1_1" (circle (center 0 0) (radius 1))) (symbol "Split_2_1" (circle (center 100 0) (radius 1))))) (symbol (lib_id "Test:Split") (at 20 20 0) (unit 1) ${fields('Reference', 'RV1', 120, 20)})`,
            ),
        ).toEqual([]);
        const rotated = `(lib_symbols (symbol "Test:Arrow" (symbol "Arrow_1_1" (polyline (pts (xy 0 0) (xy 0 2)))))) (symbol (lib_id "Test:Arrow") (at 20 20 90) (unit 1) (property "Reference" "#PWR1" (at 20 20 0) (effects (hide yes))) (property "Value" "VM" (at 16 20 90) (effects (font (size 1 1)) (justify left))))`;
        expect(warnings(rotated)).toEqual([]);
        expect(
            warnings(
                `(symbol (at 0 0 0) (unit 1) ${fields('Reference', 'C1', 20, 20)}) (global_label "SWCLK" (at 25 20 180) (effects (font (size 1.27 1.27))))`,
            ).some((w) => w.startsWith('SCHEMATIC_TEXT_OVERLAP')),
        ).toBe(true);
    });
});
class Probe extends Schematic {
    constructor() {
        super({
            name: 'Probe',
            placementAlgorithm: 'none',
            connectionStyle: 'routed',
            schematicRouting: {
                interfaceComponents: [],
                hideValues: ['TP1'],
                symbolClearance: 2.54,
            },
        });
    }
    generate() {
        const part = new Component({
            ref: 'TP1',
            symbol: 'Test:Point',
            footprint: 'Test:Point',
            schematicPosition: { x: 50.8, y: 50.8, rotation: 0 },
        });
        part.pins[1].tie(null);
    }
}
function probeGenerator() {
    const drawing = new KicadSymbol({ name: 'Point' });
    drawing.addCircle({ x: 0, y: 3.302, radius: 0.762 });
    drawing.addPin({
        name: '',
        number: '1',
        x: 0,
        y: 0,
        side: 'bottom',
        type: 'passive',
        length: 0,
    });
    const library = new SymbolLibrary([]);
    library.registerSymbol('Test:Point', drawing.serialize());
    const snapshot = new Probe()._generateWithCapture();
    return { snapshot, gen: new SchematicGenerator(snapshot, library, new UuidManager()) };
}
describe('framework field placement', () => {
    it('places a hidden-value test-point reference outside its graphic rather than on its electrical anchor', () => {
        const { gen } = probeGenerator();
        const content = gen.generate();
        expect(gen.warnings).toEqual([]);
        expect(content).toContain('(at 50.80 44.20 0)');
    });
    it('reserves explicit fields, emits reproducible warnings and supports opting out of diagnostics', () => {
        const { snapshot, gen } = probeGenerator();
        snapshot.schematicRouting!.fields = {
            TP1: { reference: { x: 50.8, y: 47.498 }, justify: 'center' },
        };
        gen.generate();
        expect(gen.warnings.some((w) => w.startsWith('SCHEMATIC_TEXT_SYMBOL_OVERLAP'))).toBe(true);
        const original = [...gen.warnings];
        gen.generate();
        expect(gen.warnings).toEqual(original);
        snapshot.schematicRouting!.fields.TP1.reference = { x: 60.96, y: 45.72 };
        expect(gen.generate()).toContain('(at 60.96 45.72 0)');
        expect(gen.warnings).toEqual([]);
        snapshot.schematicRouting!.fields.TP1.reference = { x: 50.8, y: 47.498 };
        snapshot.schematicRouting!.readabilityWarnings = false;
        gen.generate();
        expect(gen.warnings).toEqual([]);
    });
});

class InlineProbeCircuit extends Schematic {
    constructor() {
        super({
            name: 'InlineProbe',
            placementAlgorithm: 'none',
            connectionStyle: 'routed',
            schematicRouting: {
                interfaceComponents: [],
                hideValues: ['U1', 'U2', 'TP1'],
                symbolClearance: 2.54,
                pinEscape: 5.08,
                pinEscapes: { 'TP1.1': 0 },
            },
        });
    }
    generate() {
        const net = new Net({ name: 'SIGNAL' });
        for (const [ref, symbol, x] of [
            ['U1', 'Output', 50.8],
            ['U2', 'Input', 101.6],
            ['TP1', 'Probe', 76.2],
        ] as const) {
            const part = new Component({
                ref,
                symbol: `Test:${symbol}`,
                footprint: 'Test:Part',
                schematicPosition: { x, y: 50.8, rotation: 0 },
            });
            part.pins[1].tie(net);
        }
    }
}
it('keeps an inline one-pin probe on a straight signal spine instead of routing around its own anchor', () => {
    const library = new SymbolLibrary([]);
    for (const [name, side, x] of [
        ['Output', 'right', 5.08],
        ['Input', 'left', -5.08],
        ['Probe', 'bottom', 0],
    ] as const) {
        const drawing = new KicadSymbol({ name });
        if (name === 'Probe') drawing.addCircle({ x: 0, y: 3.302, radius: 0.762 });
        else drawing.addRect({ x1: -2.54, y1: -2.54, x2: 2.54, y2: 2.54 });
        drawing.addPin({ name: '', number: '1', x, y: 0, side, type: 'passive', length: 2.54 });
        library.registerSymbol(`Test:${name}`, drawing.serialize());
    }
    const gen = new SchematicGenerator(
        new InlineProbeCircuit()._generateWithCapture(),
        library,
        new UuidManager(),
    );
    const root = Parser.parse(gen.generate())[0] as SExpr[];
    const wires = root
        .filter((n): n is SExpr[] => Array.isArray(n) && n[0] === 'wire')
        .map(
            (n) =>
                (n.find((p) => Array.isArray(p) && p[0] === 'pts') as SExpr[]).slice(
                    1,
                ) as SExpr[][],
        );
    expect(wires.length).toBeGreaterThan(0);
    for (const [a, b] of wires) expect([Number(a[2]), Number(b[2])]).toEqual([50.8, 50.8]);
    expect(
        root.some(
            (node) =>
                Array.isArray(node) &&
                node[0] === 'junction' &&
                node.some(
                    (field) =>
                        Array.isArray(field) &&
                        field[0] === 'at' &&
                        Number(field[1]) === 76.2 &&
                        Number(field[2]) === 50.8,
                ),
        ),
    ).toBe(true);
    expect(gen.warnings).toEqual([]);
});
