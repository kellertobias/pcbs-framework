import { Composable, Component, Net, Schematic } from '@tobisk/pcbs';
import { dividerDrawing, dividerPositions } from './schematic-routing';

// #region block
export class VoltageDivider extends Composable<'supply' | 'midpoint' | 'ground'> {
    constructor() {
        super({ ref: 'DIVIDER' });
    }

    protected defineInterface() {
        const upper = new Component({
            ref: 'R1',
            schematicPosition: dividerPositions.R1,
            symbol: 'Device:R',
            footprint: 'DNC',
            value: '10k',
        });
        const lower = new Component({
            ref: 'R2',
            schematicPosition: dividerPositions.R2,
            symbol: 'Device:R',
            footprint: 'DNC',
            value: '10k',
        });
        const midpoint = new Net({ name: 'MIDPOINT' });
        upper.pins[2].tie(midpoint);
        lower.pins[1].tie(midpoint);
        return { supply: upper.pins[1], midpoint: upper.pins[2], ground: lower.pins[2] };
    }
}
// #endregion block

export class Divider extends Schematic {
    constructor() {
        super({ name: 'Divider', connectionStyle: 'routed', schematicRouting: dividerDrawing });
    }

    // #region connections
    generate() {
        const supply = new Net({ name: 'BATTERY_POSITIVE' });
        const ground = new Net({ name: 'GND', class: 'Power' });
        const battery = new Component({
            ref: 'BT1',
            schematicPosition: dividerPositions.BT1,
            symbol: 'Device:Battery_Cell',
            footprint: 'DNC',
            value: '3 V',
        });
        const divider = new VoltageDivider();
        battery.pins[1].tie(supply);
        battery.pins[2].tie(ground);
        divider.pins.supply.tie(supply);
        divider.pins.ground.tie(ground);
    }
    // #endregion connections
}
export default new Divider();
