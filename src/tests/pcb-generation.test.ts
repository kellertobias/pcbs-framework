import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { Component, Schematic } from "../synth";
import { PcbGenerator } from "../kicad/PcbGenerator";
import { UuidManager } from "../kicad/UuidManager";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("PcbGenerator", () => {
  it("emits an outline and only explicitly positioned footprints", () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcbs-board-"));
    temporaryDirectories.push(outputDir);
    const prettyDir = path.join(outputDir, "Test.pretty");
    fs.mkdirSync(prettyDir);
    fs.writeFileSync(path.join(prettyDir, "Part.kicad_mod"), `(footprint "Part"
\t(version 20241229)
\t(generator "test")
\t(layer "F.Cu")
\t(property "Reference" "REF**" (at 0 -2 0) (layer "F.SilkS") (uuid "00000000-0000-0000-0000-000000000001") (effects (font (size 1 1) (thickness 0.15))))
\t(property "Value" "Part" (at 0 2 0) (layer "F.Fab") (uuid "00000000-0000-0000-0000-000000000002") (effects (font (size 1 1) (thickness 0.15))))
\t(attr smd)
\t(pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask") (uuid "00000000-0000-0000-0000-000000000003"))
)\n`);
    fs.writeFileSync(path.join(outputDir, "fp-lib-table"), `(fp_lib_table (version 7) (lib (name "Test")(type "KiCad")(uri "${prettyDir}")(options "")(descr "")))`);

    class Board extends Schematic {
      generate() {
        new Component({ symbol: "Device:R", ref: "R1", footprint: "Test:Part", pcbPosition: { x: 20, y: 30, rotation: 90 } });
        new Component({ symbol: "Device:R", ref: "R2", footprint: "Test:Part" });
      }
    }
    const board = new Board({
      name: "Partial",
      pcb: {
        outline: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 40 }, { x: 10, y: 40 }],
        place: ["R1"],
      },
    });
    const uuids = new UuidManager();
    uuids.load(path.join(outputDir, "uuids.json"));
    const result = new PcbGenerator(board._generateWithCapture(), uuids, outputDir).generate();

    expect(result.placed).toBe(1);
    expect(result.content).toContain('(property "Reference" "R1"');
    expect(result.content).not.toContain('(property "Reference" "R2"');
    expect(result.content).toContain("(at 20 30 90)");
    expect(result.content.match(/\(gr_line/g)).toHaveLength(4);
    expect(result.content).toContain('(path "/');
  });
});
