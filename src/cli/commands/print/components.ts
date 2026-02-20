import { Pin } from "../../../synth/types";
import { RenderContext, COLORS, STYLES } from "./types";
import { transform } from "./layout";

export function renderComponent(ctx: RenderContext, item: any): void {
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

export function renderPin(ctx: RenderContext, x: number, y: number, pin: Pin, side: 'left' | 'right'): void {
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
