import { describe, expect, it } from 'vitest';
import { placementRoutingScore } from '../kicad/SchematicPlacementScore';
import { Router, assertParallelWireSpacing } from '../kicad/Router';
import { KicadSymbol } from '../synth/KicadSymbol';
import { SExpressionParser as Parser, type SExpr } from '../kicad/SExpressionParser';
import { arrangeSchematicGroups, type LayoutPart } from '../kicad/GroupedSchematicLayout';

describe('routing-informed schematic placement', () => {
    it('penalizes foreign crossings but allows same-net junctions', () => {
        const layout = {
            positions: new Map(),
            frames: [],
            paper: 'A4',
            algorithm: 'circuit' as const,
            estimatedWireLength: 0,
        };
        const wires = [
            { p1: { x: 0, y: 5 }, p2: { x: 10, y: 5 }, netName: 'A' },
            { p1: { x: 5, y: 0 }, p2: { x: 5, y: 10 }, netName: 'B' },
        ];
        expect(placementRoutingScore(wires, layout)).toMatchObject({
            length: 20,
            crossings: 1,
            cost: 45.4,
        });
        expect(
            placementRoutingScore(
                wires.map((w) => ({ ...w, netName: 'A' })),
                layout,
            ),
        ).toMatchObject({ length: 20, crossings: 0, cost: 20 });
    });
    it('aligns rail bypasses even during routing-feedback refinement', () => {
        const parts: LayoutPart[] = ['C1', 'C2', 'C3'].map((id) => ({
            id,
            symbol: 'Device:C',
            value: '100n',
            body: { x: -2, y: -2, width: 4, height: 4 },
            pins: [
                { number: '1', x: 0, y: 3.81, rotation: 270, net: 'VCC', power: true },
                { number: '2', x: 0, y: -3.81, rotation: 90, net: 'GND', power: true },
            ],
        }));
        parts.unshift({
            id: 'U1',
            symbol: 'Test:IC',
            value: 'IC',
            body: { x: -5, y: -5, width: 10, height: 10 },
            pins: [
                { number: '1', x: 0, y: 7.62, rotation: 270, net: 'VCC', power: true },
                { number: '2', x: 0, y: -7.62, rotation: 90, net: 'GND', power: true },
                { number: '3', x: 7.62, y: 0, rotation: 180, net: 'SIGNAL' },
            ],
        });
        const result = arrangeSchematicGroups(
            parts,
            { groups: [{ id: 'power', title: 'Power', components: parts.map((p) => p.id) }] },
            'A4',
            { wireLengths: new Map(), pass: 1 },
        );
        const row = parts.slice(1).map((p) => result.positions.get(p.id)!);
        expect(new Set(row.map((p) => p.y)).size).toBe(1);
        expect(new Set(row.map((p) => p.rotation))).toEqual(new Set([0]));
    });
    it('routes around reserved leads without blocking perpendicular crossings', () => {
        const reserved = [
            {
                net: 'POWER',
                points: [
                    { x: 2, y: 0 },
                    { x: 8, y: 0 },
                ],
            },
        ];
        const path = new Router().routeMany(
            [
                {
                    net: 'SIGNAL',
                    clearance: 2,
                    start: { x: 0, y: 1 },
                    end: { x: 10, y: 1 },
                    obstacles: [],
                },
            ],
            reserved,
        )[0];
        const wires = path.slice(1).map((p2, i) => ({ p1: path[i], p2, netName: 'SIGNAL' }));
        expect(() =>
            assertParallelWireSpacing(
                [
                    ...wires,
                    { p1: reserved[0].points[0], p2: reserved[0].points[1], netName: 'POWER' },
                ],
                2,
            ),
        ).not.toThrow();
        expect(path.some((p) => Math.abs(p.y) > 2)).toBe(true);
    });
    it('keeps capabilities as drawing text without changing electrical pin identity', () => {
        const symbol = new KicadSymbol({ name: 'Generic', reference: 'U' });
        symbol.addPin({
            name: 'PA0',
            number: '1',
            x: -5,
            y: 0,
            side: 'left',
            type: 'bidirectional',
            annotation: 'ADC0 / TIM1_CH3',
        });
        const serialized = symbol.serialize();
        expect(serialized).toContain('(name "PA0"');
        expect(serialized).toContain('(text "ADC0 / TIM1_CH3"');
        expect(serialized).toContain('(justify left)');
        expect(Parser.parse(serialized)[0] as SExpr[]).toBeDefined();
    });
});
