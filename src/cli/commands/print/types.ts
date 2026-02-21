import PDFDocument from "pdfkit";
import { Pin } from "../../../synth/types";

// Constants for styling
export const COLORS = {
  wire: "#006600",
  component: "#000000",
  text: "#000000",
  pin: "#FF0000",
  power: "#0000FF",
};

export const STYLES = {
  wireWidth: 1,
  componentStroke: 1.5,
  pinSize: 2,
};

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RenderContext {
  doc: PDFKit.PDFDocument;
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  marginX: number;
  marginY: number;
  pinPositions: Map<Pin, { x: number; y: number }>;
  portPositions: Map<Pin, { x: number; y: number; side: "left" | "right"; label: string }>;
}
