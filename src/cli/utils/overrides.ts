
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { Component } from "../../synth/Component";

export interface OverrideConfig {
  x?: number;
  y?: number;
  r?: number;
}

export interface OverridesFile {
  placement?: Record<string, OverrideConfig>;
}

/**
 * Loads the overrides.yml file from the source directory.
 * Assumes src/overrides.yml exists in the project root.
 */
export function loadOverrides(projectRoot: string): OverridesFile {
  // We expect overrides.yml to be in src/ relative to project root
  // or maybe just overrides.yml in src/ where schematic is?
  // User said "have a overrides.yml file in the src/ directory".

  const overridesPath = path.join(projectRoot, "src", "overrides.yml");
  if (fs.existsSync(overridesPath)) {
    try {
      const content = fs.readFileSync(overridesPath, "utf-8");
      // Use "as any" then cast because load return type is unknown
      return (yaml.load(content) as OverridesFile) || {};
    } catch (e) {
      console.warn(`⚠️  Failed to parse overrides.yml: ${e}`);
      return {};
    }
  }
  return {};
}

/**
 * Resolves the CPL override configuration for a given component based on priority rules.
 *
 * Priority:
 * 1. Component instance `cpl` property (in code)
 * 2. `overrides.yml` -> Part Number match (e.g., LCSC:C1234)
 * 3. `overrides.yml` -> Exact Footprint match (e.g., Lib:Footprint)
 * 4. `overrides.yml` -> Footprint match (stripped library) (e.g., Footprint)
 * 5. `overrides.yml` -> Prefix match (stripped library) (e.g., FootprintPrefix...)
 */
export function resolveOverride(
  component: Component<any>,
  overrides: OverridesFile
): OverrideConfig {
  // 1. Code override
  if (component.cpl) {
    return component.cpl;
  }

  const placement = overrides.placement;
  if (!placement) {
    return {};
  }

  // 2. Part Number Match
  if (component.partNo) {
    const partNo = component.partNo;
    const lcscKey = partNo.startsWith("LCSC:") ? partNo : `LCSC:${partNo}`;

    // Check exact key match for "LCSC:Cxxxx"
    if (placement[lcscKey]) {
      return placement[lcscKey];
    }

    // Also check if YAML has just "Cxxxx"
    if (placement[partNo]) {
        return placement[partNo];
    }
  }

  const footprintFull = component.footprint; // e.g., "Package_TO_SOT_SMD:SOT-23"
  // Strip library: everything after the last colon, or the whole string if no colon
  const footprintName = footprintFull.includes(":")
    ? footprintFull.split(":").pop()!
    : footprintFull;

  // 3. Exact Footprint Match (with library)
  if (placement[footprintFull]) {
    return placement[footprintFull];
  }

  // 4. Footprint Match (stripped library)
  if (placement[footprintName]) {
    return placement[footprintName];
  }

  // 5. Prefix Match (stripped library)
  // Iterate keys in order
  for (const key of Object.keys(placement)) {
    // If key matches start of footprintName
    if (footprintName.startsWith(key)) {
        return placement[key];
    }
  }

  return {};
}
