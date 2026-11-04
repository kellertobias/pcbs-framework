import path from 'node:path';
import { PcbPanel, PcbProject } from '@tobisk/pcbs';
import { panelPcb } from './pcb-routing';

export default new PcbPanel({
    name: 'Production',
    project: new PcbProject(path.resolve(__dirname, '..')),
    pcb: panelPcb,
    boards: [
        { id: 'first', schematic: 'indicator', origin: { x: 50, y: 42 }, x: 10, y: 10 },
        { id: 'second', schematic: 'indicator', origin: { x: 50, y: 42 }, x: 70, y: 10 },
    ],
});
