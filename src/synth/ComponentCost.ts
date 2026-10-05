import type { ComponentCost } from './types';

/** Select by total purchased quantity of this part number, across all boards. */
export function componentUnitCost(
    cost: ComponentCost | undefined,
    quantity: number,
): number | undefined {
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
        throw new Error('Cost quantity must be a positive integer');
    }
    if (!cost) return undefined;
    const tiers = cost.priceBreaks ?? [{ quantity: cost.basisQuantity, unitPrice: cost.unitPrice }];
    let selected: { quantity: number; unitPrice: number } | undefined;
    for (const tier of tiers) {
        if (tier.quantity <= quantity && (!selected || tier.quantity > selected.quantity)) {
            selected = tier;
        }
    }
    return selected?.unitPrice;
}

/** Preserve the complete quote in hidden KiCad fields for later BOM tooling. */
export function componentCostFields(cost?: ComponentCost): Record<string, string> {
    if (!cost) return {};
    return {
        Cost_Unit_Price: String(cost.unitPrice),
        Cost_Currency: cost.currency,
        Cost_Supplier: cost.supplier,
        Cost_Basis_Quantity: String(cost.basisQuantity),
        Cost_Checked_At: cost.checkedAt,
        Cost_Source_URL: cost.sourceUrl,
        Cost_Assembly_Class: cost.assemblyClass ?? 'Unknown',
        Cost_Price_Breaks: JSON.stringify(cost.priceBreaks ?? []),
    };
}
