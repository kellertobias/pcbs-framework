import * as path from "path";
import * as fs from "fs";
import PDFDocument from "pdfkit";
import { resolveSchematic, die } from "../utils";
import type { Schematic } from "../../synth/Schematic";
import { Component } from "../../synth/Component";
import { Composable } from "../../synth/Composable";
import { Net } from "../../synth/Net";
import { Pin } from "../../synth/types";
import { registry } from "../../synth/Registry";

// Constants for styling
const COLORS = {
  wire: "#000000",
  component: "#000000",
  text: "#000000",
  pin: "#FF0000",
  power: "#0000FF",
};

const STYLES = {
  wireWidth: 1,
  componentStroke: 1.5,
  pinSize: 2,
};

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface RenderContext {
  doc: PDFKit.PDFDocument;
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  marginX: number;
  marginY: number;
}

// Global map to store calculated pin positions for routing
const pinPositions = new Map<Pin, { x: number, y: number }>();
const portPositions = new Map<Pin, { x: number, y: number, side: 'left' | 'right' }>();

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

function renderScope(
  doc: PDFKit.PDFDocument,
  title: string,
  items: any[],
  nets: Net[],
  schematic: Schematic,
  composableInstance?: Composable<any>
) {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const margin = 50;

  const ctx: RenderContext = {
    doc,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    width: pageWidth - 2 * margin,
    height: pageHeight - 2 * margin,
    marginX: margin,
    marginY: margin,
  };

  const bbox = calculateBBox(items);

  if (bbox.maxX > bbox.minX && bbox.maxY > bbox.minY) {
    const contentWidth = bbox.maxX - bbox.minX;
    const contentHeight = bbox.maxY - bbox.minY;

    const contentPadding = 20;
    const targetWidth = contentWidth + contentPadding * 2;
    const targetHeight = contentHeight + contentPadding * 2;

    const scaleX = ctx.width / targetWidth;
    const scaleY = ctx.height / targetHeight;
    ctx.scale = Math.min(scaleX, scaleY, 2.0);

    ctx.offsetX = ctx.marginX - (bbox.minX - contentPadding) * ctx.scale + (ctx.width - targetWidth * ctx.scale) / 2;
    ctx.offsetY = ctx.marginY - (bbox.minY - contentPadding) * ctx.scale + (ctx.height - targetHeight * ctx.scale) / 2;
  } else {
      ctx.scale = 1;
      ctx.offsetX = ctx.marginX;
      ctx.offsetY = ctx.marginY;
  }

  // Calculate positions
  calculatePinPositions(ctx, items);

  if (composableInstance) {
      calculatePortPositions(ctx, composableInstance);
  } else {
      portPositions.clear();
  }

  // Render Items
  for (const item of items) {
    renderItem(ctx, item);
  }

  // Render Ports (if subschematic)
  if (composableInstance && composableInstance.allPins) {
      for (const pin of (composableInstance.allPins as Map<string, Pin>).values()) {
          renderPort(ctx, pin);
      }
  }

  // Render Nets
  for (const net of nets) {
    renderNet(ctx, net, items, composableInstance);
  }

  // Render Metadata
  renderMetadata(ctx, schematic, title);
}

function calculateBBox(items: any[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  if (items.length === 0) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  }

  for (const item of items) {
    const pos = item.schematicPosition || { x: 0, y: 0 };
    const size = 100;
    minX = Math.min(minX, pos.x - size/2);
    maxX = Math.max(maxX, pos.x + size/2);
    minY = Math.min(minY, pos.y - size/2);
    maxY = Math.max(maxY, pos.y + size/2);
  }

  return { minX, minY, maxX, maxY };
}

function transform(ctx: RenderContext, x: number, y: number): { x: number; y: number } {
  return {
    x: x * ctx.scale + ctx.offsetX,
    y: y * ctx.scale + ctx.offsetY,
  };
}

function calculatePinPositions(ctx: RenderContext, items: any[]) {
    pinPositions.clear();
    for (const item of items) {
        const pos = item.schematicPosition || { x: 0, y: 0, rotation: 0 };
        const { x: cx, y: cy } = transform(ctx, pos.x, pos.y);
        const width = 80 * ctx.scale;
        const height = 80 * ctx.scale;

        if (item.allPins) {
            const pins = Array.from((item.allPins as Map<string, Pin>).values());
            const numPins = pins.length;
            const leftPins = pins.slice(0, Math.ceil(numPins / 2));
            const rightPins = pins.slice(Math.ceil(numPins / 2));
            const pinSpacing = height / (Math.max(leftPins.length, rightPins.length) + 1);

            const rotation = pos.rotation || 0;
            const rad = rotation * Math.PI / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);

            // Helper to rotate point around center (cx, cy)
            const rotate = (dx: number, dy: number) => {
                return {
                    x: cx + dx * cos - dy * sin,
                    y: cy + dx * sin + dy * cos
                };
            };

            leftPins.forEach((pin, i) => {
                const dy = -height/2 + (i + 1) * pinSpacing;
                const dx = -width/2;
                pinPositions.set(pin, rotate(dx, dy));
            });

            rightPins.forEach((pin, i) => {
                const dy = -height/2 + (i + 1) * pinSpacing;
                const dx = width/2;
                pinPositions.set(pin, rotate(dx, dy));
            });
        }
    }
}

function calculatePortPositions(ctx: RenderContext, composableInstance: Composable<any>) {
    portPositions.clear();
    if (!composableInstance.allPins) return;

    const pins = Array.from((composableInstance.allPins as Map<string, Pin>).entries());

    // Distribute pins on Left and Right edges of the available area
    const leftX = ctx.marginX;
    const rightX = ctx.marginX + ctx.width;
    const topY = ctx.marginY;
    const bottomY = ctx.marginY + ctx.height;

    const centerY = (topY + bottomY) / 2;
    const spacing = 40;

    const leftPins: [string, Pin][] = [];
    const rightPins: [string, Pin][] = [];

    for (const [name, pin] of pins) {
        const n = name.toLowerCase();
        if (n.includes('out')) {
            rightPins.push([name, pin]);
        } else {
            leftPins.push([name, pin]);
        }
    }

    // Place Left Pins
    leftPins.forEach(([name, pin], i) => {
        const y = centerY + (i - (leftPins.length-1)/2) * spacing;
        portPositions.set(pin, { x: leftX, y, side: 'left' });
    });

    // Place Right Pins
    rightPins.forEach(([name, pin], i) => {
        const y = centerY + (i - (rightPins.length-1)/2) * spacing;
        portPositions.set(pin, { x: rightX, y, side: 'right' });
    });
}

function renderItem(ctx: RenderContext, item: any) {
  const pos = item.schematicPosition || { x: 0, y: 0, rotation: 0 };
  const { x, y } = transform(ctx, pos.x, pos.y);

  const width = 80 * ctx.scale;
  const height = 80 * ctx.scale;

  ctx.doc.save();
  ctx.doc.translate(x, y);
  if (pos.rotation) {
    ctx.doc.rotate(pos.rotation);
  }

  // Draw Box
  ctx.doc.rect(-width/2, -height/2, width, height)
         .lineWidth(STYLES.componentStroke)
         .stroke(COLORS.component);

  // Label
  ctx.doc.fontSize(10 * ctx.scale)
         .fillColor(COLORS.text)
         .text(item.ref, -width/2, -height/2 - 15 * ctx.scale, { width: width, align: 'center' });

  if (item.value) {
      ctx.doc.fontSize(8 * ctx.scale)
         .text(item.value, -width/2, height/2 + 5 * ctx.scale, { width: width, align: 'center' });
  }

  // Render Pins
  if (item.allPins) {
      const pins = Array.from((item.allPins as Map<string, Pin>).values());
      const numPins = pins.length;
      const leftPins = pins.slice(0, Math.ceil(numPins / 2));
      const rightPins = pins.slice(Math.ceil(numPins / 2));

      const pinSpacing = height / (Math.max(leftPins.length, rightPins.length) + 1);

      // Render Left Pins
      leftPins.forEach((pin, i) => {
          const py = -height/2 + (i + 1) * pinSpacing;
          const px = -width/2;
          renderPin(ctx, px, py, pin, 'left');
      });

      // Render Right Pins
      rightPins.forEach((pin, i) => {
          const py = -height/2 + (i + 1) * pinSpacing;
          const px = width/2;
          renderPin(ctx, px, py, pin, 'right');
      });
  }

  ctx.doc.restore();
}

function renderPin(ctx: RenderContext, x: number, y: number, pin: Pin, side: 'left' | 'right') {
    const len = 10 * ctx.scale;

    ctx.doc.moveTo(x, y)
           .lineTo(side === 'left' ? x - len : x + len, y)
           .lineWidth(1)
           .stroke(COLORS.pin);

    ctx.doc.fontSize(6 * ctx.scale)
           .fillColor(COLORS.text)
           .text(pin.name,
                 side === 'left' ? x + 2 : x - 20,
                 y - 3,
                 { width: 20, align: side === 'left' ? 'left' : 'right' });
}

function renderPort(ctx: RenderContext, pin: Pin) {
    const pos = portPositions.get(pin);
    if (!pos) return;

    const { x, y, side } = pos;
    const len = 10;

    ctx.doc.save();
    ctx.doc.lineWidth(1).strokeColor(COLORS.pin);

    // Draw line inward
    ctx.doc.moveTo(x, y)
           .lineTo(side === 'left' ? x + len : x - len, y)
           .stroke();

    // Label
    ctx.doc.fontSize(10).fillColor(COLORS.text);
    if (side === 'left') {
        ctx.doc.text(pin.name, x - 50, y - 5, { width: 45, align: 'right' });
    } else {
        ctx.doc.text(pin.name, x + 5, y - 5, { width: 45, align: 'left' });
    }
    ctx.doc.restore();
}

function renderNet(ctx: RenderContext, net: Net, scopeItems: any[], composableInstance?: Composable<any>) {
    // Determine if Power Net
    if (net.class === "Power") {
        for (const pin of net.pins) {
            if (isPinInScope(pin, scopeItems)) {
                const pos = pinPositions.get(pin);
                if (pos) {
                    renderPowerSymbol(ctx, pos.x, pos.y, net.name);
                }
            }
        }
        return;
    }

    // Signal Net -> Wires
    const connectedPoints: { x: number, y: number }[] = [];

    for (const pin of net.pins) {
        // Check if internal pin in scope
        if (isPinInScope(pin, scopeItems)) {
            const pos = pinPositions.get(pin);
            if (pos) {
                connectedPoints.push(pos);
            }
        }
        // Check if interface pin (port)
        const portPos = portPositions.get(pin);
        if (portPos) {
            connectedPoints.push(portPos);
        }
    }

    if (connectedPoints.length < 2) return;

    // Simple Chain
    connectedPoints.sort((a, b) => a.x - b.x || a.y - b.y);

    ctx.doc.lineWidth(STYLES.wireWidth).strokeColor(COLORS.wire);

    // Draw edges
    for (let i = 0; i < connectedPoints.length - 1; i++) {
        const u = connectedPoints[i];
        const v = connectedPoints[i + 1];

        ctx.doc.moveTo(u.x, u.y)
               .lineTo(v.x, u.y)
               .lineTo(v.x, v.y)
               .stroke();
    }
}

function isPinInScope(pin: Pin, scopeItems: any[]): boolean {
    for (const item of scopeItems) {
        if (item.allPins) {
            for (const exposedPin of (item.allPins as Map<string, Pin>).values()) {
                if (exposedPin === pin) {
                    return true;
                }
            }
        }
    }
    return false;
}

function renderPowerSymbol(ctx: RenderContext, x: number, y: number, name: string) {
    ctx.doc.save();
    ctx.doc.translate(x, y);

    const size = 10 * ctx.scale;
    const isGnd = name.toUpperCase().includes("GND");
    const dir = isGnd ? 1 : -1; // 1 = down, -1 = up

    ctx.doc.moveTo(0, 0).lineTo(0, dir * size).stroke();

    if (isGnd) {
        const w = size;
        ctx.doc.moveTo(-w/2, size).lineTo(w/2, size).stroke();
        ctx.doc.moveTo(-w/3, size + 2).lineTo(w/3, size + 2).stroke();
        ctx.doc.moveTo(-w/6, size + 4).lineTo(w/6, size + 4).stroke();
    } else {
        ctx.doc.moveTo(-size/2, -size/2).lineTo(0, -size).lineTo(size/2, -size/2).stroke();
    }

    ctx.doc.fontSize(8 * ctx.scale)
           .fillColor(COLORS.power)
           .text(name, -20, dir * (size + 15), { width: 40, align: 'center' });

    ctx.doc.restore();
}

function renderMetadata(ctx: RenderContext, schematic: Schematic, title: string) {
    const boxWidth = 200;
    const boxHeight = 80;
    const x = ctx.doc.page.width - ctx.marginX - boxWidth;
    const y = ctx.doc.page.height - ctx.marginY - boxHeight;

    ctx.doc.save();
    ctx.doc.rect(x, y, boxWidth, boxHeight).strokeColor(COLORS.component).lineWidth(1).stroke();

    const padding = 5;
    let currentY = y + padding;

    ctx.doc.fontSize(12).fillColor(COLORS.text).text(title, x + padding, currentY);
    currentY += 15;

    ctx.doc.fontSize(8);
    ctx.doc.text(`Author: ${schematic.author}`, x + padding, currentY);
    currentY += 10;
    ctx.doc.text(`Rev: ${schematic.revision}`, x + padding, currentY);
    currentY += 10;
    ctx.doc.text(`Date: ${new Date().toLocaleDateString()}`, x + padding, currentY);
    currentY += 10;

    if (schematic.description) {
        ctx.doc.text(schematic.description, x + padding, currentY, { width: boxWidth - 2*padding });
    }

    ctx.doc.restore();
}
