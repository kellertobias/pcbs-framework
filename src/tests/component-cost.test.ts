import { describe, expect, it } from 'vitest';
import { Component } from '../synth/Component';
import { componentCostFields, componentUnitCost } from '../synth/ComponentCost';
import type { ComponentCost } from '../synth/types';

const cost: ComponentCost = {
    unitPrice: 0.0021,
    currency: 'USD',
    supplier: 'JLCPCB',
    basisQuantity: 1,
    checkedAt: '2026-10-02',
    sourceUrl: 'https://jlcpcb.com/partdetail/C25190',
    assemblyClass: 'Extended',
    // Deliberately unsorted, to ensure selection does not depend on supplier order.
    priceBreaks: [
        { quantity: 1000, unitPrice: 0.0017 },
        { quantity: 1, unitPrice: 0.0021 },
    ],
};

describe('component cost quotes', () => {
    it('retains supplier metadata on components and serializes currency and price tiers', () => {
        const component = new Component({
            symbol: 'Device:R',
            footprint: 'Resistor_SMD:R_0603_1608Metric',
            ref: 'R1',
            cost,
        });
        expect(component.cost).toEqual(cost);
        const fields = componentCostFields(component.cost);
        expect(fields.Cost_Unit_Price).toBe('0.0021');
        expect(fields.Cost_Currency).toBe('USD');
        expect(fields.Cost_Checked_At).toBe('2026-10-02');
        expect(JSON.parse(fields.Cost_Price_Breaks)).toEqual(cost.priceBreaks);
    });

    it('selects tiers using the total purchased part quantity and preserves unknown prices', () => {
        expect(componentUnitCost(cost, 999)).toBe(0.0021);
        expect(componentUnitCost(cost, 1000)).toBe(0.0017);
        expect(componentUnitCost(undefined, 1000)).toBeUndefined();
        expect(componentCostFields()).toEqual({});
        expect(() => componentUnitCost(cost, 0)).toThrow('positive integer');
        expect(() => componentUnitCost(cost, 1.5)).toThrow('positive integer');
        expect(
            componentUnitCost({ ...cost, basisQuantity: 100, priceBreaks: undefined }, 99),
        ).toBeUndefined();
    });
});
