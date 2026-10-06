import { describe, expect, it } from 'vitest';
import { Schematic, Net, defineNetClass } from '../synth';
import { circuitNetClasses } from '../synth/NetClasses';

const motor = defineNetClass({ name: 'Motor', width: 0.3, clearance: 0.15 });
class Board extends Schematic {
    generate() {
        new Net({ name: 'VM', class: motor });
        new Net({ name: 'OUT', class: motor });
    }
}
describe('circuit-owned net classes', () => {
    it('derives physical rules and assignments from circuit nets', () => {
        const snapshot = new Board({
            name: 'Board',
            pcb: {
                outline: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                ],
            },
        })._generateWithCapture();
        expect(snapshot.pcb?.netClasses).toEqual([{ ...motor, nets: ['VM', 'OUT'] }]);
        expect(snapshot.nets.map((net) => net.class)).toEqual(['Motor', 'Motor']);
    });
    it('rejects inconsistent same-name definitions before generating PCB rules', () => {
        class Conflict extends Schematic {
            generate() {
                new Net({ name: 'A', class: motor });
                new Net({ name: 'B', class: { ...motor, width: 0.2 } });
            }
        }
        expect(() => new Conflict({ name: 'Board', pcb: {} })._generateWithCapture()).toThrow(
            'Conflicting definitions',
        );
    });
    it('retains physical rules when an implicit signal net absorbs a classified net', () => {
        class Merge extends Schematic {
            generate() {
                const physical = new Net({ name: 'VM', class: motor });
                new Net({ name: 'RENAMED' }).tie(physical);
            }
        }
        const snapshot = new Merge({ name: 'Board', pcb: {} })._generateWithCapture();
        expect(snapshot.pcb?.netClasses).toEqual([{ ...motor, nets: ['RENAMED'] }]);
    });
    it('rejects merging nets with incompatible physical rules', () => {
        class Merge extends Schematic {
            generate() {
                const a = new Net({ name: 'A', class: motor });
                const b = new Net({ name: 'B', class: { ...motor, name: 'Fine', width: 0.1 } });
                a.tie(b);
            }
        }
        expect(() => new Merge({ name: 'Board', pcb: {} })._generateWithCapture()).toThrow(
            'conflicting net classes',
        );
    });
    it('accepts compatible circuit declarations irrespective of property order', () => {
        class Board extends Schematic {
            generate() {
                new Net({ name: 'VM', class: { width: 0.3, clearance: 0.15, name: 'Motor' } });
            }
        }
        const snapshot = new Board({
            name: 'Board',
            netClasses: [motor],
            pcb: {},
        })._generateWithCapture();
        expect(snapshot.pcb?.netClasses).toEqual([{ ...motor, nets: ['VM'] }]);
    });
    it('rejects invalid dimensions', () => {
        expect(() => defineNetClass({ ...motor, width: -0.3 })).toThrow('Invalid');
    });
});
