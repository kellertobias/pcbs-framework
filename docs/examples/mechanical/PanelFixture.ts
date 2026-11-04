import { Component, KicadFootprint, Schematic, type FrontPanelInterface } from '@tobisk/pcbs';
import { fixturePcb, fixturePosition } from './pcb-routing';

// A mechanical interface fixture with no electrical contacts.
export const face: FrontPanelInterface = {
    facing: 'bottom',
    anchor: { x: 0, y: 0, z: 10 },
    cutouts: [
        { type: 'circle', diameter: 5.4 },
        { type: 'circle', x: -20, diameter: 3.2 },
        { type: 'circle', x: 20, diameter: 3.2 },
    ],
    labelAnchors: { above: { x: 0, y: 8, fontSize: 3 } },
};

export function makeFixtureFootprint() {
    return new KicadFootprint({ name: 'PanelMarker' }).addRect({
        x1: -21,
        y1: -1,
        x2: 21,
        y2: 1,
        layer: 'F.SilkS',
        width: 0.15,
    });
}

export class PanelFixture extends Schematic {
    constructor() {
        super({ name: 'PanelFixture', pcb: fixturePcb });
    }
    generate() {
        new Component({
            ref: 'MP1',
            value: 'Mechanical face',
            symbol: 'Mechanical:Heatsink',
            footprint: 'Documentation:PanelMarker',
            frontPanelInterface: face,
            pcbPosition: fixturePosition,
        });
    }
}
export default new PanelFixture();
