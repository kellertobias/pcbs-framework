import { describe, expect, it } from 'vitest';
import { arrangeSchematicGroups, type LayoutPart } from '../kicad/GroupedSchematicLayout';
const root: LayoutPart = {
    id: 'U1',
    symbol: 'Test:IC',
    value: 'Controller',
    body: { x: -5.08, y: -10.16, width: 10.16, height: 20.32 },
    pins: [
        { number: '1', x: -7.62, y: 5.08, rotation: 0, net: 'INPUT' },
        { number: '2', x: 7.62, y: 0, rotation: 180, net: 'OUTPUT' },
        { number: '3', x: 0, y: 12.7, rotation: 270, net: 'VCC', power: true },
        { number: '4', x: 0, y: -12.7, rotation: 90, net: 'GND', power: true },
    ],
};
function resistor(id: string, net: string, other = 'GND'): LayoutPart {
    return {
        id,
        symbol: 'Device:R',
        value: '1k',
        body: { x: -1.016, y: -2.54, width: 2.032, height: 5.08 },
        pins: [
            { number: '1', x: 0, y: 3.81, rotation: 270, net },
            {
                number: '2',
                x: 0,
                y: -3.81,
                rotation: 90,
                net: other,
                power: ['VCC', 'GND'].includes(other),
            },
        ],
    };
}
const groups = [
    {
        id: 'control',
        title: 'CONTROL',
        components: ['U1', 'R1', 'R2'],
        notes: ['Generated from electrical nets.'],
    },
];
const parts = [root, resistor('R1', 'INPUT'), resistor('R2', 'OUTPUT', 'FILTERED')];
describe('automatic functional-group layout', () => {
    it('places every drawing without authored coordinates, deterministically regardless of capture order', () => {
        const before = JSON.stringify(parts);
        const a = arrangeSchematicGroups(parts, { groups }),
            b = arrangeSchematicGroups([...parts].reverse(), { groups });
        expect(Object.fromEntries(a.positions)).toEqual(Object.fromEntries(b.positions));
        expect(JSON.stringify(parts)).toBe(before);
        expect(a.frames).toHaveLength(1);
        expect(a.paper).toBe('A4');
        for (const p of a.positions.values()) {
            expect(p.x / 2.54).toBeCloseTo(Math.round(p.x / 2.54));
            expect(p.y / 2.54).toBeCloseTo(Math.round(p.y / 2.54));
            expect(p.x).toBeGreaterThan(a.frames[0].x);
            expect(p.x).toBeLessThan(a.frames[0].x + a.frames[0].width);
        }
    });
    it('recognizes shunts and series passives from nets and native pin directions', () => {
        const result = arrangeSchematicGroups(parts, { groups });
        expect(result.positions.get('R1')!.rotation).toBe(0);
        expect(result.positions.get('R2')!.rotation).toBe(90);
        expect(result.positions.get('R1')!.x).toBeLessThan(result.positions.get('U1')!.x);
        expect(result.positions.get('R2')!.x).toBeGreaterThan(result.positions.get('U1')!.x);
    });
    it('excludes common supply nets from signal connectivity and estimated signal length', () => {
        const cap: LayoutPart = {
            ...resistor('C1', 'VCC'),
            symbol: 'Device:C',
            pins: resistor('C1', 'VCC').pins.map((p) => ({ ...p, power: true })),
        };
        const result = arrangeSchematicGroups([root, cap], {
            groups: [{ id: 'supply', title: 'Supply', components: ['U1', 'C1'] }],
        });
        expect(result.estimatedWireLength).toBe(0);
        expect(result.positions.get('C1')!.y).toBeLessThan(result.positions.get('U1')!.y);
    });
    it('supports distinct units of one physical component in different boxes', () => {
        const split = [
            { ...root, id: 'RV1/1' },
            { ...root, id: 'RV1/2' },
        ];
        const result = arrangeSchematicGroups(split, {
            groups: [
                { id: 'track', title: 'Track', components: ['RV1/1'] },
                { id: 'motor', title: 'Motor', components: ['RV1/2'] },
            ],
        });
        expect(result.positions.size).toBe(2);
        const [a, b] = result.frames;
        expect(
            a.x + a.width <= b.x ||
                b.x + b.width <= a.x ||
                a.y + a.height <= b.y ||
                b.y + b.height <= a.y,
        ).toBe(true);
    });
    it('rejects omissions and duplicate/unknown membership instead of falling back to manual placement', () => {
        expect(() => arrangeSchematicGroups(parts, { groups: [] })).toThrow(
            'must include every drawing',
        );
        expect(() =>
            arrangeSchematicGroups(parts, { groups: [{ ...groups[0], components: ['U1', 'U1'] }] }),
        ).toThrow('duplicate schematic group member');
        expect(() =>
            arrangeSchematicGroups(parts, { groups: [{ ...groups[0], components: ['missing'] }] }),
        ).toThrow('Unknown');
        expect(() => arrangeSchematicGroups(parts, { groups: [groups[0], groups[0]] })).toThrow(
            'duplicate schematic group',
        );
    });
    it('provides a grid baseline for reproducible algorithm comparisons and expands the paper to contain groups', () => {
        const circuit = arrangeSchematicGroups(parts, { groups }),
            grid = arrangeSchematicGroups(parts, { groups, algorithm: 'grid' });
        expect(circuit.estimatedWireLength).toBeLessThan(grid.estimatedWireLength);
        const large = { ...root, body: { x: 0, y: 0, width: 300, height: 220 } };
        const result = arrangeSchematicGroups(
            [large],
            { groups: [{ id: 'large', title: 'Large', components: ['U1'] }] },
            'A4',
        );
        expect(result.paper).not.toBe('A4');
    });
});
