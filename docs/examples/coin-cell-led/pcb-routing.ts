import type { PcbOptions, PcbPosition } from '@tobisk/pcbs';

export const pcbPositions: Record<string, PcbPosition> = {
    BT1: { x: 75, y: 60 },
    R1: { x: 63, y: 79 },
    D1: { x: 80, y: 79 },
};

export const pcbOptions: PcbOptions = {
    requireAllPlaced: true,
    autoRoute: { backend: 'grid' },
    outline: [
        { x: 50, y: 42 },
        { x: 100, y: 42 },
        { x: 100, y: 86 },
        { x: 50, y: 86 },
    ],
    netClasses: [
        {
            name: 'Default',
            nets: ['BATTERY_POSITIVE', 'LED_ANODE', 'GND'],
            width: 0.3,
            clearance: 0.2,
            viaDiameter: 0.6,
            viaDrill: 0.3,
        },
    ],
    zones: [
        {
            id: 'front-ground',
            net: 'GND',
            layer: 'F.Cu',
            boardInset: 0.5,
            clearance: 0.2,
            thermalGap: 0.3,
            thermalBridgeWidth: 0.3,
        },
        {
            id: 'ground',
            net: 'GND',
            layer: 'B.Cu',
            boardInset: 0.5,
            clearance: 0.2,
            thermalGap: 0.3,
            thermalBridgeWidth: 0.3,
        },
    ],
};
