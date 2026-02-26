# Concept Plan: Circuit Simulation with `vitest` and `ngspice`

This document outlines the architectural approach to integrating analog circuit simulation (`ngspice`) into the `@tobisk/pcbs-framework`, enabling automated electrical testing via `vitest`. We use the **Club Mixer** schematic as a guiding example to demonstrate exactly how the testing workflow will operate.

## 1. Goal Description

The goal is to automatically verify the electrical correctness of `Composable` modules and full `Schematic` designs during the CI/CD or local development loop. Instead of relying purely on DRC (Design Rule Checks) or visual inspection, we will extract SPICE netlists from the TypeScript PCB definitions, stimulate them with virtual sources, and assert on the results using standard `vitest` assertions.

## 2. Core Architecture Additions

To achieve this, the following components must be added to `pcbs-framework`:

### A. `SpiceGenerator`
Currently, `pcbs-framework` synthesizes KiCad files via `KicadGenerator`. We will introduce a `SpiceGenerator` that walks the [Net](file:///Users/keller/repos/pcbs/src/schematics/club-mixer/ClubMixer.ts#26-36) and `Component` graph to produce a standard SPICE `.cir` netlist.
* **SPICE Models via Attributes**: The `Component` class will be extended to accept optional SPICE definitions (e.g., `.SUBCKT` paths, generic model strings, or built-in primitive types like `R`, `C`, `L`).
* **Pin Mapping**: Footprint pin numbers (e.g., `"14", "1"`) must be mapped to the expected node sequence of the SPICE model. 
* **Model Injection**: The generator will append `.include` statements for complex ICs (like the `INA163` or `NE5532`).

### B. `SpiceSimulator` Harness
A Node-based wrapper around the `ngspice` CLI (or an interactive process if speed is crucial). 
* **Stimulus Injection**: Methods to add `.V` (voltage) and `.I` (current) sources programmatically to specific [Net](file:///Users/keller/repos/pcbs/src/schematics/club-mixer/ClubMixer.ts#26-36) or [Pin](file:///Users/keller/repos/pcbs/src/lib/MicPreamp.ts#5-6) references.
* **Directives**: Configurable `.tran` (Transient), `.ac` (AC Sweep), and `.op` (Operating Point) simulation commands.
* **Result Parser**: Parses the raw output from `ngspice` into typed arrays of time/frequency vs. voltage/current.

## 3. Workflow Example ([MicPreamp](file:///Users/keller/repos/pcbs/src/lib/MicPreamp.ts#7-103))

This is how a test for the [MicPreamp](file:///Users/keller/repos/pcbs/src/lib/MicPreamp.ts#7-103) in the Club Mixer would look in `vitest`:

```typescript
import { describe, it, expect } from "vitest";
import { MicPreamp } from "@pcb/lib/MicPreamp";
import { XlrFemaleCombo } from "@pcb/modules";
import { Simulator, AcSweep, Transient } from "@tobisk/pcbs-spice";

describe("MicPreamp Module", () => {
    it("delivers target AC gain with stable frequency response", async () => {
        // 1. Instantiate the isolated composable
        const xlr = new XlrFemaleCombo({ ref: "J1" });
        const preamp = new MicPreamp({ 
            ref: "TEST_PRE", 
            inputConnector: { component: xlr as any, mapping: { GND: "1", HOT: "2", COLD: "3" } }
        });

        // 2. Set up the Simulator instance
        const sim = new Simulator(preamp);

        // 3. Provide Power Rails
        sim.addDCSource(preamp.pins.VCC, preamp.pins.GND, 15);  // +15V
        sim.addDCSource(preamp.pins.VEE, preamp.pins.GND, -15); // -15V
        
        // 4. Mock Digital Interfaces
        // Since digital pots (MCP41010) are hard to simulate via SPI in SPICE, 
        // we override the component strictly in simulation to act as a variable resistor.
        sim.overrideModel(preamp.digiPot, "R_VARIABLE", { R: 50 }); // Set to ~60dB gain

        // 5. Inject Test Signal
        sim.addACSource(xlr.pins["2"], xlr.pins["3"], { magnitude: 0.001 }); // 1mV differential signal

        // 6. Run AC sweep
        const results = await sim.run(new AcSweep({ type: "dec", points: 10, start: "20", stop: "20k" }));

        // 7. Assertions
        const gainAt1kHz = results.getMagnitudeAt(preamp.pins.OUT_PLUS, "1k");
        expect(gainAt1kHz).toBeCloseTo(1.0, 1); // 1mV in -> 1V out
    });

    it("remains stable under transient step input", async () => {
        // ... Set up simulator with step impulse ...
        // const results = await sim.run(new Transient({ step: "1u", stop: "10m" }));
        // expect(results.getOvershoot(preamp.pins.OUT_PLUS)).toBeLessThan(0.1); 
    });
});
```

## 4. Club Mixer Verification Strategy

Applying this framework to the **Club Mixer**, we can implement test suites for multiple critical sections:

### 1. **Power Supply Section** ([makePowerSupply](file:///Users/keller/repos/pcbs/src/schematics/club-mixer/ClubMixer.ts#38-71))
* **Test**: Output regulation and ripple.
* **SPICE Execution**: Load the `vcc5v`, `vcc3v3`, and `vcc15v` rails with variable current sinks. Run a transient analysis with a noisy 12V DC input adapter source.
* **Assertion**: Verify the rails remain within 5% tolerance and LDO/DCDC outputs do not oscillate under sudden load steps.

### 2. **Analog Output Section** ([makeOutputSection](file:///Users/keller/repos/pcbs/src/schematics/club-mixer/ClubMixer.ts#217-263))
* **Test**: Mute Relay behavior and Buffer stability.
* **SPICE Execution**: Provide audio to `DAC1` input pins (mocking the DAC output natively as an ideal source), leaving `mutingDriver` unpowered.
* **Assertion**: Output at XLR should be identically zero (`0V`). 
* **SPICE Execution 2**: Attach a 10nF `C` load in parallel with `10k R` to the XLR output lines representing a long unbalanced/balanced cable.
* **Assertion**: Transient step response of `NE5532` buffers shows no ringing > 20%.

### 3. **Digital/Mixed Component Handling** (The Challenge)
Circuits like the `ADAU1452` DSP or `ESP32` cannot be meaningfully simulated via `ngspice`. The test framework must recognize their footprint/symbol and automatically treat them as **open circuits** (or replace them with Ideal Behavioral Models if pins have known impedances) to prevent the generation of unresolved SPICE nodes.

## 5. Implementation Roadmap
If this concept is approved, the logical steps to implement it are:

1. **Phase 1: SPICE Base & Primitives**: Add `spiceModel` properties to the `Component` class and build a basic `SpiceGenerator` for resistors and capacitors.
2. **Phase 2: The Simulator Wrapper**: Build the Node.js `ngspice` CLI wrapper and basic parser logic for `.op` and `.tran` results. Integrate with `vitest`.
3. **Phase 3: Active Components & Overrides**: Extend component modeling for Op-Amps/Transistors and add the API to override complex chips (like the digipot) with behavioral test fixtures during execution.
4. **Phase 4**: Write the first `vitest` tests for [MicPreamp](file:///Users/keller/repos/pcbs/src/lib/MicPreamp.ts#7-103).


# TODO/ Updates

Change the test interface to look something like:

expect(results).magnitudeAt(pin, frequency).toBeCloseTo(value, precision);

this needs to be consistent with other spice checks.

also I want strict units at all values, e.g.

expect(results).magnitudeAt({pin, frequency:'<frequency>Hz'}).toBeCloseTo({center: '<value>mV', precision});

---

I also want simple ways to simulate static electricity and other transient events.

e.g. 

const results = await sim.run(new SchockFault({ pin: "GND", duration: "1u", voltage: "10V" }));

expect(results).magnitudeAt({pin, frequency:'<frequency>Hz'}).toBeLessThan({max: '<value>mV'});

---

last but not least, I want to be able to simulate full circuitry, e.g. 

const myCircuit = new ClubMixer(...);

const sim = Simulator.getFromCircuit(myCircuit, {
    onlyComponents: ["TEST_PRE", "R1", "C1"]
    // or
    excludeComponents: ["TEST_PRE", "R1", "C1"]
});

...