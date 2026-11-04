import { KicadFootprint } from '@tobisk/pcbs';

export function makeFootprint() {
    const footprint = new KicadFootprint({ name: 'TeachingPads', attr: 'smd' });
    footprint.addRect({ x1: -2, y1: -1, x2: 2, y2: 1, layer: 'F.SilkS', width: 0.15 });
    for (const [number, x] of [
        ['1', -3],
        ['2', 3],
    ] as const) {
        footprint.addPad({
            number,
            x,
            y: 0,
            width: 2,
            height: 2,
            type: 'smd',
            shape: 'roundrect',
            roundrectRatio: 0.25,
            layers: ['F.Cu', 'F.Paste', 'F.Mask'],
        });
    }
    return footprint;
}
