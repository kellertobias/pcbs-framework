import { Schematic } from "../../../synth/Schematic";
import { RenderContext, COLORS } from "./types";

export function renderMetadata(ctx: RenderContext, schematic: Schematic, title: string): void {
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
