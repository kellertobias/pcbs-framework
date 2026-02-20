import { Pin } from "../../../synth/types";
import { RenderContext, COLORS } from "./types";

export function renderPort(ctx: RenderContext, pin: Pin): void {
  const pos = ctx.portPositions.get(pin);
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
