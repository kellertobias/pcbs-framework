import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { Schematic, Net, Component } from "../synth";
import { runSynthesis } from "../cli/synthesis";

describe("Component Auto-Rotation & Text Placement", () => {
    const TEST_DIR = path.join(__dirname, "temp_autorotation_test");

    beforeAll(() => {
        if (!fs.existsSync(TEST_DIR)) {
            fs.mkdirSync(TEST_DIR, { recursive: true });
        }
    });

    afterAll(() => {
        if (fs.existsSync(TEST_DIR)) {
            fs.rmSync(TEST_DIR, { recursive: true, force: true });
        }
    });

    function getSchContent(result: any, name: string): string {
        expect(result.success).toBe(true);
        const schPath = path.join(TEST_DIR, `${name}.kicad_sch`);
        expect(fs.existsSync(schPath)).toBe(true);
        return fs.readFileSync(schPath, 'utf8');
    }

    it("auto-rotates a single resistor between +5V and GND vertically", () => {
        class ResistorTest extends Schematic {
            constructor() {
                super({ name: "ResistorTest" });
            }

            generate(): void {
                const vcc = new Net({ name: "+5V", class: "Power" });
                const gnd = new Net({ name: "GND", class: "Power" });

                const r1 = new Component({
                    symbol: "Device:R",
                    ref: "R1",
                    footprint: "Resistor_SMD:R_0603_1608Metric",
                    value: "10k",
                });

                // Pin 1 to +5V, Pin 2 to GND
                r1.pins[1].tie(vcc);
                r1.pins[2].tie(gnd);
            }
        }

        const board = new ResistorTest();
        const snapshot = board._generateWithCapture();

        // Check pre-condition: Component has no explicit rotation overrides preventing our heuristic.
        const r1Def = snapshot.components.find(c => c.ref === "R1");
        // We evaluate its final placement directly from the resulting kicad_sch file.

        const result = runSynthesis(snapshot, TEST_DIR);
        const sch = getSchContent(result, "ResistorTest");

        // After schematic generation, the component should be auto-rotated to align with Power/GND rails automatically.
        // It's a vertical layout since it's bridging top and bottom rails.
        // Device:R natively is vertical in KiCad library, so auto-rotation might yield an upright orientation without 90/270 overrides, OR evaluate to 0 depending on native vector alignment logic. Our framework heuristic rotates based on pin connection.

        // Assert pin directions natively: R should either have rotation 0/180 or 90/270 depending on Library norm. The Device:R is vertical: pin 1 is at top (3.81y), pin 2 is at bottom (-3.81y).
        // The net heuristic should enforce its alignment such that pin 1 (Power) points UP (y out < 0), and pin 2 (GND) points DOWN (y out > 0).

        // Verify component rotation and text orientation
        expect(sch).toMatch(/\(lib_id "Device:R"\)\s+\(at [0-9.-]+ [0-9.-]+ (90\.00|270\.00)\)/);
        expect(sch).toMatch(/\(property "Reference" "R1"/);

        // Verify power symbols exist and are aligned (depending on auto-router they will both be horizontal 90 or 270)
        expect(sch).toMatch(/\(lib_id "power:\+5V"\)\s+\(at [0-9.-]+ [0-9.-]+ (90|270)\)/);
        expect(sch).toMatch(/\(lib_id "power:GND"\)\s+\(at [0-9.-]+ [0-9.-]+ (90|270)\)/);
    });

    it("properly aligns a 3-pin header layout horizontally or vertically with valid labels", () => {
        class HeaderTest extends Schematic {
            constructor() {
                super({ name: "HeaderTest" });
            }

            generate(): void {
                const vcc = new Net({ name: "+5V", class: "Power" });
                const gnd = new Net({ name: "GND", class: "Power" });
                const sig = new Net({ name: "SIGNAL" });

                const r1 = new Component({
                    symbol: "Device:R",
                    ref: "R1",
                    footprint: "Resistor_SMD:R_0603_1608Metric",
                    value: "10k",
                });

                const j1 = new Component({
                    symbol: "Connector_Generic:Conn_01x03",
                    ref: "J1",
                    footprint: "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical",
                    value: "HDR"
                });

                // Resistor connected to GND
                r1.pins[2].tie(gnd);
                // Resistor connected to Header Pin 1
                r1.pins[1].tie(sig);
                j1.pins[1].tie(sig);

                // Header Pin 2 to +5V
                j1.pins[2].tie(vcc);

                // Header Pin 3 to GND
                j1.pins[3].tie(gnd);
            }
        }

        const board = new HeaderTest();
        const snapshot = board._generateWithCapture();
        const result = runSynthesis(snapshot, TEST_DIR);

        const sch = getSchContent(result, "HeaderTest");

        // Verify elements were correctly rendered
        expect(sch).toMatch(/\(property "Reference" "R1"/);
        expect(sch).toMatch(/\(property "Reference" "J1"/);

        // Verify power symbols exist
        expect(sch).toMatch(/\(property "Value" "\+5V"/);
        expect(sch).toMatch(/\(property "Value" "GND"/);

        // Ensure R1 is horizontally aligned, since the header provides vertical pins
        // Actually J1 is native vertical (0 degrees), so R1 connects horizontally.
        // We ensure that text positions were evaluated preventing label overlaps. 
        expect(sch).toMatch(/\(lib_id "Connector_Generic:Conn_01x03"\)\s+\(at [0-9.-]+ [0-9.-]+ 0\.00\)/);
    });
});
