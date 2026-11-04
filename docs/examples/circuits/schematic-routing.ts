import type { SchematicRoutingOptions } from '@tobisk/pcbs';

export const groupedDrawing: SchematicRoutingOptions = {
    compactFields: true,
    autoLayout: { algorithm: 'circuit', groups: [] },
    powerSymbols: { GND: 'power:GND', BATTERY_POSITIVE: 'power:+BATT' },
};

export const dividerPositions = {
    BT1: { x: 50.8, y: 60.96 },
    R1: { x: 76.2, y: 48.26 },
    R2: { x: 76.2, y: 86.36 },
};

export const dividerDrawing: SchematicRoutingOptions = {
    compactFields: true,
    powerSymbols: { GND: 'power:GND' },
    annotations: [{ text: 'BATTERY DIVIDER', x: 50.8, y: 25.4, size: 2, bold: true }],
};
