import * as fs from "fs";
import * as path from "path";
import type { Component } from "../../synth/Component";

/**
 * BOM entry before grouping.
 */
interface BomEntry {
  ref: string;
  value: string;
  footprint: string;
  lcsc: string;
}

/**
 * Generate a JLCPCB-compatible BOM CSV from the component registry.
 *
 * Format:
 *   Comment, Designator, Footprint, LCSC Part #
 *
 * Grouping:
 * - All parts with the same footprint, same value, and same LCSC Part #
 *   are merged into one line.
 * - Comment = value (e.g. "39pF")
 * - Designator = comma-separated refs (sorted numerically)
 * - Footprint = footprint name (library:name → just the name part)
 * - LCSC Part # = from component's partNo
 *
 * Components without a value default to their symbol name.
 * DNC and TestPoint components are excluded.
 */
export function generateBom(
  projectName: string,
  outputDir: string,
  components: Component<any>[]
): string | null {
  console.log(`  -> Generating BOM from circuit registry...`);

  // Build BOM entries, filtering out marker components
  const entries: BomEntry[] = [];

  for (const comp of components) {
    // Skip DNC markers
    if (comp.symbol === "Device:DNC") continue;

    // Determine value
    let value = comp.value || "";
    if (!value) {
      // Fallback: use symbol name (part after colon)
      const parts = comp.symbol.split(":");
      value = parts.length > 1 ? parts[parts.length - 1] : comp.symbol;
    }

    // Extract footprint name (strip library prefix)
    let footprint: string = comp.footprint as string;
    const fpParts = footprint.split(":");
    if (fpParts.length > 1) {
      footprint = fpParts[fpParts.length - 1];
    }

    const lcsc = comp.partNo || "";

    entries.push({
      ref: comp.ref,
      value,
      footprint,
      lcsc,
    });
  }

  if (entries.length === 0) {
    console.warn("⚠️  No components found for BOM.");
    return null;
  }

  // Group by (value, footprint, lcsc) - Muenchian grouping equivalent
  const groups = new Map<string, BomEntry[]>();
  for (const entry of entries) {
    const key = `${entry.value}\x00${entry.footprint}\x00${entry.lcsc}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(entry);
  }

  // Sort refs within each group numerically
  const sortRef = (a: string, b: string): number => {
    // Extract numeric suffix for natural sorting
    const numA = parseInt(a.replace(/[^0-9]/g, ""), 10) || 0;
    const numB = parseInt(b.replace(/[^0-9]/g, ""), 10) || 0;
    if (numA !== numB) return numA - numB;
    return a.localeCompare(b);
  };

  // Build CSV
  const csvLines: string[] = ["Comment,Designator,Footprint,LCSC Part #"];

  // Sort groups by first ref in each group
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const refsA = a[1].map((e) => e.ref).sort(sortRef);
    const refsB = b[1].map((e) => e.ref).sort(sortRef);
    return sortRef(refsA[0], refsB[0]);
  });

  for (const [, group] of sortedGroups) {
    const { value, footprint, lcsc } = group[0];
    const refs = group
      .map((e) => e.ref)
      .sort(sortRef)
      .join(",");

    // CSV escape: wrap in quotes if value contains commas or quotes
    const esc = (s: string) =>
      s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;

    csvLines.push(`${esc(value)},${esc(refs)},${esc(footprint)},${esc(lcsc)}`);
  }

  const bomFile = path.join(outputDir, `BOM-${projectName}.csv`);
  fs.writeFileSync(bomFile, csvLines.join("\n"), "utf-8");
  console.log(`  -> BOM written: ${path.basename(bomFile)} (${sortedGroups.length} unique parts)`);

  return bomFile;
}
