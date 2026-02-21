import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { SExpressionParser } from "../kicad/SExpressionParser";
import { SymbolLibrary } from "../kicad/SymbolLibrary";
import { UuidManager } from "../kicad/UuidManager";
import { SchematicGenerator } from "../kicad/SchematicGenerator";
import { CircuitSnapshot } from "../synth/types";
import { Component } from "../synth/Component";
import { Net } from "../synth/Net";

describe("SExpressionParser", () => {
  it("parses basic lists", () => {
    const input = "(a b c)";
    const ast = SExpressionParser.parse(input);
    expect(ast).toEqual([["a", "b", "c"]]);
  });

  it("parses nested lists", () => {
    const input = "(a (b c) d)";
    const ast = SExpressionParser.parse(input);
    expect(ast).toEqual([["a", ["b", "c"], "d"]]);
  });

  it("parses quoted strings", () => {
    const input = '(property "Reference" "R1")';
    const ast = SExpressionParser.parse(input);
    expect(ast).toEqual([["property", '"Reference"', '"R1"']]);
  });

  it("handles whitespace", () => {
    const input = `
      (kicad_sch
        (version 1)
      )
    `;
    const ast = SExpressionParser.parse(input);
    expect(ast).toEqual([["kicad_sch", ["version", "1"]]]);
  });
});

describe("SymbolLibrary", () => {
  const assetsDir = path.join(__dirname, "assets", "symbols");
  const lib = new SymbolLibrary([assetsDir]);

  it("loads a symbol definition", () => {
    const sym = lib.getSymbol("Device:R");
    expect(sym).toBeDefined();
    expect(sym?.name).toBe("R");
    expect(Array.isArray(sym?.definition)).toBe(true);
  });
});

describe("SchematicGenerator", () => {
  const assetsDir = path.join(__dirname, "assets", "symbols");
  const lib = new SymbolLibrary([assetsDir]);
  const uuids = new UuidManager();

  it("generates a schematic with one component and title block", () => {
    // Mock Snapshot
    const comp = {
        symbol: "Device:R",
        ref: "R1",
        value: "10k",
        footprint: "Resistor_SMD:R_0603",
        allPins: new Map(),
        absoluteSchematicPosition: { x: 100, y: 100, rotation: 0 },
    } as any;

    const pin1 = { component: comp, name: "1", net: null, tie: () => {} } as any;
    const pin2 = { component: comp, name: "2", net: null, tie: () => {} } as any;
    comp.allPins.set("1", pin1);
    comp.allPins.set("2", pin2);

    const snapshot: CircuitSnapshot = {
        name: "TestSchematic",
        components: [comp],
        nets: []
    };

    const gen = new SchematicGenerator(snapshot, lib, uuids);
    uuids.set("ROOT", "ROOT");
    const output = gen.generate();

    expect(output).toContain('(kicad_sch');
    expect(output).toContain('(uuid "ROOT"');
    expect(output).toContain('(symbol "R"');
    expect(output).toContain('(lib_id "R")');
    expect(output).toContain('(at 100 100 0)');
    expect(output).toContain('(property "Reference" "R1"');
    expect(output).toContain('(title "TestSchematic")');
  });

  it("generates wires connecting components", () => {
      const c1 = {
          symbol: "Device:R", ref: "R1",
          allPins: new Map(),
          absoluteSchematicPosition: { x: 0, y: 0, rotation: 0 }
      } as any;
      const c2 = {
          symbol: "Device:R", ref: "R2",
          allPins: new Map(),
          absoluteSchematicPosition: { x: 20, y: 0, rotation: 0 }
      } as any;

      const net = { name: "NET1", class: "Signal" } as any;

      const p1 = { component: c1, name: "1", net: net } as any;
      const p2 = { component: c2, name: "1", net: net } as any;

      c1.allPins.set("1", p1);
      c2.allPins.set("1", p2);

      const snapshot: CircuitSnapshot = {
          name: "WireTest",
          components: [c1, c2],
          nets: [net]
      };

      const gen = new SchematicGenerator(snapshot, lib, uuids);
      const output = gen.generate();

      expect(output).toContain('(wire');
      expect(output).toContain('(pts (xy');
  });
});
