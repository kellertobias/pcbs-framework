import { Net, Pin } from "../../../synth/index";
import { Composable } from "../../../synth/Composable";
import { RenderContext, STYLES, COLORS } from "./types";
import { renderPowerSymbol } from "./power";

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

export function renderNet(ctx: RenderContext, net: Net, scopeItems: any[], composableInstance?: Composable<any>): void {
  // Determine if Power Net
  if (net.class === "Power") {
    for (const pin of net.pins) {
      if (isPinInScope(pin, scopeItems)) {
        const pos = ctx.pinPositions.get(pin);
        if (pos) {
          renderPowerSymbol(ctx, pos.x, pos.y, net.name);
        }
      }
    }
    return;
  }

  // Signal Net -> Wires
  const connectedPoints: { x: number; y: number }[] = [];

  for (const pin of net.pins) {
    // Check if internal pin in scope
    if (isPinInScope(pin, scopeItems)) {
      const pos = ctx.pinPositions.get(pin);
      if (pos) {
        connectedPoints.push(pos);
      }
    }
    // Check if interface pin (port)
    const portPos = ctx.portPositions.get(pin);
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
