import { KicadSymbol } from '@tobisk/pcbs';

export function makeSymbol() {
    const symbol = new KicadSymbol({
        name: 'TeachingResistor',
        reference: 'R',
        value: 'Teaching resistor',
    });
    symbol.addRect({ x1: -2.54, y1: 1.27, x2: 2.54, y2: -1.27 });
    symbol.addPin({
        name: 'A',
        number: '1',
        x: -5.08,
        y: 0,
        side: 'left',
        type: 'passive',
        length: 2.54,
    });
    symbol.addPin({
        name: 'B',
        number: '2',
        x: 5.08,
        y: 0,
        side: 'right',
        type: 'passive',
        length: 2.54,
    });
    return symbol;
}
