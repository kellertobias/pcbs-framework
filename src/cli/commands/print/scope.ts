import PDFDocument from "pdfkit";
import { Schematic } from "../../../synth/Schematic";
import { Composable } from "../../../synth/Composable";
import { Net } from "../../../synth/Net";
import { Pin } from "../../../synth/types";
import { RenderContext } from "./types";
import { calculateBBox, calculatePinPositions, calculatePortPositions } from "./layout";
import { renderComponent } from "./components";
import { renderPort } from "./ports";
import { renderNet } from "./nets";
import { renderMetadata } from "./metadata";

export function renderScope(
  doc: PDFKit.PDFDocument,
  title: string,
  items: any[],
  nets: Net[],
  schematic: Schematic,
  composableInstance?: Composable<any>
): void {
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
    pinPositions: new Map<Pin, { x: number; y: number }>(),
    portPositions: new Map<Pin, { x: number; y: number; side: "left" | "right" }>(),
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
  }

  // Render Items
  for (const item of items) {
    renderComponent(ctx, item);
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
