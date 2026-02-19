import * as fs from "fs";
import * as path from "path";
import { FootprintName } from "./types";

// ─── Types ───────────────────────────────────────────────────────────

export type SymbolPinType = "input" | "output" | "power_in" | "power_out" | "bidirectional" | "passive" | "unconnected";
export type SymbolPinSide = "left" | "right" | "top" | "bottom";
export type SymbolPinStyle = "line" | "inverted" | "clock" | "inverted_clock";

export interface SymbolPinOptions {
    name: string;
    number: string;
    x: number;
    y: number;
    side: SymbolPinSide;
    type: SymbolPinType;
    style?: SymbolPinStyle;
    length?: number;
}

export interface SymbolRectOptions {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    fill?: "none" | "background";
    strokeWidth?: number;
}

export interface SymbolTextOptions {
    text: string;
    x: number;
    y: number;
    fontSize?: number;
}

// ─── Internal element types ──────────────────────────────────────────

interface SymPin {
    name: string;
    number: string;
    x: number;
    y: number;
    rotation: number;
    type: SymbolPinType;
    style: SymbolPinStyle;
    length: number;
}

interface SymRect {
    x1: number; y1: number;
    x2: number; y2: number;
    fill: "none" | "background";
    strokeWidth: number;
}

interface SymText {
    text: string;
    x: number; y: number;
    fontSize: number;
}

// ─── Pin side → rotation angle ───────────────────────────────────────

function sideToAngle(side: SymbolPinSide): number {
    switch (side) {
        case "left": return 0;
        case "right": return 180;
        case "top": return 90;
        case "bottom": return 270;
    }
}

// ─── Class ───────────────────────────────────────────────────────────

/**
 * Programmatically builds a KiCad symbol for use in `.kicad_sym` files.
 *
 * @example
 * ```ts
 * const sym = new KicadSymbol({ name: "MyChip", reference: "U", footprint: "Project_Footprints:MyChip" });
 * sym.addRect({ x1: -5, y1: 5, x2: 5, y2: -5 });
 * sym.addPin({ name: "VCC", number: "1", x: -7.62, y: 2.54, side: "left", type: "power_in" });
 * // sym.serialize() returns the (symbol "MyChip" ...) block
 * ```
 */
export class KicadSymbol {
    public readonly name: string;
    public readonly reference: string;
    public readonly footprint: FootprintName;
    public readonly description: string;
    public readonly value: string;

    private _pins: SymPin[] = [];
    private _rects: SymRect[] = [];
    private _texts: SymText[] = [];

    constructor(options: {
        name: string;
        reference?: string;
        footprint?: FootprintName;
        description?: string;
        value?: string;
    }) {
        this.name = options.name;
        this.reference = options.reference ?? "U";
        this.footprint = options.footprint ?? "DNC";
        this.description = options.description ?? "";
        this.value = options.value ?? options.name;
    }

    // ── Builder methods ────────────────────────────────────────────────

    public addPin(options: SymbolPinOptions): this {
        this._pins.push({
            name: options.name,
            number: options.number,
            x: options.x,
            y: options.y,
            rotation: sideToAngle(options.side),
            type: options.type,
            style: options.style ?? "line",
            length: options.length ?? 2.54,
        });
        return this;
    }

    public addRect(options: SymbolRectOptions): this {
        this._rects.push({
            x1: options.x1,
            y1: options.y1,
            x2: options.x2,
            y2: options.y2,
            fill: options.fill ?? "none",
            strokeWidth: options.strokeWidth ?? 0,
        });
        return this;
    }

    public addText(options: SymbolTextOptions): this {
        this._texts.push({
            text: options.text,
            x: options.x,
            y: options.y,
            fontSize: options.fontSize ?? 1.27,
        });
        return this;
    }

    // ── Serialization ──────────────────────────────────────────────────

    /**
     * Serialize this symbol to a KiCad S-expression string.
     * Returns the complete `(symbol "Name" ...)` block including
     * properties, graphical sub-symbol, and pin sub-symbol.
     */
    public serialize(): string {
        const parts: string[] = [];

        parts.push(`\t(symbol "${this.name}"`);
        parts.push(`\t\t(exclude_from_sim no)`);
        parts.push(`\t\t(in_bom yes)`);
        parts.push(`\t\t(on_board yes)`);

        // Properties
        parts.push(this._serializeProperty("Reference", this.reference, 0, -this._estimateHeight() - 2));
        parts.push(this._serializeProperty("Value", this.value, 0, -this._estimateHeight()));

        if (this.footprint) {
            parts.push(this._serializePropertyHidden("Footprint", `Project_Footprints:${this.name}`));
        }
        parts.push(this._serializePropertyHidden("Datasheet", ""));
        parts.push(this._serializePropertyHidden("Description", this.description));

        // Graphical sub-symbol: <Name>_0_1 — contains rectangles
        if (this._rects.length > 0) {
            parts.push(`\t\t(symbol "${this.name}_0_1"`);
            for (const rect of this._rects) {
                parts.push(this._serializeRect(rect));
            }
            parts.push(`\t\t)`);
        }

        // Pin sub-symbol: <Name>_1_1 — contains text and pins
        parts.push(`\t\t(symbol "${this.name}_1_1"`);
        for (const text of this._texts) {
            parts.push(this._serializeText(text));
        }
        for (const pin of this._pins) {
            parts.push(this._serializePin(pin));
        }
        parts.push(`\t\t)`);

        parts.push(`\t\t(embedded_fonts no)`);
        parts.push(`\t)`);

        return parts.join("\n");
    }

    // ── Private helpers ────────────────────────────────────────────────

    private _estimateHeight(): number {
        // Rough estimate for property positioning
        if (this._rects.length > 0) {
            return Math.max(...this._rects.map(r => Math.abs(r.y2 - r.y1)));
        }
        return this._pins.length * 2.54;
    }

    private _serializeProperty(key: string, value: string, x: number, y: number): string {
        let s = `\t\t(property "${key}" "${value}"\n`;
        s += `\t\t\t(at ${x} ${y} 0)\n`;
        s += `\t\t\t(effects\n`;
        s += `\t\t\t\t(font\n`;
        s += `\t\t\t\t\t(size 1.27 1.27)\n`;
        s += `\t\t\t\t)\n`;
        s += `\t\t\t)\n`;
        s += `\t\t)`;
        return s;
    }

    private _serializePropertyHidden(key: string, value: string): string {
        let s = `\t\t(property "${key}" "${value}"\n`;
        s += `\t\t\t(at 0 0 0)\n`;
        s += `\t\t\t(effects\n`;
        s += `\t\t\t\t(font\n`;
        s += `\t\t\t\t\t(size 1.27 1.27)\n`;
        s += `\t\t\t\t)\n`;
        s += `\t\t\t\t(hide yes)\n`;
        s += `\t\t\t)\n`;
        s += `\t\t)`;
        return s;
    }

    private _serializeRect(rect: SymRect): string {
        let s = `\t\t\t(rectangle\n`;
        s += `\t\t\t\t(start ${rect.x1} ${rect.y1})\n`;
        s += `\t\t\t\t(end ${rect.x2} ${rect.y2})\n`;
        s += `\t\t\t\t(stroke\n`;
        s += `\t\t\t\t\t(width ${rect.strokeWidth})\n`;
        s += `\t\t\t\t\t(type default)\n`;
        s += `\t\t\t\t)\n`;
        s += `\t\t\t\t(fill\n`;
        s += `\t\t\t\t\t(type ${rect.fill})\n`;
        s += `\t\t\t\t)\n`;
        s += `\t\t\t)`;
        return s;
    }

    private _serializeText(text: SymText): string {
        let s = `\t\t\t(text "${text.text}"\n`;
        s += `\t\t\t\t(at ${text.x} ${text.y} 0)\n`;
        s += `\t\t\t\t(effects\n`;
        s += `\t\t\t\t\t(font\n`;
        s += `\t\t\t\t\t\t(size ${text.fontSize} ${text.fontSize})\n`;
        s += `\t\t\t\t\t)\n`;
        s += `\t\t\t\t)\n`;
        s += `\t\t\t)`;
        return s;
    }

    private _serializePin(pin: SymPin): string {
        let s = `\t\t\t(pin ${pin.type} ${pin.style}\n`;
        s += `\t\t\t\t(at ${pin.x} ${pin.y} ${pin.rotation})\n`;
        s += `\t\t\t\t(length ${pin.length})\n`;
        s += `\t\t\t\t(name "${pin.name}"\n`;
        s += `\t\t\t\t\t(effects\n`;
        s += `\t\t\t\t\t\t(font\n`;
        s += `\t\t\t\t\t\t\t(size 1.27 1.27)\n`;
        s += `\t\t\t\t\t\t)\n`;
        s += `\t\t\t\t\t)\n`;
        s += `\t\t\t\t)\n`;
        s += `\t\t\t\t(number "${pin.number}"\n`;
        s += `\t\t\t\t\t(effects\n`;
        s += `\t\t\t\t\t\t(font\n`;
        s += `\t\t\t\t\t\t\t(size 1.27 1.27)\n`;
        s += `\t\t\t\t\t\t)\n`;
        s += `\t\t\t\t\t)\n`;
        s += `\t\t\t\t)\n`;
        s += `\t\t\t)`;
        return s;
    }
}