# Component cost metadata

Reusable components can attach a dated supplier quote with `ComponentOptions.cost`:

```ts
new Component({
  ref: "R1",
  symbol: "Device:R",
  footprint: "Resistor_SMD:R_0603_1608Metric",
  partNo: "C25190",
  value: "27",
  cost: {
    unitPrice: 0.0021,
    currency: "USD",
    supplier: "JLCPCB",
    basisQuantity: 1,
    checkedAt: "2026-10-02",
    sourceUrl: "https://jlcpcb.com/partdetail/C25190",
    assemblyClass: "Extended",
    priceBreaks: [
      { quantity: 1, unitPrice: 0.0021 },
      { quantity: 1000, unitPrice: 0.0017 },
    ],
  },
});
```

Prices are in whole currency units, e.g. USD dollars, rather than cents.
`unitPrice` is the quote at `basisQuantity`; each break is a minimum purchased
quantity of that part number. `componentUnitCost(component.cost, quantity)`
selects the applicable break. Sum matching part numbers across the entire batch
before choosing a tier, including any spare/attrition quantities. Missing costs
or quantities below every quoted tier return `undefined`, never zero. A quote
without breaks applies from its `basisQuantity` upward.

The component registry retains the structured quote. KiCad schematic and netlist
generation emits `Cost_Unit_Price`, `Cost_Currency`, `Cost_Supplier`,
`Cost_Basis_Quantity`, `Cost_Checked_At`, `Cost_Source_URL`, `Cost_Assembly_Class`
and `Cost_Price_Breaks` (JSON). Schematic cost fields are hidden. Components with
no cost emit no cost fields.

The current JLCPCB upload BOM remains its existing four-column CSV. A future
cost-BOM exporter can read `Component.cost` or these KiCad fields. It must keep
currencies separate, report missing prices, and calculate quantity tiers per
part number rather than per designator. Supplier unit prices exclude assembly,
setup/loading charges, PCB manufacture, shipping and taxes. `assemblyClass`
describes a supplier catalog class; it is not a monetary setup fee.
