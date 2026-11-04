import { componentUnitCost, exportDatasheet } from '@tobisk/pcbs';
import { makeFootprint } from './footprint';

export async function makeQuoteSheet(output: string) {
    // Illustrative inputs for the example, not a current supplier quotation.
    const quote = {
        supplier: 'Illustrative inputs',
        checkedAt: '2026-11-04',
        sourceUrl:
            'https://github.com/kellertobias/pcbs-framework/blob/main/docs/examples/library/cost.ts',
        currency: 'USD',
        unitPrice: 0.01,
        basisQuantity: 1,
        priceBreaks: [
            { quantity: 1, unitPrice: 0.01 },
            { quantity: 1000, unitPrice: 0.006 },
        ],
    };
    return exportDatasheet({
        title: 'Illustrative resistor quote',
        output,
        footprints: [{ name: 'Teaching pad pattern', footprint: makeFootprint() }],
        sections: [
            {
                title: 'Quantity price selection',
                rows: [1, 100, 1000].map((quantity) => ({
                    parameter: `${quantity} parts`,
                    value: `${componentUnitCost(quote, quantity)} USD per part`,
                    source: 'Example inputs',
                })),
            },
        ],
        notes: ['Illustrative prices only. Assembly charges are not included.'],
    });
}
