import { KicadFootprint } from '@tobisk/pcbs';

// #region through-hole
export function throughHole() {
    const footprint = new KicadFootprint({ name: 'ThroughHolePair', attr: 'through_hole' });
    footprint.addRect({ x1: -4.5, y1: -2, x2: 4.5, y2: 2, layer: 'F.SilkS', width: 0.15 });
    for (const [number, x] of [
        ['1', -3],
        ['2', 3],
    ] as const) {
        footprint.addPad({
            number,
            x,
            y: 0,
            width: 2.4,
            height: 2.4,
            drill: 1,
            type: 'thru_hole',
            shape: number === '1' ? 'rect' : 'circle',
            layers: ['*.Cu', '*.Mask'],
        });
    }
    return footprint;
}
// #endregion through-hole

// #region slot
export function slottedPad() {
    const footprint = new KicadFootprint({ name: 'SlottedPad', attr: 'through_hole' });
    footprint.addPad({
        number: '1',
        x: 0,
        y: 0,
        width: 5,
        height: 3,
        drill: { x: 3, y: 1 },
        type: 'thru_hole',
        shape: 'oval',
        layers: ['*.Cu', '*.Mask'],
    });
    return footprint;
}
// #endregion slot
