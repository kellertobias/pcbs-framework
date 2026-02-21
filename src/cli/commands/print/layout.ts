import { Pin } from "../../../synth/types";
import { Composable } from "../../../synth/Composable";
import { RenderContext, BBox } from "./types";
import { extractSymbol } from "./symbols";

function getAttribute(shapeData: any[], name: string): any[] | null {
  for (const node of shapeData) {
    if (Array.isArray(node) && node[0] === name) return node;
  }
  return null;
}

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
    minX = Math.min(minX, pos.x - size / 2);
    maxX = Math.max(maxX, pos.x + size / 2);
    minY = Math.min(minY, pos.y - size / 2);
    maxY = Math.max(maxY, pos.y + size / 2);
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
    const UNIT_SCALE = 4 * ctx.scale;

    let symData = null;
    if (item.symbol) {
      symData = extractSymbol(item.symbol, process.cwd());
    }

    if (item.allPins) {
      const pins = Array.from((item.allPins as Map<string, Pin>).values());
      const numPins = pins.length;
      const leftPinsCount = Math.ceil(numPins / 2);
      const rightPinsCount = numPins - leftPinsCount;
      const pinSpacing = height / (Math.max(leftPinsCount, rightPinsCount) + 1);

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

      pins.forEach((pin, i) => {
        let dx: number;
        let dy: number;

        if (symData && symData.pins.has(pin.name)) {
          const pinAst = symData.pins.get(pin.name);
          const at = getAttribute(pinAst, "at");
          const lengthAttr = getAttribute(pinAst, "length");

          if (at) {
            const px = parseFloat(at[1] as string) * UNIT_SCALE;
            const py = parseFloat(at[2] as string) * -UNIT_SCALE;
            const pRot = parseFloat(at[3] as string || "0");
            let len = 1.27 * UNIT_SCALE;
            if (lengthAttr) {
              len = parseFloat(lengthAttr[1] as string) * UNIT_SCALE;
            }
            const pRad = pRot * Math.PI / 180;
            dx = px + Math.cos(pRad) * len;
            dy = py - Math.sin(pRad) * len;
          } else {
            dx = 0; dy = 0;
          }
        } else {
          const isLeft = i < leftPinsCount;
          const listIndex = isLeft ? i : i - leftPinsCount;
          dy = -height / 2 + (listIndex + 1) * pinSpacing;
          const len = 10 * ctx.scale;
          dx = isLeft ? -width / 2 - len : width / 2 + len;
        }

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
    const y = centerY + (i - (leftPins.length - 1) / 2) * spacing;
    ctx.portPositions.set(pin, { x: leftX, y, side: 'left', label: name });
  });

  // Place Right Pins
  rightPins.forEach(([name, pin], i) => {
    const y = centerY + (i - (rightPins.length - 1) / 2) * spacing;
    ctx.portPositions.set(pin, { x: rightX, y, side: 'right', label: name });
  });
}
