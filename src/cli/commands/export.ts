import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { getConfig } from "../config";
import { resolveSchematic, die } from "../utils";
import { generateBom } from "../utils/bom";
import { convertPosToCpl } from "../utils/cpl";
import type { Component } from "../../synth/Component";

/**
 * export: Export manufacturing files (Gerber, Drill, BOM, CPL) for JLCPCB.
 *
 * Generates:
 * - Gerber files (all copper, paste, silkscreen, mask layers + edge cuts)
 * - Drill files (Excellon format)
 * - Drill map files (Gerber X2 format)
 * - BOM CSV (JLCPCB format with LCSC Part #)
 * - CPL CSV (JLCPCB pick & place format)
 *
 * All files are zipped into a single archive.
 */
export async function cmdExport(args: string[]): Promise<void> {
  const entry = args[0];
  const schematicPath = await resolveSchematic(entry);
  const schematicDir = path.dirname(schematicPath);
  const projectName = path.basename(schematicDir);
  const { kicadCliPath } = getConfig();

  console.log(`\n📦  Exporting JLCPCB files: ${projectName}\n`);

  // ── Step 0: Load the TypeScript schematic to get component registry ──
  let components: Component<any>[] = [];
  try {
    const mod = require(schematicPath);
    const schematic = mod.default;

    if (!schematic || typeof schematic._generateWithCapture !== "function") {
      die(`${schematicPath} must default-export a Schematic instance.`);
    }

    console.log(`  -> Loading circuit: ${schematic.name}...`);
    const snapshot = schematic._generateWithCapture();
    components = snapshot.components;
    console.log(`  -> Found ${components.length} components in circuit registry.`);
  } catch (err: any) {
    console.warn(`  ⚠️  Failed to load schematic TS: ${err.message}`);
    console.warn(`  ⚠️  BOM will fall back to parsing .kicad_sch if available.`);
  }

  // ── Step 1: Find the .kicad_pcb file ──
  let pcbFile = path.join(schematicDir, `${projectName}.kicad_pcb`);
  if (!fs.existsSync(pcbFile)) {
    const files = fs
      .readdirSync(schematicDir)
      .filter((f) => f.endsWith(".kicad_pcb") && !f.startsWith("_autosave"));
    if (files.length === 0) {
      die(
        `No .kicad_pcb file found in ${schematicDir}. Have you opened and saved it in KiCad?`
      );
    }
    pcbFile = path.join(schematicDir, files[0]);
  }
  console.log(`  -> PCB file: ${path.basename(pcbFile)}`);

  // ── Output directories ──
  const outputBase = path.join(schematicDir, "jlcpcb");
  const gerberDir = path.join(outputBase, "gerbers");

  // Clean and recreate
  if (fs.existsSync(outputBase)) {
    fs.rmSync(outputBase, { recursive: true, force: true });
  }
  fs.mkdirSync(gerberDir, { recursive: true });

  try {
    // ══════════════════════════════════════════════
    // 1. GERBER FILES
    // ══════════════════════════════════════════════
    // Layers: All copper, all paste, all silkscreen, all mask, edge cuts
    // Options:
    //   - Check zone fills before plotting (handled by KiCad internally)
    //   - Tent vias (default behavior)
    //   - Use Protel filename extensions (default, --no-protel-ext omitted)
    //   - Subtract soldermask from silkscreen (--subtract-soldermask)
    console.log("  -> Generating Gerber files...");
    execSync(
      [
        `"${kicadCliPath}"`,
        "pcb", "export", "gerbers",
        `--output`, `"${gerberDir}/"`,
        `--layers`, `"F.Cu,B.Cu,F.Paste,B.Paste,F.Silkscreen,B.Silkscreen,F.Mask,B.Mask,Edge.Cuts"`,
        `--subtract-soldermask`,
        `"${pcbFile}"`,
      ].join(" "),
      { stdio: "pipe" }
    );
    console.log("     ✓ Gerber files generated (Protel extensions, soldermask subtracted)");

    // ══════════════════════════════════════════════
    // 2. DRILL FILES
    // ══════════════════════════════════════════════
    // Options:
    //   - Format: Excellon
    //   - Oval Holes Drill Mode: alternate (--excellon-oval-format alternate)
    //   - Drill Origin: absolute (--drill-origin absolute)
    //   - Drill Units: mm (--excellon-units mm)
    //   - Zeros Format: decimal (--excellon-zeros-format decimal)
    console.log("  -> Generating Drill files...");
    execSync(
      [
        `"${kicadCliPath}"`,
        "pcb", "export", "drill",
        `--output`, `"${gerberDir}/"`,
        `--format`, `excellon`,
        `--drill-origin`, `absolute`,
        `--excellon-units`, `mm`,
        `--excellon-zeros-format`, `decimal`,
        `--excellon-oval-format`, `alternate`,
        `"${pcbFile}"`,
      ].join(" "),
      { stdio: "pipe" }
    );
    console.log("     ✓ Drill files generated (absolute origin, mm, decimal zeros, alternate oval)");

    // ══════════════════════════════════════════════
    // 3. DRILL MAP FILES
    // ══════════════════════════════════════════════
    // Generate drill map in Gerber X2 format
    console.log("  -> Generating Drill Map files...");
    execSync(
      [
        `"${kicadCliPath}"`,
        "pcb", "export", "drill",
        `--output`, `"${gerberDir}/"`,
        `--format`, `excellon`,
        `--drill-origin`, `absolute`,
        `--excellon-units`, `mm`,
        `--excellon-zeros-format`, `decimal`,
        `--excellon-oval-format`, `alternate`,
        `--generate-map`,
        `--map-format`, `gerberx2`,
        `"${pcbFile}"`,
      ].join(" "),
      { stdio: "pipe" }
    );
    console.log("     ✓ Drill map generated (Gerber X2 format)");

    // ══════════════════════════════════════════════
    // 4. CPL FILE (Component Placement List)
    // ══════════════════════════════════════════════
    // KiCad generates ASCII pos → we convert to JLCPCB CSV format
    console.log("  -> Generating CPL (Pick & Place) file...");

    // First export in ASCII format (which we can parse reliably)
    const rawPosFile = path.join(outputBase, `_raw_pos_${projectName}.txt`);
    execSync(
      [
        `"${kicadCliPath}"`,
        "pcb", "export", "pos",
        `--output`, `"${rawPosFile}"`,
        `--format`, `ascii`,
        `--units`, `mm`,
        `--side`, `both`,
        `--exclude-dnp`,
        `"${pcbFile}"`,
      ].join(" "),
      { stdio: "pipe" }
    );

    // Convert KiCad pos output → JLCPCB CPL format
    const cplFile = path.join(outputBase, `CPL-${projectName}.csv`);
    convertPosToCpl(rawPosFile, cplFile, components, process.cwd());

    // Clean up raw file
    fs.unlinkSync(rawPosFile);
    console.log("     ✓ CPL file generated (JLCPCB format)");

    // ══════════════════════════════════════════════
    // 5. BOM FILE
    // ══════════════════════════════════════════════
    let bomFile: string | null = null;

    if (components.length > 0) {
      // Generate BOM from our TypeScript circuit registry
      bomFile = generateBom(projectName, outputBase, components);
    } else {
      console.warn("  ⚠️  No components loaded from TS circuit. Skipping BOM generation.");
    }

    // ══════════════════════════════════════════════
    // 6. 3D RENDERS
    // ══════════════════════════════════════════════
    console.log("  -> Generating 3D renders...");
    const renderDir = path.join(outputBase, "renders");
    fs.mkdirSync(renderDir, { recursive: true });

    const topRender = path.join(renderDir, `${projectName}-top.png`);
    const bottomRender = path.join(renderDir, `${projectName}-bottom.png`);

    try {
      execSync(
        [
          `"${kicadCliPath}"`,
          "pcb",
          "render",
          "--output",
          `"${topRender}"`,
          "--side",
          "top",
          "--width",
          "2048",
          "--height",
          "1536",
          "--quality",
          "high",
          `"${pcbFile}"`,
        ].join(" "),
        { stdio: "pipe" }
      );

      execSync(
        [
          `"${kicadCliPath}"`,
          "pcb",
          "render",
          "--output",
          `"${bottomRender}"`,
          "--side",
          "bottom",
          "--width",
          "2048",
          "--height",
          "1536",
          "--quality",
          "high",
          `"${pcbFile}"`,
        ].join(" "),
        { stdio: "pipe" }
      );

      const angledRender = path.join(renderDir, `${projectName}-angled.png`);
      execSync(
        [
          `"${kicadCliPath}"`,
          "pcb",
          "render",
          "--output",
          `"${angledRender}"`,
          "--rotate",
          "315,0,45",
          "--width",
          "2048",
          "--height",
          "1536",
          "--quality",
          "high",
          `"${pcbFile}"`,
        ].join(" "),
        { stdio: "pipe" }
      );
      console.log("     ✓ 3D renders generated (top, bottom, angled)");
    } catch (err: any) {
      console.warn(`  ⚠️  3D rendering failed: ${err.message}`);
    }

    // ══════════════════════════════════════════════
    // 7. ZIP ARCHIVE
    // ══════════════════════════════════════════════
    const zipFile = path.join(schematicDir, `JLCPCB-${projectName}.zip`);
    if (fs.existsSync(zipFile)) {
      fs.unlinkSync(zipFile);
    }

    console.log(`  -> Creating ZIP archive: ${path.basename(zipFile)}`);

    // Collect all files to zip
    const filesToZip: string[] = [];

    // Add gerber + drill files
    const gerberFiles = fs.readdirSync(gerberDir).map((f) => path.join(gerberDir, f));
    filesToZip.push(...gerberFiles);

    // Add CPL
    if (fs.existsSync(cplFile)) {
      filesToZip.push(cplFile);
    }

    // Add BOM
    if (bomFile && fs.existsSync(bomFile)) {
      filesToZip.push(bomFile);
    }

    // Use system zip with -j (junk paths = flat archive)
    const fileArgs = filesToZip.map((f) => `"${f}"`).join(" ");
    execSync(`zip -j "${zipFile}" ${fileArgs}`, { stdio: "pipe" });

    // ══════════════════════════════════════════════
    // Summary
    // ══════════════════════════════════════════════
    const gerberCount = fs.readdirSync(gerberDir).length;
    console.log(`\n✅  JLCPCB export successful!`);
    console.log(`  📂 ZIP archive: ${zipFile}`);
    console.log(`  📂 Manufacturing files: ${outputBase}`);
    console.log(`     • ${gerberCount} Gerber/Drill files`);
    if (bomFile) console.log(`     • BOM: ${path.basename(bomFile)}`);
    console.log(`     • CPL: ${path.basename(cplFile)}`);
    if (fs.existsSync(topRender)) {
      console.log(
        `     • Renders: ${path.basename(topRender)}, ${path.basename(
          bottomRender
        )}, ${path.basename(path.join(renderDir, `${projectName}-angled.png`))}`
      );
    }
  } catch (err: any) {
    die(`Export failed: ${err.message}`);
  }
}
