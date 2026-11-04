import type { SchematicRoutingOptions } from '@tobisk/pcbs';

export const schematicPositions = {
    BT1: { x: 50.8, y: 60.96 },
    R1: { x: 76.2, y: 45.72, rotation: 90 },
    D1: { x: 101.6, y: 60.96, rotation: 90 },
};

export const schematicRouting: SchematicRoutingOptions = {
    compactFields: true,
    powerSymbols: { GND: 'power:GND' },
    fields: {
        D1: {
            reference: { x: 119.38, y: 58.42 },
            value: { x: 119.38, y: 63.5 },
            justify: 'left',
        },
    },
    annotations: [{ text: 'COIN-CELL LED', x: 50.8, y: 35.56, size: 2, bold: true }],
};
