import { Component, Net, Schematic, schematicGroup } from '@tobisk/pcbs';
import { groupedDrawing } from './schematic-routing';

export class GroupedIndicator extends Schematic {
    private supply!: Net;
    private ground!: Net;

    constructor() {
        super({
            name: 'GroupedIndicator',
            connectionStyle: 'routed',
            schematicRouting: groupedDrawing,
        });
    }

    generate() {
        this.supply = new Net({ name: 'BATTERY_POSITIVE', class: 'Power' });
        this.ground = new Net({ name: 'GND', class: 'Power' });
        this.addBattery();
        this.addLamp();
    }

    // #region groups
    @schematicGroup({ id: 'battery', title: 'BATTERY', notes: ['Local 3 V coin cell'] })
    private addBattery() {
        const battery = new Component({
            ref: 'BT1',
            symbol: 'Device:Battery_Cell',
            footprint: 'DNC',
            value: '3V',
        });
        battery.pins[1].tie(this.supply);
        battery.pins[2].tie(this.ground);
    }

    @schematicGroup({ id: 'lamp', title: 'INDICATOR', notes: ['Resistor limits LED current'] })
    private addLamp() {
        const anode = new Net({ name: 'LED_ANODE' });
        const resistor = new Component({
            ref: 'R1',
            symbol: 'Device:R',
            footprint: 'DNC',
            value: '1k',
        });
        const led = new Component({
            ref: 'D1',
            symbol: 'Device:LED',
            footprint: 'DNC',
            value: 'Red LED',
        });
        resistor.pins[1].tie(this.supply);
        resistor.pins[2].tie(anode);
        led.pins[2].tie(anode);
        led.pins[1].tie(this.ground);
    }
    // #endregion groups
}

export default new GroupedIndicator();
