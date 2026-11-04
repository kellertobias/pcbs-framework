import { Module } from '@tobisk/pcbs';
import { makeFootprint } from './footprint';
import { makeSymbol } from './symbol';

export class TeachingResistor extends Module<'supply' | 'load'> {
    constructor(ref: string) {
        super({
            ref,
            value: '1k',
            symbol: 'Documentation:TeachingResistor',
            footprint: 'Documentation:TeachingPads',
            pins: (pin) => ({ supply: pin(1), load: pin(2) }),
        });
    }
    static makeSymbol() {
        return makeSymbol();
    }
    static makeFootprint() {
        return makeFootprint();
    }
}
