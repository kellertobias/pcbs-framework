import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
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

  it("formats title_block multiline", () => {
    const expr = ["title_block", ["title", '"Test"'], ["date", '"2024"']];
    const output = SExpressionParser.serialize(expr);
    expect(output).toBe('(title_block (title "Test") (date "2024"))');
  });
});

describe("SymbolLibrary", () => {
  const assetsDir = path.join(__dirname, "assets", "symbols");
  const lib = new SymbolLibrary([assetsDir]);

  it("loads a symbol definition", () => {
    const sym = lib.getSymbol("Device:R");
    expect(sym).toBeDefined();
    expect(sym?.name).toBe("Device:R");
    expect(Array.isArray(sym?.definition)).toBe(true);
  });
});

describe("SchematicGenerator", () => {
  const assetsDir = path.join(__dirname, "assets", "symbols");
  const lib = new SymbolLibrary([assetsDir]);
  const uuids = new UuidManager();

  it("generates a schematic with one component and quoted title block", () => {
    // Mock Snapshot
    const comp = {
      symbol: "Device:R",
      ref: "R1",
      value: "10k",
      footprint: "Resistor_SMD:R_0603",
      allPins: new Map(),
      absoluteSchematicPosition: { x: 100, y: 100, rotation: 0 },
    } as any;

    const pin1 = { component: comp, name: "1", net: null, tie: () => { } } as any;
    const pin2 = { component: comp, name: "2", net: null, tie: () => { } } as any;
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
    expect(output).toContain('    (symbol "Device:R"');
    expect(output).toContain('  (symbol\n    (lib_id "Device:R")');
    expect(output).toContain('    (at 100.00 100.00 0.00)');
    expect(output).toContain('(property "Reference" "R1"');

    // Check title block
    expect(output).toContain('(title_block (title "TestSchematic")');
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

    expect(output).toContain('  (wire\n    (pts\n      (xy 0 3.81)\n      (xy 20 3.81)');
  });

  it("handles symbol inheritance (extends)", () => {
    // Create a temporary library file with inheritance
    const tempLibDir = path.join(__dirname, "temp_lib");
    if (!fs.existsSync(tempLibDir)) fs.mkdirSync(tempLibDir);

    const libContent = `(kicad_symbol_lib (version 20211014) (generator kicad_symbol_editor)
  (symbol "Parent" (pin_names (offset 1.016)) (in_bom yes) (on_board yes)
    (property "Reference" "U" (id 0) (at 0 0 0) (effects (font (size 1.27 1.27))))
    (symbol "Parent_1_1"
      (pin input line (at -5.08 0 0) (length 2.54) (name "In" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
    )
  )
  (symbol "Child" (extends "Parent")
    (property "Value" "Child" (id 1) (at 0 0 0) (effects (font (size 1.27 1.27))))
  )
)`;
    fs.writeFileSync(path.join(tempLibDir, "TestLib.kicad_sym"), libContent);

    const customLib = new SymbolLibrary([tempLibDir]);

    // Use "Child" component
    const comp = {
      symbol: "TestLib:Child",
      ref: "U1",
      value: "Child",
      footprint: "",
      allPins: new Map(),
      absoluteSchematicPosition: { x: 0, y: 0, rotation: 0 },
    } as any;

    const snapshot: CircuitSnapshot = {
      name: "InheritanceTest",
      components: [comp],
      nets: []
    };

    const gen = new SchematicGenerator(snapshot, customLib, uuids);
    const output = gen.generate();

    // Clean up
    fs.rmSync(tempLibDir, { recursive: true, force: true });

    // Check if both symbols are present in lib_symbols
    expect(output).toContain('    (symbol "TestLib:Child"');
    expect(output).toContain('      (property "Value" "Child"');
    expect(output).toContain('      (symbol "Child_1_1"');

    // Verify order: Parent must come before Child
    const parentIndex = output.indexOf('(symbol "Parent"');
    const childIndex = output.indexOf('(symbol "TestLib:Child"');
    expect(parentIndex).toBeLessThan(childIndex);
  });
});
