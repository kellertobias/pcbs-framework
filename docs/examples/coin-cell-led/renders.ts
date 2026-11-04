import { defineRenderSeries } from '@tobisk/pcbs';

export default defineRenderSeries({
    board: '../../../.cache/docs-examples/Indicator.kicad_pcb',
    outputDirectory: '../../public/examples',
    renders: [
        {
            name: 'indicator-front',
            kind: 'layers',
            layers: ['F.Cu', 'F.SilkS', 'Edge.Cuts'],
            width: 1400,
        },
        {
            name: 'indicator-back',
            kind: 'layers',
            side: 'bottom',
            layers: ['B.Cu', 'B.SilkS', 'Edge.Cuts'],
            width: 1400,
        },
        {
            name: 'indicator-3d',
            kind: '3d',
            rotate: [-30, 0, 20],
            zoom: 0.8,
            width: 1600,
            height: 1100,
        },
    ],
});
