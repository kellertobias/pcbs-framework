import { describe, expect, it } from 'vitest';
import { Component } from '../synth/Component';
import { Schematic } from '../synth/Schematic';
import { schematicGroup } from '../synth/SchematicGroup';

class GroupedBoard extends Schematic {
    constructor() {
        super({ name: 'decorated', schematicRouting: { compactFields: true } });
    }
    generate() {
        this.power();
        this.motor();
    }
    @schematicGroup({ id: 'power', title: 'Power', notes: [{ text: 'Local bypass', bold: true }] })
    power() {
        this.regulator();
        new Component({ ref: 'C1', symbol: 'Device:C', footprint: 'DNC' });
        new Component({ ref: 'DNC_U1_4', symbol: 'Device:DNC', footprint: 'DNC' });
        return 42;
    }
    @schematicGroup({ id: 'regulator', title: 'Regulator' })
    regulator() {
        new Component({ ref: 'U1', symbol: 'Device:R', footprint: 'DNC' });
    }
    @schematicGroup({ id: 'motor', title: 'Motor', nodes: ['RV1/2'] })
    motor() {
        new Component({ ref: 'RV1', symbol: 'Device:R', footprint: 'DNC' });
    }
}

describe('schematicGroup method decorator', () => {
    it('captures new components, excludes nested groups and accepts explicit drawing units', () => {
        const board = new GroupedBoard();
        const first = board._generateWithCapture();
        expect(first.schematicRouting?.compactFields).toBe(true);
        expect(first.schematicRouting?.autoLayout?.groups).toEqual([
            {
                id: 'power',
                title: 'Power',
                notes: [{ text: 'Local bypass', bold: true }],
                components: ['C1'],
            },
            { id: 'regulator', title: 'Regulator', components: ['U1'] },
            { id: 'motor', title: 'Motor', components: ['RV1/2'] },
        ]);
        expect(board._generateWithCapture().schematicRouting).toEqual(first.schematicRouting);
        expect(new GroupedBoard()._generateWithCapture().schematicRouting).toEqual(
            first.schematicRouting,
        );
    });
    it('rejects use outside generation and duplicate group ids without poisoning the next capture', () => {
        const board = new GroupedBoard();
        expect(() => board.power()).toThrow('inside generate');
        board.generate = () => {
            board.power();
            board.power();
        };
        expect(() => board._generateWithCapture()).toThrow('Duplicate schematic group');
        board.generate = () => {
            board.power();
        };
        expect(board._generateWithCapture().components).toHaveLength(3);
    });
    it('preserves a decorated method return value', () => {
        const board = new GroupedBoard();
        board.generate = () => {
            expect(board.power()).toBe(42);
        };
        board._generateWithCapture();
    });
    it('rejects invalid decorator definitions', () => {
        expect(() => schematicGroup({ id: '', title: 'Power' })).toThrow('non-empty');
    });
});
