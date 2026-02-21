import * as path from "path";
import { Pin } from "../synth/types";
import { Net } from "../synth/Net";
import { Component } from "../synth/Component";

/** A snapshot of the circuit state needed for codegen. */
export interface CircuitSnapshot {
  name: string;
  components: Component<any>[];
  nets: Net[];
  placementAlgorithm?: import("../synth/types").PlacementAlgorithm;
}

/**
 * Collect all unique Nets referenced by the given components.
 * Also includes any explicitly provided nets (e.g., floating nets).
 */
function collectNets(
  components: Component<any>[],
  extraNets: Net[] = []
): Net[] {
  const seen = new Set<Net>();
  for (const net of extraNets) {
    seen.add(net);
  }
  for (const comp of components) {
    for (const [, pin] of comp.allPins) {
      if ((pin as Pin).net) {
        seen.add((pin as Pin).net!);
      }
    }
  }
  return Array.from(seen);
}

/** Convert a ref like "R1" to a valid Python variable name "r1". */
function refToVar(ref: string): string {
  return ref.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

/** Convert a net name like "VCC_3V3" to a valid Python variable name. */
function netToVar(name: string): string {
  // Strip leading non-alphanumeric chars (e.g. "+5V" → "5V")
  // then replace remaining special chars with underscores
  let cleaned = name
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .toLowerCase();
  // Python identifiers can't start with a digit, but we prefix with 'net_' anyway
  return cleaned ? `net_${cleaned}` : "net_unnamed";
}

/** Escape a Python string value. */
function pyStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Generate circuit-synth Python source code from a CircuitSnapshot.
 *
 * The output follows the pattern used in existing projects:
 * ```python
 * from circuit_synth import Component, Net, circuit
 *
 * @circuit(name="BoardName")
 * def board_name():
 *     gnd = Net('GND', net_class="Power")
 *     r1 = Component(symbol="Device:R", ref="R1", ...)
 *     r1[1] += gnd
 *     return locals()
 * ```
 */
export function generatePython(snapshot: CircuitSnapshot): string {
  const { name, components } = snapshot;

  // Collect all nets (from component pins + explicit list)
  const nets = collectNets(components, snapshot.nets);

  const lines: string[] = [];

  // ── Imports ──
  lines.push(`from circuit_synth import Component, Net, circuit`);
  lines.push(``);

  // ── Function decorator + signature ──
  const funcName = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  lines.push(`@circuit(name=${pyStr(name)})`);
  lines.push(`def ${funcName}():`);

  // ── Nets ──
  if (nets.length > 0) {
    lines.push(`    # Nets`);
    for (const net of nets) {
      const varName = netToVar(net.name);
      const classArg =
        net.class !== "Signal" ? `, net_class=${pyStr(net.class)}` : "";
      lines.push(`    ${varName} = Net(${pyStr(net.name)}${classArg})`);
    }
    lines.push(``);
  }

  // ── Components ──
  if (components.length > 0) {
    lines.push(`    # Components`);
    for (const comp of components) {
      if (comp.symbol === "Device:DNC") continue; // Skip marker components
      const varName = refToVar(comp.ref);
      const args: string[] = [];
      args.push(`symbol=${pyStr(comp.symbol)}`);
      args.push(`ref=${pyStr(comp.ref)}`);
      args.push(`footprint=${pyStr(comp.footprint)}`);
      if (comp.value) {
        args.push(`value=${pyStr(comp.value)}`);
      }
      if (comp.description) {
        args.push(`description=${pyStr(comp.description)}`);
      }
      if (comp.partNo) {
        args.push(`LCSC_Number=${pyStr(comp.partNo)}`);
      }

      // ── Placement ──
      const sPos = comp.absoluteSchematicPosition;
      if (sPos.x !== 0 || sPos.y !== 0 || (sPos.rotation || 0) !== 0) {
        args.push(`at=(${sPos.x}, ${sPos.y}, ${sPos.rotation || 0})`);
      }

      const pPos = comp.absolutePcbPosition;
      if (pPos.x !== 0 || pPos.y !== 0 || (pPos.rotation || 0) !== 0 || pPos.side !== "front") {
        args.push(`pcb_at=(${pPos.x}, ${pPos.y}, ${pPos.rotation || 0})`);
        args.push(`pcb_side=${pyStr(pPos.side || "front")}`);
      }

      if (args.length <= 3) {
        lines.push(`    ${varName} = Component(${args.join(", ")})`);
      } else {
        lines.push(`    ${varName} = Component(`);
        for (let i = 0; i < args.length; i++) {
          const comma = i < args.length - 1 ? "," : "";
          lines.push(`        ${args[i]}${comma}`);
        }
        lines.push(`    )`);
      }
    }
    lines.push(``);
  }

  // ── Connections ──
  const connectionLines: string[] = [];
  for (const comp of components) {
    if (comp.symbol === "Device:DNC") continue; // Skip marker components
    const compVar = refToVar(comp.ref);
    for (const [pinKey, pin] of comp.allPins) {
      const pinObj = pin as Pin;
      if (!pinObj.net) continue;

      // Skip named aliases that point to the same pin as a numeric key.
      const numericKey = parseInt(pinKey, 10);
      if (isNaN(numericKey)) {
        let hasNumericAlias = false;
        for (const [otherKey, otherPin] of comp.allPins) {
          if (otherKey !== pinKey && otherPin === pin && !isNaN(parseInt(otherKey, 10))) {
            hasNumericAlias = true;
            break;
          }
        }
        if (hasNumericAlias) continue;
      }

      const netVar = netToVar(pinObj.net.name);

      // Check if this net contains a DNC component
      const isDncNet = pinObj.net.pins.some(p => p.component.symbol === "Device:DNC");

      const pinNum = pinObj.name;
      const isNumeric = !isNaN(parseInt(pinNum, 10)) && /^\d+$/.test(pinNum);
      const pinAccessor = isNumeric ? `[${pinNum}]` : `[${pyStr(pinNum)}]`;

      if (isDncNet) {
        // Find the DNC component to use its ref for the NC net name if possible, 
        // but circuit-synth pattern usually uses NC_<Ref>_<Pin>
        connectionLines.push(`    ${compVar}${pinAccessor} += Net(${pyStr(`NC_${comp.ref}_${pinNum}`)})`);
      } else {
        connectionLines.push(`    ${compVar}${pinAccessor} += ${netVar}`);
      }
    }
  }

  if (connectionLines.length > 0) {
    lines.push(`    # Connections`);
    lines.push(...connectionLines);
    lines.push(``);
  }

  // ── Return ──
  lines.push(`    return locals()`);
  lines.push(``);

  return lines.join("\n");
}
