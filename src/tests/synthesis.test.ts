import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { Schematic, Net, Component } from "../synth";
import { generatePython, CircuitSnapshot } from "../cli/codegen";
import { runSynthesis } from "../cli/synthesis";
import { ensurePythonEnv } from "../cli/env";

describe("Synthesis Integration", () => {
  const TEST_DIR = path.join(__dirname, "temp_synthesis_test");

  beforeAll(() => {
    ensurePythonEnv();
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("successfully generates KiCad files from a schematic", () => {
    class SimpleTestBoard extends Schematic {
      constructor() {
        super({ name: "IntegrationTestBoard" });
      }

      generate(): void {
        const vcc = new Net({ name: "VCC", class: "Power" });
        const gnd = new Net({ name: "GND", class: "Power" });

        const r1 = new Component({
          symbol: "Device:R",
          ref: "R1",
          footprint: "Resistor_SMD:R_0603_1608Metric",
          value: "10k",
        });
        r1.pins[1].tie(vcc);
        r1.pins[2].tie(gnd);
      }
    }

    const board = new SimpleTestBoard();
    const snapshot = board._generateWithCapture();

    // Run synthesis
    const result = runSynthesis(snapshot, TEST_DIR);

    if (!result.success) {
      console.error("Synthesis output:", result.output);
    }

    expect(result.success).toBe(true);

    // Verify KiCad files
    // circuit-synth generates IntegrationTestBoard_circuit.kicad_sch or similar
    const files = fs.readdirSync(TEST_DIR);

    expect(files.some(f => f.endsWith(".kicad_sch"))).toBe(true);
    expect(files.some(f => f.endsWith(".kicad_pro"))).toBe(true);
  });
});
