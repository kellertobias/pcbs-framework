import type { PcbOptions } from '@tobisk/pcbs';

export const fixturePosition = { x: 25, y: 10 };
export const fixturePcb: PcbOptions = {
    requireAllPlaced: true,
    outline: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 20 },
        { x: 0, y: 20 },
    ],
};
