import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { KicadFootprint } from "../synth/KicadFootprint";
import { KicadSymbol } from "../synth/KicadSymbol";
import { KicadLibrary } from "../synth/KicadLibrary";

// ─── KicadFootprint ──────────────────────────────────────────────────

describe("KicadFootprint", () => {
  it("generates minimal footprint boilerplate", () => {
    const fp = new KicadFootprint({ name: "TestPart" });
    const out = fp.serialize();

    expect(out).toContain('(footprint "TestPart"');
    expect(out).toContain("(version 20241229)");
    expect(out).toContain('(generator "pcb_framework")');
    expect(out).toContain('(layer "F.Cu")');
    expect(out).toContain('(property "Reference" "REF**"');
    expect(out).toContain('(property "Value" "TestPart"');
    expect(out).toContain("(attr smd)");
    expect(out).toContain("(embedded_fonts no)");
  });

  it("supports through_hole attribute", () => {
    const fp = new KicadFootprint({ name: "TH_Part", attr: "through_hole" });
    expect(fp.serialize()).toContain("(attr through_hole)");
  });

  it("serializes SMD pads with roundrect shape", () => {
    const fp = new KicadFootprint({ name: "Test" });
    fp.addPad({
      number: "1",
      type: "smd",
      shape: "roundrect",
      x: -5,
      y: 0,
      width: 3,
      height: 1.5,
      roundrectRatio: 0.15,
    });

    const out = fp.serialize();
    expect(out).toContain('(pad "1" smd roundrect');
    expect(out).toContain("(at -5 0)");
    expect(out).toContain("(size 3 1.5)");
    expect(out).toContain('"F.Cu"');
    expect(out).toContain('"F.Mask"');
    expect(out).toContain('"F.Paste"');
    expect(out).toContain("(roundrect_rratio 0.15)");
  });

  it("serializes through-hole pads with drill", () => {
    const fp = new KicadFootprint({ name: "Test" });
    fp.addPad({
      number: "1",
      type: "thru_hole",
      shape: "circle",
      x: 0,
      y: 0,
      width: 1.8,
      height: 1.8,
      drill: 1.0,
    });

    const out = fp.serialize();
    expect(out).toContain("thru_hole circle");
    expect(out).toContain("(drill 1)");
    expect(out).toContain('"*.Cu"');
    expect(out).toContain('"*.Mask"');
  });

  it("serializes through-hole pads with drill offset", () => {
    const fp = new KicadFootprint({ name: "Test" });
    fp.addPad({
      number: "1",
      type: "thru_hole",
      shape: "oval",
      x: 0,
      y: 0,
      width: 2.4,
      height: 1.6,
      drill: 1.0,
      drillOffsetX: 0.5,
      drillOffsetY: -0.3,
    });

    const out = fp.serialize();
    expect(out).toContain("(drill 1 (offset 0.5 -0.3))");
  });

  it("does not emit offset when only drill is set", () => {
    const fp = new KicadFootprint({ name: "Test" });
    fp.addPad({
      number: "1",
      type: "thru_hole",
      shape: "circle",
      x: 0,
      y: 0,
      width: 1.8,
      height: 1.8,
      drill: 1.0,
    });

    const out = fp.serialize();
    expect(out).toContain("(drill 1)");
    expect(out).not.toContain("offset");
  });

  it("serializes custom layers on pads", () => {
    const fp = new KicadFootprint({ name: "Test" });
    fp.addPad({
      number: "1",
      type: "smd",
      shape: "rect",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      layers: ["B.Cu", "B.Mask"],
    });

    const out = fp.serialize();
    expect(out).toContain('"B.Cu" "B.Mask"');
  });

  it("serializes silkscreen lines", () => {
    const fp = new KicadFootprint({ name: "Test" });
    fp.addLine({ x1: -10, y1: -5, x2: 10, y2: -5 });

    const out = fp.serialize();
    expect(out).toContain("(fp_line");
    expect(out).toContain("(start -10 -5)");
    expect(out).toContain("(end 10 -5)");
    expect(out).toContain('(layer "F.SilkS")');
    expect(out).toContain("(width 0.15)");
  });

  it("serializes rectangles as four lines", () => {
    const fp = new KicadFootprint({ name: "Test" });
    fp.addRect({ x1: -5, y1: -3, x2: 5, y2: 3 });

    const out = fp.serialize();
    // Should produce 4 fp_line entries
    const lineCount = (out.match(/\(fp_line/g) || []).length;
    expect(lineCount).toBe(4);

    // Should contain corners
    expect(out).toContain("(start -5 -3)");
    expect(out).toContain("(end 5 -3)");
    expect(out).toContain("(start 5 3)");
    expect(out).toContain("(end -5 3)");
  });

  it("serializes text labels", () => {
    const fp = new KicadFootprint({ name: "Test" });
    fp.addText({ text: "VCC", x: -10, y: -3, justify: "left" });

    const out = fp.serialize();
    expect(out).toContain('(fp_text user "VCC"');
    expect(out).toContain("(at -10 -3 0)");
    expect(out).toContain("(unlocked yes)");
    expect(out).toContain("(justify left bottom)");
  });

  it("serializes text without justify when not specified", () => {
    const fp = new KicadFootprint({ name: "Test" });
    fp.addText({ text: "PIN1", x: 0, y: 0 });

    const out = fp.serialize();
    expect(out).toContain('(fp_text user "PIN1"');
    expect(out).not.toContain("(justify");
  });

  it("supports method chaining", () => {
    const fp = new KicadFootprint({ name: "Test" });
    const result = fp
      .addPad({ number: "1", type: "smd", shape: "rect", x: 0, y: 0, width: 1, height: 1 })
      .addLine({ x1: -1, y1: -1, x2: 1, y2: -1 })
      .addRect({ x1: -2, y1: -2, x2: 2, y2: 2 })
      .addText({ text: "A", x: 0, y: 0 });

    expect(result).toBe(fp);
  });

  it("generates multiple pads in sequence", () => {
    const fp = new KicadFootprint({ name: "TestIC" });
    for (let i = 1; i <= 4; i++) {
      fp.addPad({
        number: String(i),
        type: "smd",
        shape: "roundrect",
        x: -10,
        y: (i - 1) * 2.54,
        width: 4,
        height: 1.5,
        roundrectRatio: 0.15,
      });
    }

    const out = fp.serialize();
    expect(out).toContain('(pad "1"');
    expect(out).toContain('(pad "2"');
    expect(out).toContain('(pad "3"');
    expect(out).toContain('(pad "4"');
  });

  it("writes file to .pretty directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kicad-test-"));
    const prettyDir = path.join(tmpDir, "Test.pretty");

    try {
      const fp = new KicadFootprint({ name: "TestPart" });
      fp.addPad({ number: "1", type: "smd", shape: "rect", x: 0, y: 0, width: 1, height: 1 });

      const filePath = fp.writeFile(prettyDir);

      expect(fs.existsSync(filePath)).toBe(true);
      expect(filePath).toContain("TestPart.kicad_mod");

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain('(footprint "TestPart"');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ─── KicadSymbol ─────────────────────────────────────────────────────

describe("KicadSymbol", () => {
  it("generates minimal symbol boilerplate", () => {
    const sym = new KicadSymbol({ name: "TestChip" });
    const out = sym.serialize();

    expect(out).toContain('(symbol "TestChip"');
    expect(out).toContain("(exclude_from_sim no)");
    expect(out).toContain("(in_bom yes)");
    expect(out).toContain("(on_board yes)");
    expect(out).toContain('(property "Reference" "U"');
    expect(out).toContain('(property "Value" "TestChip"');
    expect(out).toContain("(embedded_fonts no)");
  });

  it("uses custom reference and value", () => {
    const sym = new KicadSymbol({ name: "MyRes", reference: "R", value: "10k" });
    const out = sym.serialize();

    expect(out).toContain('(property "Reference" "R"');
    expect(out).toContain('(property "Value" "10k"');
  });

  it("includes footprint property when set", () => {
    const sym = new KicadSymbol({ name: "MyIC", footprint: "Project_Footprints:MyIC" });
    const out = sym.serialize();

    expect(out).toContain('(property "Footprint"');
    expect(out).toContain("(hide yes)");
  });

  it("includes description property", () => {
    const sym = new KicadSymbol({ name: "Test", description: "Test component" });
    const out = sym.serialize();
    expect(out).toContain('(property "Description" "Test component"');
  });

  it("serializes pins with correct type and direction", () => {
    const sym = new KicadSymbol({ name: "Test" });
    sym.addPin({ name: "VCC", number: "1", x: -10, y: 5, side: "left", type: "power_in" });
    sym.addPin({ name: "OUT", number: "2", x: 10, y: 0, side: "right", type: "output" });
    sym.addPin({ name: "EN", number: "3", x: 0, y: 10, side: "top", type: "input" });
    sym.addPin({ name: "GND", number: "4", x: 0, y: -10, side: "bottom", type: "power_in" });

    const out = sym.serialize();

    // Pin types
    expect(out).toContain("(pin power_in line");
    expect(out).toContain("(pin output line");
    expect(out).toContain("(pin input line");

    // Pin names and numbers
    expect(out).toContain('(name "VCC"');
    expect(out).toContain('(number "1"');
    expect(out).toContain('(name "OUT"');
    expect(out).toContain('(number "2"');

    // Direction (rotation angles)
    expect(out).toContain("(at -10 5 0)");    // left → 0
    expect(out).toContain("(at 10 0 180)");   // right → 180
    expect(out).toContain("(at 0 10 90)");    // top → 90
    expect(out).toContain("(at 0 -10 270)");  // bottom → 270
  });

  it("serializes pin length", () => {
    const sym = new KicadSymbol({ name: "Test" });
    sym.addPin({ name: "A", number: "1", x: -5, y: 0, side: "left", type: "passive", length: 3.81 });

    const out = sym.serialize();
    expect(out).toContain("(length 3.81)");
  });

  it("serializes rectangles into _0_1 sub-symbol", () => {
    const sym = new KicadSymbol({ name: "TestIC" });
    sym.addRect({ x1: -8, y1: 5, x2: 8, y2: -5 });

    const out = sym.serialize();
    expect(out).toContain('(symbol "TestIC_0_1"');
    expect(out).toContain("(rectangle");
    expect(out).toContain("(start -8 5)");
    expect(out).toContain("(end 8 -5)");
    expect(out).toContain("(type none)"); // default fill
  });

  it("serializes rectangles with background fill", () => {
    const sym = new KicadSymbol({ name: "Test" });
    sym.addRect({ x1: -5, y1: 5, x2: 5, y2: -5, fill: "background" });

    const out = sym.serialize();
    expect(out).toContain("(type background)");
  });

  it("serializes text into _1_1 sub-symbol", () => {
    const sym = new KicadSymbol({ name: "TestIC" });
    sym.addText({ text: "3v3 ... 5v", x: 0, y: 0 });

    const out = sym.serialize();
    expect(out).toContain('(symbol "TestIC_1_1"');
    expect(out).toContain('(text "3v3 ... 5v"');
    expect(out).toContain("(at 0 0 0)");
  });

  it("places pins in _1_1 sub-symbol", () => {
    const sym = new KicadSymbol({ name: "TestIC" });
    sym.addPin({ name: "A", number: "1", x: -10, y: 0, side: "left", type: "input" });

    const out = sym.serialize();
    expect(out).toContain('(symbol "TestIC_1_1"');
    expect(out).toContain("(pin input line");
  });

  it("supports method chaining", () => {
    const sym = new KicadSymbol({ name: "Test" });
    const result = sym
      .addRect({ x1: -5, y1: 5, x2: 5, y2: -5 })
      .addPin({ name: "A", number: "1", x: -7, y: 0, side: "left", type: "passive" })
      .addText({ text: "Label", x: 0, y: 0 });

    expect(result).toBe(sym);
  });

  it("generates a complete DMX_Module-like symbol", () => {
    const sym = new KicadSymbol({
      name: "DMX_Module",
      reference: "IC",
      footprint: "Project_Footprints:DMX_Module",
    });

    sym.addRect({ x1: -11.43, y1: 1.27, x2: 11.43, y2: -8.89 });
    sym.addText({ text: "3v3 ... 5v", x: -1.778, y: 0 });

    sym.addPin({ name: "VCC", number: "1", x: -13.97, y: 0, side: "left", type: "power_in" });
    sym.addPin({ name: "TXD", number: "2", x: -13.97, y: -2.54, side: "left", type: "input" });
    sym.addPin({ name: "RXD", number: "3", x: -13.97, y: -5.08, side: "left", type: "output" });
    sym.addPin({ name: "GND", number: "4", x: -13.97, y: -7.62, side: "left", type: "power_in" });
    sym.addPin({ name: "A+", number: "5", x: 13.97, y: 0, side: "right", type: "passive" });
    sym.addPin({ name: "B-", number: "6", x: 13.97, y: -3.81, side: "right", type: "passive" });
    sym.addPin({ name: "GND", number: "7", x: 13.97, y: -7.62, side: "right", type: "power_in" });

    const out = sym.serialize();

    // Has all the key structural elements
    expect(out).toContain('(symbol "DMX_Module"');
    expect(out).toContain('(property "Reference" "IC"');
    expect(out).toContain('(symbol "DMX_Module_0_1"');
    expect(out).toContain('(symbol "DMX_Module_1_1"');
    expect(out).toContain('(name "VCC"');
    expect(out).toContain('(name "A+"');
    expect(out).toContain('(name "B-"');

    // Left pins at angle 0, right pins at angle 180
    expect(out).toContain("(at -13.97 0 0)");
    expect(out).toContain("(at 13.97 0 180)");
  });
});

// ─── KicadLibrary ────────────────────────────────────────────────────

describe("KicadLibrary", () => {
  it("generates library header for empty library", () => {
    const lib = new KicadLibrary();
    const out = lib.serializeSymbols();

    expect(out).toContain("(kicad_symbol_lib");
    expect(out).toContain("(version 20241209)");
    expect(out).toContain('(generator "pcb_framework")');
    expect(out).toContain('(generator_version "9.0")');
    expect(out).toContain(")");
  });

  it("merges multiple symbols into one file", () => {
    const lib = new KicadLibrary();

    const sym1 = new KicadSymbol({ name: "IC_A", reference: "U" });
    sym1.addPin({ name: "VCC", number: "1", x: -5, y: 0, side: "left", type: "power_in" });

    const sym2 = new KicadSymbol({ name: "IC_B", reference: "U" });
    sym2.addPin({ name: "GND", number: "1", x: -5, y: 0, side: "left", type: "power_in" });

    lib.addSymbol(sym1);
    lib.addSymbol(sym2);

    const out = lib.serializeSymbols();

    // Both symbols present
    expect(out).toContain('(symbol "IC_A"');
    expect(out).toContain('(symbol "IC_B"');

    // Only one library header
    const headerCount = (out.match(/kicad_symbol_lib/g) || []).length;
    expect(headerCount).toBe(1);
  });

  it("tracks symbols via getter", () => {
    const lib = new KicadLibrary();
    const sym = new KicadSymbol({ name: "Test" });
    lib.addSymbol(sym);

    expect(lib.symbols).toHaveLength(1);
    expect(lib.symbols[0].name).toBe("Test");
  });

  it("tracks footprints via getter", () => {
    const lib = new KicadLibrary();
    const fp = new KicadFootprint({ name: "TestFP" });
    lib.addFootprint(fp);

    expect(lib.footprints).toHaveLength(1);
    expect(lib.footprints[0].name).toBe("TestFP");
  });

  it("supports method chaining", () => {
    const lib = new KicadLibrary();
    const result = lib
      .addSymbol(new KicadSymbol({ name: "A" }))
      .addFootprint(new KicadFootprint({ name: "B" }));

    expect(result).toBe(lib);
  });

  it("writes symbol file to disk", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kicad-lib-test-"));

    try {
      const lib = new KicadLibrary();
      lib.addSymbol(new KicadSymbol({ name: "TestSym" }));

      const filePath = lib.writeSymbols(path.join(tmpDir, "Test.kicad_sym"));

      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("(kicad_symbol_lib");
      expect(content).toContain('(symbol "TestSym"');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("writes footprints to .pretty directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kicad-lib-test-"));
    const prettyDir = path.join(tmpDir, "Lib.pretty");

    try {
      const lib = new KicadLibrary();
      const fp1 = new KicadFootprint({ name: "FP_A" });
      fp1.addPad({ number: "1", type: "smd", shape: "rect", x: 0, y: 0, width: 1, height: 1 });
      const fp2 = new KicadFootprint({ name: "FP_B" });
      fp2.addPad({ number: "1", type: "smd", shape: "rect", x: 0, y: 0, width: 2, height: 2 });

      lib.addFootprint(fp1);
      lib.addFootprint(fp2);

      const paths = lib.writeFootprints(prettyDir);

      expect(paths).toHaveLength(2);
      expect(fs.existsSync(path.join(prettyDir, "FP_A.kicad_mod"))).toBe(true);
      expect(fs.existsSync(path.join(prettyDir, "FP_B.kicad_mod"))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("writeAll writes both symbols and footprints", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kicad-lib-test-"));

    try {
      const lib = new KicadLibrary();
      lib.addSymbol(new KicadSymbol({ name: "MySym" }));

      const fp = new KicadFootprint({ name: "MyFP" });
      fp.addPad({ number: "1", type: "smd", shape: "rect", x: 0, y: 0, width: 1, height: 1 });
      lib.addFootprint(fp);

      const result = lib.writeAll(tmpDir);

      expect(fs.existsSync(result.symbolsPath)).toBe(true);
      expect(result.footprintPaths).toHaveLength(1);
      expect(fs.existsSync(result.footprintPaths[0])).toBe(true);

      // Verify contents
      const symContent = fs.readFileSync(result.symbolsPath, "utf-8");
      expect(symContent).toContain('(symbol "MySym"');

      const fpContent = fs.readFileSync(result.footprintPaths[0], "utf-8");
      expect(fpContent).toContain('(footprint "MyFP"');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
