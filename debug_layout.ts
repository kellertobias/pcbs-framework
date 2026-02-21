import { resolveSchematic, die } from "./src/cli/utils";
import { Schematic } from "./src/synth/Schematic";
import { GravityLayout } from "./src/synth/Layout";
import { registry } from "./src/synth/Registry";
import { calculateBBox } from "./src/cli/commands/print/layout";

async function run() {
    console.log("Loading schematic...");
    const mod = require("../pcbs/src/schematics/dmx_node/DmxNode.ts");
    const schematic = mod.default as Schematic;
    schematic._generateWithCapture();

    const components = registry.getComponents().filter((c) => !c.parent);
    const composables = registry.getComposables().filter((c) => !c.parent);
    const mainScopeItems = [...components, ...composables];

    const bbox = calculateBBox(mainScopeItems);
    console.log("\nBounding Box after layout:", bbox);
    for (const item of mainScopeItems) {
        console.log(`- ${item.ref}: x=${item.schematicPosition?.x}, y=${item.schematicPosition?.y}`);
    }
}
run().catch(console.error);
