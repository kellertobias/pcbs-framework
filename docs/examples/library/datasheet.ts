import { exportDatasheet } from '@tobisk/pcbs';
import { makeFootprint } from './footprint';
import { throughHole } from './pad-variants';

export async function makeDatasheet(output: string) {
    return exportDatasheet({
        title: 'Teaching pad patterns',
        output,
        description:
            'Two generated practice footprints. Dimensions are design inputs, not manufacturer ratings.',
        footprints: [
            { name: 'Rounded SMD pads', footprint: makeFootprint() },
            { name: 'Through-hole pads', footprint: throughHole() },
        ],
        technicalDetails: [{ parameter: 'Pad pitch', value: '6 mm', source: 'Example source' }],
        notes: ['Teaching geometry; no manufacturer part is assigned.'],
    });
}
