import * as fs from "fs";
import * as path from "path";

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
    cplOutputPath: string
): string {
    const content = fs.readFileSync(posFilePath, "utf-8");
    const lines = content.split("\n");

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

        const [, ref, val, pkg, posX, posY, rot, side] = match;

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

        // CSV escape helper
        const esc = (s: string) =>
            s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;

        csvLines.push(
            `${esc(ref)},${esc(val)},${esc(pkg)},${midX},${midY},${rot},${layer}`
        );
    }

    fs.writeFileSync(cplOutputPath, csvLines.join("\n"), "utf-8");
    return cplOutputPath;
}
