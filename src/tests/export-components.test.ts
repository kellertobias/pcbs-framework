import { describe, it, expect } from 'vitest';
import { Schematic } from '../synth/Schematic';
import { Component } from '../synth/Component';
import { exportComponents } from '../cli/utils/export-components';
class Unit extends Schematic {
    generate() {
        new Component({
            ref: 'H1',
            symbol: 'Mechanical:MountingHole',
            footprint: 'MountingHole:MountingHole_3.2mm_M3',
        });
        new Component({
            ref: 'JP1',
            symbol: 'Jumper:SolderJumper_3_Bridged12',
            footprint: 'Jumper:SolderJumper-3_P1.3mm_Bridged12_Pad1.0x1.5mm',
        });
        new Component({
            ref: 'R1',
            symbol: 'Device:R',
            value: '10k',
            partNo: 'C25804',
            footprint: 'Resistor_SMD:R_0603_1608Metric',
        });
    }
}
describe('panel manufacturing references', () => {
    it('matches all board-prefixed references without modifying shared source parts', () => {
        const unit = new Unit({ name: 'unit' });
        class Panel extends Schematic {
            generate() {
                this.addBoard(unit, { id: 'left', x: 0, y: 0 });
                this.addBoard(unit, { id: 'right', x: 30, y: 0 });
            }
        }
        const snapshot = new Panel({ name: 'panel' })._generateWithCapture();
        const exported = exportComponents(snapshot);
        expect(exported.map((c) => c.ref)).toEqual(['left_R1', 'right_R1']);
        expect(exported.map((c) => c.partNo)).toEqual(['C25804', 'C25804']);
        expect(
            snapshot.boards!.map((b) => b.snapshot.components.find((c) => c.ref === 'R1')!.ref),
        ).toEqual(['R1', 'R1']);
    });
});
