import * as path from "path";
import * as fs from "fs";
import PDFDocument from "pdfkit";
import { resolveSchematic, die } from "../../utils";
import { Schematic } from "../../../synth/Schematic";
import { Composable } from "../../../synth/Composable";
import { Net } from "../../../synth/Net";
import { Pin } from "../../../synth/types";
import { registry } from "../../../synth/Registry";
import { renderScope } from "./scope";

export async function cmdPrint(args: string[]): Promise<void> {
  const entry = args[0];
  const schematicPath = await resolveSchematic(entry);
  const schematicDir = path.dirname(schematicPath);
  const projectName = path.basename(schematicDir);

  console.log(`\n🖨️  Printing schematic: ${projectName}\n`);

  // 1. Load the schematic
  let schematic: Schematic;
  try {
    const mod = require(schematicPath);
    schematic = mod.default;

    if (!schematic || typeof schematic._generateWithCapture !== "function") {
      die(`${schematicPath} must default-export a Schematic instance.`);
    }

    console.log(`  -> Loading circuit: ${schematic.name}...`);
    // This populates the registry
    schematic._generateWithCapture();
  } catch (err: any) {
    die(`Failed to load schematic TS: ${err.message}`);
    return;
  }

  // 2. Setup PDF Document
  const doc = new PDFDocument({
    size: (schematic.size as any) || "A4",
    layout: "landscape",
    autoFirstPage: false,
    info: {
      Title: schematic.name,
      Author: schematic.author,
      Subject: schematic.description,
      Keywords: `Revision: ${schematic.revision}`,
    },
  });

  const outputPath = path.join(schematicDir, `${projectName}.pdf`);
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  // 3. Render Main Schematic
  console.log("  -> Rendering main schematic...");
  doc.addPage();

  // Collect top-level items
  const components = registry.getComponents().filter((c) => !c.parent);
  const composables = registry.getComposables().filter((c) => !c.parent);

  const mainScopeItems = [...components, ...composables];
  const mainScopeNets = findConnectedNets(mainScopeItems);

  renderScope(doc, schematic.name, mainScopeItems, mainScopeNets, schematic);

  // 4. Render Subschematics
  console.log("  -> Rendering subschematics...");

  const allComposables = registry.getComposables();
  const subschematicGroups = new Map<string, Composable<any>[]>();

  for (const c of allComposables) {
    if (c._subschematicName) {
      const name = c._subschematicName;
      if (!subschematicGroups.has(name)) {
        subschematicGroups.set(name, []);
      }
      subschematicGroups.get(name)!.push(c);
    }
  }

  for (const [name, instances] of subschematicGroups) {
    console.log(`     - ${name}`);
    doc.addPage();

    const instance = instances[0];

    const childComponents = registry.getComponents().filter((c) => c.parent === instance);
    const childComposables = registry.getComposables().filter((c) => c.parent === instance);
    const scopeItems = [...childComponents, ...childComposables];
    const scopeNets = findConnectedNets(scopeItems);

    renderScope(doc, name, scopeItems, scopeNets, schematic, instance);
  }

  doc.end();

  await new Promise((resolve) => stream.on("finish", resolve));
  console.log(`\n✅  PDF generated: ${outputPath}`);
}

function findConnectedNets(items: any[]): Net[] {
  const nets = new Set<Net>();
  for (const item of items) {
    if (item.allPins) {
      for (const pin of (item.allPins as Map<string, Pin>).values()) {
        if (pin.net) {
          nets.add(pin.net);
        }
      }
    }
  }
  return Array.from(nets);
}
