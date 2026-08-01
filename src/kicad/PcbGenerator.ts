import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { CircuitSnapshot } from "../synth/types";
import { Component } from "../synth/Component";
import { UuidManager } from "./UuidManager";

export interface PcbGenerationResult {
  content: string;
  placed: number;
  warnings: string[];
}

/** Generates an initial board containing the outline and explicitly positioned footprints. */
export class PcbGenerator {
  constructor(
    private readonly snapshot: CircuitSnapshot,
    private readonly uuids: UuidManager,
    private readonly outputDir: string,
  ) {}

  generate(): PcbGenerationResult {
    const pcb = this.snapshot.pcb;
    if (!pcb) throw new Error("Cannot generate a PCB without schematic pcb options.");
    if (pcb.outline.length < 3) throw new Error("PCB outline must contain at least three points.");
    if (pcb.outline.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      throw new Error("PCB outline points must contain finite x/y coordinates.");
    }

    const warnings: string[] = [];
    const footprints: string[] = [];
    for (const component of this.snapshot.components) {
      if (!component.footprint || component.footprint === "DNC" || !this.hasExplicitPcbPosition(component) || !this.isIncluded(component.ref)) continue;
      const source = this.resolveFootprint(component.footprint);
      if (!source) {
        warnings.push(`Could not resolve footprint '${component.footprint}' for positioned component ${component.ref}; it was left for KiCad import.`);
        continue;
      }
      footprints.push(this.instantiateFootprint(component, fs.readFileSync(source, "utf-8")));
    }

    const edges = pcb.outline.map((start, index) => {
      const end = pcb.outline[(index + 1) % pcb.outline.length];
      return `\t(gr_line\n\t\t(start ${start.x} ${start.y})\n\t\t(end ${end.x} ${end.y})\n\t\t(stroke (width ${pcb.outlineLineWidth ?? 0.05}) (type solid))\n\t\t(layer "Edge.Cuts")\n\t\t(uuid "${crypto.randomUUID()}")\n\t)`;
    });

    return {
      content: `${this.header(pcb.thickness ?? 1.6)}\n${footprints.join("\n")}\n${edges.join("\n")}\n\t(embedded_fonts no)\n)\n`,
      placed: footprints.length,
      warnings,
    };
  }

  private isIncluded(reference: string): boolean {
    const patterns = this.snapshot.pcb?.place;
    if (!patterns?.length) return true;
    return patterns.some((pattern) => {
      const expression = pattern.split("*").map((part) => this.escapeRegex(part)).join(".*");
      return new RegExp(`^${expression}$`).test(reference);
    });
  }

  private hasExplicitPcbPosition(component: Component<any>): boolean {
    // A child coordinate is relative layout metadata, not permission to place
    // an otherwise unplaced subcircuit at the board origin. A positioned
    // parent, however, deliberately places its complete subtree.
    if (!component.parent) return Boolean(component.pcbPosition);
    let parent: any = component.parent;
    while (parent) {
      if (parent.pcbPosition) return true;
      parent = parent.parent;
    }
    return false;
  }

  private resolveFootprint(footprint: string): string | undefined {
    const separator = footprint.indexOf(":");
    if (separator < 1) return undefined;
    const library = footprint.slice(0, separator);
    const name = footprint.slice(separator + 1);
    const candidates: string[] = [];

    for (const tablePath of [path.join(this.outputDir, "fp-lib-table"), path.join(process.cwd(), "fp-lib-table")]) {
      if (!fs.existsSync(tablePath)) continue;
      const table = fs.readFileSync(tablePath, "utf-8");
      const libPattern = new RegExp(`\\(lib\\s+\\(name\\s+"?${this.escapeRegex(library)}"?\\).*?\\(uri\\s+"([^"]+)"\\)`, "s");
      const match = table.match(libPattern);
      if (match) {
        const root = match[1].replace(/\$\{KIPRJMOD\}/g, path.dirname(tablePath));
        candidates.push(path.join(root, `${name}.kicad_mod`));
      }
    }

    const envRoots = process.env.KICAD_FOOTPRINT_DIR ? process.env.KICAD_FOOTPRINT_DIR.split(path.delimiter) : [];
    const systemRoots = [
      ...envRoots,
      "/usr/share/kicad/footprints",
      "/Applications/KiCad/KiCad.app/Contents/SharedSupport/footprints",
      "C:\\Program Files\\KiCad\\share\\kicad\\footprints",
    ];
    for (const root of systemRoots) candidates.push(path.join(root, `${library}.pretty`, `${name}.kicad_mod`));
    return candidates.find((candidate) => fs.existsSync(candidate));
  }

  private instantiateFootprint(component: Component<any>, source: string): string {
    const pos = component.absolutePcbPosition;
    const rotation = pos.rotation ?? 0;
    const footprintUuid = this.uuids.getOrGenerate(component.ref);
    const quotedRef = this.escapeQuoted(component.ref);
    const quotedValue = this.escapeQuoted(component.value || component.footprint.split(":").pop() || component.ref);
    let result = source.trim();

    result = result.replace(/^\(footprint\s+"[^"]+"/, `(footprint "${this.escapeQuoted(component.footprint)}"`);
    result = result.replace(/^\s*\((?:version|generator|generator_version)\b[^\n]*\)\s*$/gm, "");
    result = result.replace(/\(uuid\s+"[0-9a-f-]+"\)/gi, () => `(uuid "${crypto.randomUUID()}")`);
    result = result.replace(/\(property\s+"Reference"\s+"[^"]*"/, `(property "Reference" "${quotedRef}"`);
    result = result.replace(/\(property\s+"Value"\s+"[^"]*"/, `(property "Value" "${quotedValue}"`);

    if (pos.side === "back") result = this.flipLayers(result);
    const rootLayer = pos.side === "back" ? "B.Cu" : "F.Cu";
    result = result.replace(/\n\s*\(layer\s+"[FB]\.Cu"\)/, `\n\t(layer "${rootLayer}")\n\t(uuid "${crypto.randomUUID()}")\n\t(at ${pos.x} ${pos.y} ${rotation})`);

    const association = `\n\t(path "/${footprintUuid}")\n\t(sheetname "/")\n\t(sheetfile "${this.escapeQuoted(this.snapshot.name)}.kicad_sch")`;
    const attrIndex = result.search(/\n\s*\(attr\b/);
    if (attrIndex >= 0) result = result.slice(0, attrIndex) + association + result.slice(attrIndex);
    else result = result.replace(/\n\)$/, `${association}\n)`);
    return result;
  }

  private flipLayers(source: string): string {
    return source
      .replace(/"F\./g, '"__FRONT__.')
      .replace(/"B\./g, '"F.')
      .replace(/"__FRONT__\./g, '"B.');
  }

  private escapeQuoted(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private header(thickness: number): string {
    return `(kicad_pcb
\t(version 20241229)
\t(generator "pcb_framework")
\t(generator_version "2.1")
\t(general (thickness ${thickness}) (legacy_teardrops no))
\t(paper "A4")
\t(layers
\t\t(0 "F.Cu" signal)
\t\t(2 "B.Cu" signal)
\t\t(9 "F.Adhes" user "F.Adhesive")
\t\t(11 "B.Adhes" user "B.Adhesive")
\t\t(13 "F.Paste" user)
\t\t(15 "B.Paste" user)
\t\t(5 "F.SilkS" user "F.Silkscreen")
\t\t(7 "B.SilkS" user "B.Silkscreen")
\t\t(1 "F.Mask" user)
\t\t(3 "B.Mask" user)
\t\t(17 "Dwgs.User" user "User.Drawings")
\t\t(19 "Cmts.User" user "User.Comments")
\t\t(21 "Eco1.User" user "User.Eco1")
\t\t(23 "Eco2.User" user "User.Eco2")
\t\t(25 "Edge.Cuts" user)
\t\t(27 "Margin" user)
\t\t(31 "F.CrtYd" user "F.Courtyard")
\t\t(29 "B.CrtYd" user "B.Courtyard")
\t\t(35 "F.Fab" user)
\t\t(33 "B.Fab" user)
\t)
\t(setup (pad_to_mask_clearance 0) (allow_soldermask_bridges_in_footprints no))
\t(net 0 "")`;
  }
}
