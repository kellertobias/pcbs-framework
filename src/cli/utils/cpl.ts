
import * as fs from "fs";
import * as path from "path";
import { Component } from "../../synth/Component";
import { loadOverrides, resolveOverride } from "./overrides";

/**
 * Convert KiCad's Pick & Place (pos) ASCII output to JLCPCB CPL format.
 *
 * KiCad pos (ASCII, mm, both sides) output has the following columns:
 *   Ref  Val  Package  PosX  PosY  Rot  Side
 *
 * JLCPCB CPL expects:
 *   Designator  Val  Package  Mid X  Mid Y  Rotation  Layer
 */
export function convertPosToCpl(
    posFilePath: string,
    cplOutputPath: string,
    components: Component<any>[],
    projectRoot: string
): string {
    const content = fs.readFileSync(posFilePath, "utf-8");
    const lines = content.split("\n");

    const overrides = loadOverrides(projectRoot);
    const componentMap = new Map<string, Component<any>>();

    // Index components by Reference for fast lookup
    for (const comp of components) {
        componentMap.set(comp.ref, comp);
    }

    const csvLines: string[] = [];
    // JLCPCB CPL header
    csvLines.push("Designator,Val,Package,Mid X,Mid Y,Rotation,Layer");

    for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines, comment lines (starting with #), header lines
        if (!trimmed || trimmed.startsWith("#")) continue;

        // KiCad ASCII pos format is whitespace-separated:
        // Ref  Val  Package  PosX  PosY  Rot  Side
        const match = trimmed.match(
            /^(\S+)\s+(\S+)\s+(\S+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+(\S+)$/
        );

        if (!match) continue;

        const [, ref, val, pkg, posXStr, posYStr, rotStr, side] = match;

        // Parse numbers
        let posX = parseFloat(posXStr);
        let posY = parseFloat(posYStr);
        let rot = parseFloat(rotStr);

        // Apply overrides if component exists
        const comp = componentMap.get(ref);
        if (comp) {
            const override = resolveOverride(comp, overrides);
            if (override) {
                if (override.x !== undefined) posX += override.x;
                if (override.y !== undefined) posY += override.y;
                if (override.r !== undefined) rot += override.r;

                // Normalize rotation to 0-360 range
                rot = ((rot % 360) + 360) % 360;
            }
        }

        // Map side: KiCad uses "top"/"bottom", JLCPCB uses "Top"/"Bottom"
        const layer =
            side.toLowerCase() === "top"
                ? "Top"
                : side.toLowerCase() === "bottom"
                    ? "Bottom"
                    : side;

        // Format position with mm suffix (JLCPCB expects this)
        const midX = `${posX.toFixed(4)}mm`;
        const midY = `${posY.toFixed(4)}mm`;
        const rotation = rot.toFixed(4);

        // CSV escape helper
        const esc = (s: string) =>
            s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;

        csvLines.push(
            `${esc(ref)},${esc(val)},${esc(pkg)},${midX},${midY},${rotation},${layer}`
        );
    }

    fs.writeFileSync(cplOutputPath, csvLines.join("\n"), "utf-8");
    return cplOutputPath;
}
