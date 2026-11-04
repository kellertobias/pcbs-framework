import { pcbOptions } from '../coin-cell-led/pcb-routing';

export const noPourPcb = { ...pcbOptions, zones: [] };

export const panelPcb = {
    fiducials: [{ id: 'datum', at: { x: 4, y: 4 } }],
};

export const compositionPcb = { autoRoute: false } as const;
