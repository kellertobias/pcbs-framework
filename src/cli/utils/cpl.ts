import * as fs from "fs";
import * as path from "path";

/**
 * Helper to parse component rotations from .kicad_pcb file.
 * Returns a map of Reference -> Rotation.
 */
function parsePcbRotations(pcbContent: string): Map<string, number> {
    const rotations = new Map<string, number>();

    let index = 0;
    while (true) {
        // Find next footprint
        const footprintStart = pcbContent.indexOf("(footprint", index);
        if (footprintStart === -1) break;

        // Find the matching closing parenthesis for this footprint
        let openParens = 1;
        let end = footprintStart + 10; // Skip "(footprint"
        while (openParens > 0 && end < pcbContent.length) {
            if (pcbContent[end] === "(") openParens++;
            else if (pcbContent[end] === ")") openParens--;
            end++;
        }

        if (openParens !== 0) break; // Malformed or incomplete

        const footprintBody = pcbContent.substring(footprintStart, end);

        // Extract Reference
        // (property "Reference" "D2" ...
        const refMatch = footprintBody.match(
            /\(property\s+"Reference"\s+"([^"]+)"/
        );
        if (refMatch) {
            const ref = refMatch[1];

            // Extract Rotation
            // Look for the first (at ...) in the footprint body.
            // Format: (at x y [rot])
            const atMatch = footprintBody.match(
                /\(at\s+([-\d.]+)\s+([-\d.]+)(?:\s+([-\d.]+))?\)/
            );
            if (atMatch) {
                const rot = atMatch[3] ? parseFloat(atMatch[3]) : 0.0;
                rotations.set(ref, rot);
            }
        }

        index = end;
    }

    return rotations;
}

/**
 * Convert KiCad's Pick & Place (pos) ASCII output to JLCPCB CPL format.
 *
 * KiCad pos (ASCII, mm, both sides) output has the following columns:
 *   Ref  Val  Package  PosX  PosY  Rot  Side
 *
 * JLCPCB CPL expects:
 *   Designator  Val  Package  Mid X  Mid Y  Rotation  Layer
 *
 * Based on the XSL conversion logic from:
 *   https://gist.github.com/arturo182/a8c4a4b96907cfccf616a1edb59d0389
 *
 * Differences:
 * - Column headers are renamed to match JLCPCB expectations
 * - "Side" values "top"/"bottom" are mapped to "Top"/"Bottom"
 * - Position values are expressed in mm with "mm" suffix
 */
export function convertPosToCpl(
    posFilePath: string,
    cplOutputPath: string,
    pcbFilePath?: string
): string {
    const content = fs.readFileSync(posFilePath, "utf-8");
    const lines = content.split("\n");

    let pcbRotations: Map<string, number> | undefined;
    if (pcbFilePath && fs.existsSync(pcbFilePath)) {
        try {
            const pcbContent = fs.readFileSync(pcbFilePath, "utf-8");
            pcbRotations = parsePcbRotations(pcbContent);
            console.log(
                `  -> Parsed .kicad_pcb: found ${pcbRotations.size} component rotations.`
            );
        } catch (e) {
            console.warn(`  ⚠️  Failed to parse .kicad_pcb for rotations: ${e}`);
        }
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
        // But Val and Package may contain spaces... KiCad uses fixed-width columns.
        // Actually, looking at KiCad output, it uses a specific format.
        // Let's parse it properly.

        // KiCad ASCII pos output looks like:
        // ### Module positions - created on ...
        // ### Printed by KiCad version ...
        // ## Unit = mm, Angle = deg.
        // ## Side : All
        // # Ref     Val        Package                PosX       PosY       Rot  Side
        //   C1      100nF      C_0603_1608Metric     152.4000   -98.0000    0.0000  top
        //

        // Parse with regex for fixed-width-ish format
        // Fields are separated by whitespace, but the last field is "top" or "bottom"
        const match = trimmed.match(
            /^(\S+)\s+(\S+)\s+(\S+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+(\S+)$/
        );

        if (!match) continue;

        const [, ref, val, pkg, posX, posY, rotStr, side] = match;

        // Map side: KiCad uses "top"/"bottom", JLCPCB uses "Top"/"Bottom"
        const layer =
            side.toLowerCase() === "top"
                ? "Top"
                : side.toLowerCase() === "bottom"
                    ? "Bottom"
                    : side;

        // Format position with mm suffix (JLCPCB expects this)
        const midX = `${posX}mm`;
        const midY = `${posY}mm`;

        // Determine rotation
        let rotation = rotStr;
        if (pcbRotations && pcbRotations.has(ref)) {
            rotation = pcbRotations.get(ref)!.toString();
        }

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
