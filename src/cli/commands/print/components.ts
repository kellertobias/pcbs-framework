import { Pin } from "../../../synth/types";
import { RenderContext, COLORS, STYLES } from "./types";
import { transform } from "./layout";
import { extractSymbol, KicadSymbolShape } from "./symbols";

function getAttribute(shapeData: any[], name: string): any[] | null {
       for (const node of shapeData) {
              if (Array.isArray(node) && node[0] === name) return node;
       }
       return null;
}

function renderKicadShape(ctx: RenderContext, shape: KicadSymbolShape) {
       const data = shape.data;
       ctx.doc.lineWidth(STYLES.componentStroke).strokeColor(COLORS.component);

       // KiCad uses 1.27/2.54mm grid units. Let's scale them to something readable (e.g. 10x)
       const UNIT_SCALE = 4 * ctx.scale;

       if (shape.type === "rectangle") {
              const start = getAttribute(data, "start");
              const end = getAttribute(data, "end");
              if (start && end) {
                     const x1 = parseFloat(start[1] as string) * UNIT_SCALE;
                     const y1 = parseFloat(start[2] as string) * -UNIT_SCALE; // Invert Y for PDF
                     const x2 = parseFloat(end[1] as string) * UNIT_SCALE;
                     const y2 = parseFloat(end[2] as string) * -UNIT_SCALE;

                     ctx.doc.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)).stroke();

                     const fill = getAttribute(data, "fill");
                     if (fill && fill[1] && typeof fill[1] === "object" && fill[1][1] === "background") {
                            // Background fill
                     }
              }
       } else if (shape.type === "circle") {
              const center = getAttribute(data, "center");
              const radius = getAttribute(data, "radius");
              if (center && radius) {
                     const cx = parseFloat(center[1] as string) * UNIT_SCALE;
                     const cy = parseFloat(center[2] as string) * -UNIT_SCALE;
                     const r = parseFloat(radius[1] as string) * UNIT_SCALE;
                     ctx.doc.circle(cx, cy, r).stroke();
              }
       } else if (shape.type === "polyline") {
              const pts = getAttribute(data, "pts");
              if (pts) {
                     let first = true;
                     for (let i = 1; i < pts.length; i++) {
                            const pt = pts[i] as any[];
                            if (Array.isArray(pt) && pt[0] === "xy") {
                                   const px = parseFloat(pt[1] as string) * UNIT_SCALE;
                                   const py = parseFloat(pt[2] as string) * -UNIT_SCALE;
                                   if (first) {
                                          ctx.doc.moveTo(px, py);
                                          first = false;
                                   } else {
                                          ctx.doc.lineTo(px, py);
                                   }
                            }
                     }
                     ctx.doc.stroke();
              }
       } else if (shape.type === "arc") {
              const start = getAttribute(data, "start");
              const mid = getAttribute(data, "mid");
              const end = getAttribute(data, "end");
              if (start && mid && end) {
                     // Precise arc math from 3 points is complex; approximate it with a smooth curve for now.
                     const sx = parseFloat(start[1] as string) * UNIT_SCALE;
                     const sy = parseFloat(start[2] as string) * -UNIT_SCALE;
                     const mx = parseFloat(mid[1] as string) * UNIT_SCALE;
                     const my = parseFloat(mid[2] as string) * -UNIT_SCALE;
                     const ex = parseFloat(end[1] as string) * UNIT_SCALE;
                     const ey = parseFloat(end[2] as string) * -UNIT_SCALE;

                     ctx.doc.moveTo(sx, sy)
                            .quadraticCurveTo(mx, my, ex, ey)
                            .stroke();
              }
       }
}

export function renderComponent(ctx: RenderContext, item: any): void {
       const pos = item.schematicPosition || { x: 0, y: 0, rotation: 0 };
       const { x, y } = transform(ctx, pos.x, pos.y);

       ctx.doc.save();
       ctx.doc.translate(x, y);
       if (pos.rotation) {
              ctx.doc.rotate(pos.rotation);
       }

       let symData = null;
       if (item.symbol) {
              symData = extractSymbol(item.symbol, process.cwd());
       }

       const width = 80 * ctx.scale;
       const height = 80 * ctx.scale;

       if (symData && symData.shapes.length > 0) {
              // Draw Real Symbol
              for (const shape of symData.shapes) {
                     if (shape.type !== "pin") {
                            renderKicadShape(ctx, shape);
                     }
              }
              // Label
              ctx.doc.fontSize(10 * ctx.scale)
                     .fillColor(COLORS.text)
                     .text(item.ref, -width / 2, -height / 2 - 15 * ctx.scale, { width: width, align: 'center' });
       } else {
              // Draw Fallback Box
              ctx.doc.rect(-width / 2, -height / 2, width, height)
                     .lineWidth(STYLES.componentStroke)
                     .stroke(COLORS.component);

              // Label
              ctx.doc.fontSize(10 * ctx.scale)
                     .fillColor(COLORS.text)
                     .text(item.ref, -width / 2, -height / 2 - 15 * ctx.scale, { width: width, align: 'center' });
       }

       if (item.value) {
              ctx.doc.fontSize(8 * ctx.scale)
                     .text(item.value, -width / 2, height / 2 + 5 * ctx.scale, { width: width, align: 'center' });
       }

       // Render Pins
       if (item.allPins) {
              const pins = Array.from((item.allPins as Map<string, Pin>).values());
              const numPins = pins.length;

              const leftPins = pins.slice(0, Math.ceil(numPins / 2));
              const rightPins = pins.slice(Math.ceil(numPins / 2));
              const pinSpacing = height / (Math.max(leftPins.length, rightPins.length) + 1);

              pins.forEach((pin, i) => {
                     let px = 0;
                     let py = 0;
                     let side: 'left' | 'right' = 'left';

                     if (symData && symData.pins.get(pin.name)) {
                            // Extract exact pin coordinates from KiCad AST
                            const pinAst = symData.pins.get(pin.name);
                            const at = getAttribute(pinAst, "at");
                            const lengthAttr = getAttribute(pinAst, "length");

                            if (at) {
                                   const UNIT_SCALE = 4 * ctx.scale;
                                   px = parseFloat(at[1] as string) * UNIT_SCALE;
                                   py = parseFloat(at[2] as string) * -UNIT_SCALE;
                                   const rot = parseFloat(at[3] as string || "0");

                                   let len = 1.27 * UNIT_SCALE; // default length
                                   if (lengthAttr) {
                                          len = parseFloat(lengthAttr[1] as string) * UNIT_SCALE;
                                   }

                                   // Draw pin line natively! it belongs to the symbol.
                                   const rad = rot * Math.PI / 180;
                                   ctx.doc.moveTo(px, py)
                                          .lineTo(px + Math.cos(rad) * len, py - Math.sin(rad) * len)
                                          .lineWidth(1)
                                          .stroke(COLORS.pin);

                                   if (rot === 0 || rot === 90) { side = 'right'; }
                                   if (rot === 180 || rot === 270) { side = 'left'; }
                            }
                     } else {
                            // Fallback spacing
                            const isLeft = i < Math.ceil(numPins / 2);
                            const listIndex = isLeft ? i : i - Math.ceil(numPins / 2);
                            py = -height / 2 + (listIndex + 1) * pinSpacing;
                            px = isLeft ? -width / 2 : width / 2;
                            side = isLeft ? 'left' : 'right';
                     }

                     renderPin(ctx, px, py, pin, side, symData !== null);
              });
       }

       ctx.doc.restore();
}

export function renderPin(ctx: RenderContext, x: number, y: number, pin: Pin, side: 'left' | 'right', hasRealSymbol: boolean): void {
       const len = 10 * ctx.scale;

       if (!hasRealSymbol) {
              ctx.doc.moveTo(x, y)
                     .lineTo(side === 'left' ? x - len : x + len, y)
                     .lineWidth(1)
                     .stroke(COLORS.pin);
       }

       ctx.doc.fontSize(6 * ctx.scale)
              .fillColor(COLORS.text)
              .text(pin.name,
                     side === 'left' ? x + 2 : x - 20,
                     y - 3,
                     { width: 20, align: side === 'left' ? 'left' : 'right' });

       // Draw an 'X' over the pin connection point if it is strictly marked DNC
       if (pin.isDNC) {
              const pinEnd = side === 'left' ? x - len : x + len;
              // Depending on whether we have a symbol, we might draw the X at the connector end or the literal footprint pin.
              // Usually drawing it exactly at the connection line end is standard
              const cx = hasRealSymbol ? x : pinEnd;
              const cy = y;
              const xSize = 3 * ctx.scale;

              ctx.doc.moveTo(cx - xSize, cy - xSize)
                     .lineTo(cx + xSize, cy + xSize)
                     .moveTo(cx + xSize, cy - xSize)
                     .lineTo(cx - xSize, cy + xSize)
                     .lineWidth(1)
                     .stroke("#ff0000"); // Standard red marking for unconnected
       }
}
