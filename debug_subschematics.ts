import { Schematic } from "./src/synth/Schematic";
import { Composable } from "./src/synth/Composable";
import { registry } from "./src/synth/Registry";

function isDescendant(item: any, potentialAncestor: Composable<any>): boolean {
  let current = item.parent;
  while (current) {
    if (current === potentialAncestor) return true;
    current = current.parent;
  }
  return false;
}

async function run() {
    console.log("Loading schematic...");
    const mod = require("../pcbs/src/schematics/dmx_node/DmxNode.ts");
    const schematic = mod.default as Schematic;
    schematic._generateWithCapture();

    const composables = registry.getComposables();
    let buckConverter: Composable<any> | undefined;

    for (const c of composables) {
        if (c.constructor.name === "BuckConverter") {
            buckConverter = c;
            break;
        }
    }

    if (!buckConverter) {
        console.log("No BuckConverter found!");
        return;
    }

    console.log("Testing BuckConverter:", buckConverter.ref);
    
    // Force lazy init
    const _ = buckConverter.allPins;

    const childComponents = registry.getComponents().filter(c => isDescendant(c, buckConverter));
    const childComposables = registry.getComposables().filter(c => c !== buckConverter && isDescendant(c, buckConverter));

    console.log(`Child Components (${childComponents.length}):`, childComponents.map(c => c.ref));
    console.log(`Child Composables (${childComposables.length}):`, childComposables.map(c => c.ref));

    console.log("\n--- Checking an inductor specifically ---");
    const allComps = registry.getComponents();
    const l_u4 = allComps.find(c => c.ref === "L_U4");
    if (l_u4) {
        console.log("Found L_U4! Parent chain:");
        let p = l_u4.parent;
        while (p) {
            console.log(` - ${p.ref} (${p.constructor.name})`);
            p = p.parent;
        }
        console.log(`isDescendant?`, isDescendant(l_u4, buckConverter));
    }

    console.log("\n--- Checking node connections ---");
    // Print connections for H1
    const h1 = allComps.find(c => c.ref === "H1");
    if (h1) {
        console.log("H1 Pins:", Array.from(h1.pins.values()).length);
    }
}
run().catch(console.error);
