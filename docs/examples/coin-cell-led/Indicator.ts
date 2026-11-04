import { Component, Net, Schematic } from '@tobisk/pcbs';
import { pcbOptions, pcbPositions } from './pcb-routing';
import { schematicPositions, schematicRouting } from './schematic-routing';

export class Indicator extends Schematic {
    constructor() {
        super({
            name: 'Indicator',
            description: 'Coin-cell LED documentation example',
            connectionStyle: 'routed',
            schematicRouting,
            pcb: pcbOptions,
        });
    }

    // #region circuit
    generate() {
        const batteryPositive = new Net({ name: 'BATTERY_POSITIVE' });
        const ledAnode = new Net({ name: 'LED_ANODE' });
        const ground = new Net({ name: 'GND', class: 'Power' });
        const battery = new Component({
            ref: 'BT1',
            value: 'CR2032, 3V',
            symbol: 'Device:Battery_Cell',
            footprint: 'Battery:BatteryHolder_Keystone_1060_1x2032',
            pins: (pin) => ({ positive: pin(1), negative: pin(2) }),
            pcbPosition: pcbPositions.BT1,
            schematicPosition: schematicPositions.BT1,
        });
        const resistor = new Component({
            ref: 'R1',
            value: '1k',
            symbol: 'Device:R',
            footprint: 'Resistor_SMD:R_0805_2012Metric',
            pins: (pin) => ({ supply: pin(1), load: pin(2) }),
            pcbPosition: pcbPositions.R1,
            schematicPosition: schematicPositions.R1,
        });
        const led = new Component({
            ref: 'D1',
            value: 'Red LED',
            symbol: 'Device:LED',
            footprint: 'LED_THT:LED_D5.0mm',
            pins: (pin) => ({ cathode: pin(1), anode: pin(2) }),
            pcbPosition: pcbPositions.D1,
            schematicPosition: schematicPositions.D1,
        });
        battery.pins.positive.tie(batteryPositive);
        resistor.pins.supply.tie(batteryPositive);
        resistor.pins.load.tie(ledAnode);
        led.pins.anode.tie(ledAnode);
        led.pins.cathode.tie(ground);
        battery.pins.negative.tie(ground);
    }
    // #endregion circuit
}

export default new Indicator();
