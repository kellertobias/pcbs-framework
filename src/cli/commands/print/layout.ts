import { Pin } from "../../../synth/types";
import { Composable } from "../../../synth/Composable";
import { RenderContext, BBox } from "./types";

export function transform(ctx: RenderContext, x: number, y: number): { x: number; y: number } {
  return {
    x: x * ctx.scale + ctx.offsetX,
    y: y * ctx.scale + ctx.offsetY,
  };
}

export function calculateBBox(items: any[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  if (items.length === 0) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  }

  for (const item of items) {
    const pos = item.schematicPosition || { x: 0, y: 0 };
    const size = 100; // approximation
    minX = Math.min(minX, pos.x - size/2);
    maxX = Math.max(maxX, pos.x + size/2);
    minY = Math.min(minY, pos.y - size/2);
    maxY = Math.max(maxY, pos.y + size/2);
  }

  return { minX, minY, maxX, maxY };
}

export function calculatePinPositions(ctx: RenderContext, items: any[]): void {
  ctx.pinPositions.clear();
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
        ctx.pinPositions.set(pin, rotate(dx, dy));
      });

      rightPins.forEach((pin, i) => {
        const dy = -height/2 + (i + 1) * pinSpacing;
        const dx = width/2;
        ctx.pinPositions.set(pin, rotate(dx, dy));
      });
    }
  }
}

export function calculatePortPositions(ctx: RenderContext, composableInstance: Composable<any>): void {
  ctx.portPositions.clear();
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
    ctx.portPositions.set(pin, { x: leftX, y, side: 'left' });
  });

  // Place Right Pins
  rightPins.forEach(([name, pin], i) => {
    const y = centerY + (i - (rightPins.length-1)/2) * spacing;
    ctx.portPositions.set(pin, { x: rightX, y, side: 'right' });
  });
}
