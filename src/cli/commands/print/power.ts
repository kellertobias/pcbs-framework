import { RenderContext, COLORS } from "./types";

export function renderPowerSymbol(ctx: RenderContext, x: number, y: number, name: string): void {
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
