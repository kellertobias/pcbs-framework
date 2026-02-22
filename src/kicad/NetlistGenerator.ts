import { CircuitSnapshot, Pin } from "../synth/types";
import { Component } from "../synth/Component";
import { Net } from "../synth/Net";
import { SymbolLibrary, SymbolDefinition } from "./SymbolLibrary";
import { SExpr, SExpressionParser } from "./SExpressionParser";
import { UuidManager } from "./UuidManager";

export class NetlistGenerator {
  private snapshot: CircuitSnapshot;
  private library: SymbolLibrary;
  private uuids: UuidManager;
  private usedSymbols = new Map<string, SymbolDefinition>();

  constructor(snapshot: CircuitSnapshot, library: SymbolLibrary, uuids: UuidManager) {
    this.snapshot = snapshot;
    this.library = library;
    this.uuids = uuids;
  }

  generate(): string {
    const rootUuid = this.uuids.getOrGenerate("ROOT");

    const netlist: SExpr[] = [
      "export",
      ["version", "D"],
      ["design",
        ["source", this.snapshot.name],
        ["date", new Date().toISOString()],
        ["tool", "pcb-framework"]
      ],
      this.generateComponents(),
      this.generateLibParts(),
      this.generateLibraries(),
      this.generateNets()
    ];

    return SExpressionParser.serialize(netlist);
  }

  private generateComponents(): SExpr {
    const components: SExpr[] = ["components"];
    for (const comp of this.snapshot.components) {
      if (comp.symbol === "Device:DNC") continue;

      const symName = comp.symbol;
      const uuid = this.uuids.getOrGenerate(comp.ref);

      // Collect symbol for libparts later
      const symDef = this.library.getSymbol(comp.symbol);
      if (symDef) {
        this.addSymbol(symDef);
      }

      components.push([
        "comp",
        ["ref", this.quote(comp.ref)],
        ["value", this.quote(comp.value || symName)],
        ["footprint", this.quote(comp.footprint || "")],
        ["libsource", ["lib", '"Lib"'], ["part", this.quote(symName)], ["description", this.quote(comp.description || "")]],
        ["sheetpath", ["names", "/"], ["tstamps", "/"]],
        ["tstamps", this.quote(uuid)]
      ]);
    }
    return components;
  }

  private generateLibParts(): SExpr {
    const libparts: SExpr[] = ["libparts"];
    for (const symDef of this.usedSymbols.values()) {
      const parts = this.extractLibPart(symDef);
      if (parts) {
        libparts.push(parts);
      }
    }
    return libparts;
  }

  private extractLibPart(symDef: SymbolDefinition): SExpr | null {
    const pins: SExpr[] = ["pins"];
    const foundPins = new Set<string>();

    const scan = (expr: SExpr) => {
      if (!Array.isArray(expr)) return;
      for (const item of expr) {
        if (Array.isArray(item) && item[0] === "symbol") {
          scan(item);
        } else if (Array.isArray(item) && item[0] === "pin") {
          const nameItem = item.find(i => Array.isArray(i) && i[0] === "name") as SExpr[];
          const numItem = item.find(i => Array.isArray(i) && i[0] === "number") as SExpr[];
          const type = item[1] as string;

          if (nameItem && numItem && numItem[1]) {
            const num = SExpressionParser.unquote(numItem[1] as string);
            const name = nameItem[1] ? SExpressionParser.unquote(nameItem[1] as string) : num;

            if (!foundPins.has(num)) {
              foundPins.add(num);
              pins.push([
                "pin",
                ["num", this.quote(num)],
                ["name", this.quote(name)],
                ["type", type]
              ]);
            }
          }
        }
      }
    };

    scan(symDef.definition);
    for (const dep of symDef.dependencies) {
      scan(dep);
    }

    return [
      "libpart",
      ["lib", '"Lib"'],
      ["part", this.quote(symDef.name)],
      ["description", '""'],
      ["fields", ["field", ["name", '"Reference"'], '"U"']],
      pins
    ];
  }

  private generateLibraries(): SExpr {
    const libraries: SExpr[] = ["libraries"];
    libraries.push(["library", ["logical", "Lib"], ["uri", ""]]);
    return libraries;
  }

  private generateNets(): SExpr {
    const nets: SExpr[] = ["nets"];
    let code = 1;

    const pinMap = new Map<Pin, Component<any>>();
    for (const comp of this.snapshot.components) {
      if (comp.symbol === "Device:DNC") continue;
      for (const [name, pin] of comp.allPins) {
        pinMap.set(pin as Pin, comp);
      }
    }

    const processedNets = new Set<Net>();

    const allNets = new Set<Net>(this.snapshot.nets);
    for (const comp of this.snapshot.components) {
      for (const [_, pin] of comp.allPins) {
        if (pin.net) allNets.add(pin.net);
      }
    }

    for (const net of allNets) {
      if (processedNets.has(net)) continue;
      processedNets.add(net);

      const nodes: SExpr[] = [];

      for (const [pin, comp] of pinMap) {
        if (pin.net === net) {
          nodes.push(["node", ["ref", this.quote(comp.ref)], ["pin", this.quote(pin.name)]]);
        }
      }

      nets.push([
        "net",
        ["code", code.toString()],
        ["name", this.quote(net.name)],
        ...nodes
      ]);
      code++;
    }

    return nets;
  }

  private addSymbol(symDef: SymbolDefinition) {
    if (this.usedSymbols.has(symDef.name)) return;
    this.usedSymbols.set(symDef.name, symDef);
  }

  private quote(s: string): string {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
}
