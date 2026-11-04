import { Schematic } from '@tobisk/pcbs';
import indicator from '../coin-cell-led/Indicator';
import { compositionPcb, noPourPcb } from './pcb-routing';

// #region no-pour
export function noPourBoard() {
    const snapshot = indicator._generateWithCapture();
    snapshot.name = 'NoPourIndicator';
    snapshot.pcb = noPourPcb;
    return snapshot;
}
// #endregion no-pour

// #region repeat
export class RepeatedIndicators extends Schematic {
    constructor(private readonly sourcePcb: string) {
        super({ name: 'RepeatedIndicators', pcb: compositionPcb });
    }
    generate() {
        this.addBoard(indicator, {
            id: 'left',
            sourcePcb: this.sourcePcb,
            origin: { x: 50, y: 42 },
            x: 10,
            y: 10,
        });
        this.addBoard(indicator, {
            id: 'right',
            sourcePcb: this.sourcePcb,
            origin: { x: 50, y: 42 },
            x: 70,
            y: 10,
        });
    }
}
// #endregion repeat
