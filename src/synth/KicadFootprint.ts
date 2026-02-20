import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import type { Model3DLink } from "./3d/types";

// ─── Types ───────────────────────────────────────────────────────────

export type PadType = "smd" | "thru_hole" | "np_thru_hole";
export type PadShape = "roundrect" | "circle" | "rect" | "oval";
export type FootprintLayer = "F.Cu" | "B.Cu" | "F.SilkS" | "B.SilkS" | "F.Fab" | "B.Fab" | "F.Mask" | "B.Mask" | "F.Paste" | "B.Paste" | "Edge.Cuts";
export type TextJustify = "left" | "right" | "top" | "bottom";

export interface FootprintPadOptions {
    number: string;
    type: PadType;
    shape: PadShape;
    x: number;
    y: number;
    width: number;
    height: number;
    layers?: string[];
    /** Roundrect radius ratio (0–1), only used when shape is "roundrect" */
    roundrectRatio?: number;
    /** Drill diameter for through-hole pads (number for round, {x, y} for oval) */
    drill?: number | { x: number; y: number };
    /** Drill X offset from pad center */
    drillOffsetX?: number;
    /** Drill Y offset from pad center */
    drillOffsetY?: number;
}

export interface FootprintLineOptions {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    layer?: FootprintLayer;
    width?: number;
}

export interface FootprintRectOptions {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    layer?: FootprintLayer;
    width?: number;
}

export interface FootprintArcOptions {
    start: { x: number; y: number };
    mid: { x: number; y: number };
    end: { x: number; y: number };
    layer?: FootprintLayer;
    width?: number;
}

export interface FootprintTextOptions {
    text: string;
    x: number;
    y: number;
    layer?: FootprintLayer;
    fontSize?: number;
    thickness?: number;
    justify?: TextJustify;
}

// ─── Internal element types ──────────────────────────────────────────

interface FpPad {
    number: string;
    type: PadType;
    shape: PadShape;
    x: number;
    y: number;
    width: number;
    height: number;
    layers: string[];
    roundrectRatio?: number;
    drill?: number | { x: number; y: number };
    drillOffsetX?: number;
    drillOffsetY?: number;
    uuid: string;
}

interface FpLine {
    x1: number; y1: number;
    x2: number; y2: number;
    layer: string;
    width: number;
    uuid: string;
}

interface FpRect {
    x1: number; y1: number;
    x2: number; y2: number;
    layer: string;
    width: number;
    uuid: string;
}

interface FpArc {
    startX: number; startY: number;
    midX: number; midY: number;
    endX: number; endY: number;
    layer: string;
    width: number;
    uuid: string;
}

interface FpText {
    text: string;
    x: number; y: number;
    layer: string;
    fontSize: number;
    thickness: number;
    justify?: TextJustify;
    uuid: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function uuid(): string {
    return randomUUID();
}

function indent(s: string, level: number): string {
    const tabs = "\t".repeat(level);
    return s.split("\n").map(line => line ? tabs + line : line).join("\n");
}

// ─── Default pad layers ──────────────────────────────────────────────

function defaultLayers(type: PadType): string[] {
    switch (type) {
        case "smd":
            return ["F.Cu", "F.Mask", "F.Paste"];
        case "thru_hole":
            return ["*.Cu", "*.Mask"];
        case "np_thru_hole":
            return ["*.Cu", "*.Mask"];
    }
}

// ─── Class ───────────────────────────────────────────────────────────

/**
 * Programmatically builds a KiCad footprint (.kicad_mod) file.
 *
 * @example
 * ```ts
 * const fp = new KicadFootprint({ name: "MyModule" });
 * fp.addPad({ number: "1", type: "smd", shape: "roundrect", x: 0, y: 0, width: 1.5, height: 0.8 });
 * fp.addLine({ x1: -2, y1: -1, x2: 2, y2: -1 });
 * fs.writeFileSync("MyModule.kicad_mod", fp.serialize());
 * ```
 */
export class KicadFootprint {
    public readonly name: string;
    /** Default layer for the footprint */
    public readonly layer: FootprintLayer;
    /** Footprint attribute: through_hole or smd */
    public readonly attr: "through_hole" | "smd";

    private _pads: FpPad[] = [];
    private _lines: FpLine[] = [];
    private _rects: FpRect[] = [];
    private _arcs: FpArc[] = [];
    private _texts: FpText[] = [];
    private _models3d: Model3DLink[] = [];

    constructor(options: {
        name: string;
        layer?: FootprintLayer;
        attr?: "through_hole" | "smd";
    }) {
        this.name = options.name;
        this.layer = options.layer ?? "F.Cu";
        this.attr = options.attr ?? "smd";
    }

    // ── Builder methods ────────────────────────────────────────────────

    public addPad(options: FootprintPadOptions): this {
        this._pads.push({
            number: options.number,
            type: options.type,
            shape: options.shape,
            x: options.x,
            y: options.y,
            width: options.width,
            height: options.height,
            layers: options.layers ?? defaultLayers(options.type),
            roundrectRatio: options.roundrectRatio,
            drill: options.drill,
            drillOffsetX: options.drillOffsetX,
            drillOffsetY: options.drillOffsetY,
            uuid: uuid(),
        });
        return this;
    }

    public addLine(options: FootprintLineOptions): this {
        this._lines.push({
            x1: options.x1,
            y1: options.y1,
            x2: options.x2,
            y2: options.y2,
            layer: options.layer ?? "F.SilkS",
            width: options.width ?? 0.15,
            uuid: uuid(),
        });
        return this;
    }

    public addRect(options: FootprintRectOptions): this {
        this._rects.push({
            x1: options.x1,
            y1: options.y1,
            x2: options.x2,
            y2: options.y2,
            layer: options.layer ?? "F.SilkS",
            width: options.width ?? 0.15,
            uuid: uuid(),
        });
        return this;
    }

    public addArc(options: FootprintArcOptions): this {
        this._arcs.push({
            startX: options.start.x,
            startY: options.start.y,
            midX: options.mid.x,
            midY: options.mid.y,
            endX: options.end.x,
            endY: options.end.y,
            layer: options.layer ?? "F.SilkS",
            width: options.width ?? 0.15,
            uuid: uuid(),
        });
        return this;
    }

    public addText(options: FootprintTextOptions): this {
        this._texts.push({
            text: options.text,
            x: options.x,
            y: options.y,
            layer: options.layer ?? "F.SilkS",
            fontSize: options.fontSize ?? 1,
            thickness: options.thickness ?? 0.1,
            justify: options.justify,
            uuid: uuid(),
        });
        return this;
    }

    /**
     * Link a 3D model file to this footprint.
     * The path should be relative to the footprint file.
     * Note: For backwards compatibility, this clears existing models and sets only this one.
     */
    public set3DModel(link: Model3DLink): this {
        this._models3d = [link];
        return this;
    }

    /**
     * Add a 3D model file to this footprint.
     */
    public add3DModel(link: Model3DLink): this {
        this._models3d.push(link);
        return this;
    }

    /**
     * Add an external 3D model file to this footprint, saving the absolute path directly.
     * Useful for referencing a file relative to the TS source using __dirname,
     * so it doesn't need to be placed in the target generation directory.
     *
     * @example
     * fp.addExternal3DModel(__dirname, 'XlrMaleCombo.step'); // resolves to absolute path
     */
    public addExternal3DModel(baseDir: string, relativePath: string, options?: Omit<Model3DLink, "path">): this {
        const absPath = path.resolve(baseDir, relativePath).replace(/\\/g, "/");
        this.add3DModel({ path: absPath, ...options });
        return this;
    }

    // ── Serialization ──────────────────────────────────────────────────

    public serialize(): string {
        const parts: string[] = [];

        parts.push(`(footprint "${this.name}"`);
        parts.push(`\t(version 20241229)`);
        parts.push(`\t(generator "pcb_framework")`);
        parts.push(`\t(generator_version "9.0")`);
        parts.push(`\t(layer "${this.layer}")`);

        // Reference property
        parts.push(this._serializeProperty("Reference", "REF**", 0, -2, "F.SilkS"));
        // Value property
        parts.push(this._serializeProperty("Value", this.name, 0, 2, "F.Fab"));
        // Datasheet property (hidden)
        parts.push(this._serializeProperty("Datasheet", "", 0, 0, "F.Fab", true));
        // Description property (hidden)
        parts.push(this._serializeProperty("Description", "", 0, 0, "F.Fab", true));

        // Attribute
        parts.push(`\t(attr ${this.attr})`);

        // Lines
        for (const line of this._lines) {
            parts.push(this._serializeLine(line));
        }

        // Rectangles (rendered as 4 fp_line segments)
        for (const rect of this._rects) {
            parts.push(this._serializeRect(rect));
        }

        // Arcs
        for (const arc of this._arcs) {
            parts.push(this._serializeArc(arc));
        }

        // Texts
        for (const text of this._texts) {
            parts.push(this._serializeText(text));
        }

        // Pads
        for (const pad of this._pads) {
            parts.push(this._serializePad(pad));
        }

        // 3D model links
        for (const m of this._models3d) {
            const ox = m.offset?.x ?? 0;
            const oy = m.offset?.y ?? 0;
            const oz = m.offset?.z ?? 0;
            const sx = m.scale?.x ?? 1;
            const sy = m.scale?.y ?? 1;
            const sz = m.scale?.z ?? 1;
            const rx = m.rotate?.x ?? 0;
            const ry = m.rotate?.y ?? 0;
            const rz = m.rotate?.z ?? 0;
            parts.push(`\t(model "${m.path}"`);
            parts.push(`\t\t(offset (xyz ${ox} ${oy} ${oz}))`);
            parts.push(`\t\t(scale (xyz ${sx} ${sy} ${sz}))`);
            parts.push(`\t\t(rotate (xyz ${rx} ${ry} ${rz}))`);
            parts.push(`\t)`);
        }

        parts.push(`\t(embedded_fonts no)`);
        parts.push(`)`);

        return parts.join("\n") + "\n";
    }

    /**
     * Write the footprint to a `.pretty` directory.
     * Creates the directory if it doesn't exist.
     * @returns The full path to the written file.
     */
    public writeFile(prettyDir: string): string {
        if (!fs.existsSync(prettyDir)) {
            fs.mkdirSync(prettyDir, { recursive: true });
        }
        const filePath = path.join(prettyDir, `${this.name}.kicad_mod`);
        fs.writeFileSync(filePath, this.serialize(), "utf-8");
        return filePath;
    }

    // ── Private serialization helpers ──────────────────────────────────

    private _serializeProperty(key: string, value: string, x: number, y: number, layer: string, hide = false): string {
        const id = uuid();
        let s = `\t(property "${key}" "${value}"\n`;
        s += `\t\t(at ${x} ${y} 0)\n`;
        s += `\t\t(layer "${layer}")\n`;
        if (hide) {
            s += `\t\t(hide yes)\n`;
        }
        s += `\t\t(uuid "${id}")\n`;
        s += `\t\t(effects\n`;
        s += `\t\t\t(font\n`;
        s += `\t\t\t\t(size 1 1)\n`;
        s += `\t\t\t\t(thickness 0.15)\n`;
        s += `\t\t\t)\n`;
        s += `\t\t)\n`;
        s += `\t)`;
        return s;
    }

    private _serializeLine(line: FpLine): string {
        let s = `\t(fp_line\n`;
        s += `\t\t(start ${line.x1} ${line.y1})\n`;
        s += `\t\t(end ${line.x2} ${line.y2})\n`;
        s += `\t\t(stroke\n`;
        s += `\t\t\t(width ${line.width})\n`;
        s += `\t\t\t(type solid)\n`;
        s += `\t\t)\n`;
        s += `\t\t(layer "${line.layer}")\n`;
        s += `\t\t(uuid "${line.uuid}")\n`;
        s += `\t)`;
        return s;
    }

    private _serializeRect(rect: FpRect): string {
        // Render rect as 4 individual lines forming a box
        const lines = [
            { x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y1 }, // top
            { x1: rect.x2, y1: rect.y1, x2: rect.x2, y2: rect.y2 }, // right
            { x1: rect.x2, y1: rect.y2, x2: rect.x1, y2: rect.y2 }, // bottom
            { x1: rect.x1, y1: rect.y2, x2: rect.x1, y2: rect.y1 }, // left
        ];
        return lines.map(l => {
            let s = `\t(fp_line\n`;
            s += `\t\t(start ${l.x1} ${l.y1})\n`;
            s += `\t\t(end ${l.x2} ${l.y2})\n`;
            s += `\t\t(stroke\n`;
            s += `\t\t\t(width ${rect.width})\n`;
            s += `\t\t\t(type solid)\n`;
            s += `\t\t)\n`;
            s += `\t\t(layer "${rect.layer}")\n`;
            s += `\t\t(uuid "${uuid()}")\n`;
            s += `\t)`;
            return s;
        }).join("\n");
    }

    private _serializeArc(arc: FpArc): string {
        let s = `\t(fp_arc\n`;
        s += `\t\t(start ${arc.startX} ${arc.startY})\n`;
        s += `\t\t(mid ${arc.midX} ${arc.midY})\n`;
        s += `\t\t(end ${arc.endX} ${arc.endY})\n`;
        s += `\t\t(stroke\n`;
        s += `\t\t\t(width ${arc.width})\n`;
        s += `\t\t\t(type solid)\n`;
        s += `\t\t)\n`;
        s += `\t\t(layer "${arc.layer}")\n`;
        s += `\t\t(uuid "${arc.uuid}")\n`;
        s += `\t)`;
        return s;
    }

    private _serializeText(text: FpText): string {
        let s = `\t(fp_text user "${text.text}"\n`;
        s += `\t\t(at ${text.x} ${text.y} 0)\n`;
        s += `\t\t(unlocked yes)\n`;
        s += `\t\t(layer "${text.layer}")\n`;
        s += `\t\t(uuid "${text.uuid}")\n`;
        s += `\t\t(effects\n`;
        s += `\t\t\t(font\n`;
        s += `\t\t\t\t(size ${text.fontSize} ${text.fontSize})\n`;
        s += `\t\t\t\t(thickness ${text.thickness})\n`;
        s += `\t\t\t)\n`;
        if (text.justify) {
            s += `\t\t\t(justify ${text.justify} bottom)\n`;
        }
        s += `\t\t)\n`;
        s += `\t)`;
        return s;
    }

    private _serializePad(pad: FpPad): string {
        const typeStr = pad.type === "thru_hole" ? "thru_hole" : pad.type === "np_thru_hole" ? "np_thru_hole" : "smd";
        const shapeStr = pad.shape;

        let s = `\t(pad "${pad.number}" ${typeStr} ${shapeStr}\n`;
        s += `\t\t(at ${pad.x} ${pad.y})\n`;
        s += `\t\t(size ${pad.width} ${pad.height})\n`;

        if (pad.drill) {
            let drillStr = "";
            if (typeof pad.drill === "number") {
                drillStr = `${pad.drill}`;
            } else {
                drillStr = `oval ${pad.drill.x} ${pad.drill.y}`;
            }

            if (pad.drillOffsetX != null || pad.drillOffsetY != null) {
                const ox = pad.drillOffsetX ?? 0;
                const oy = pad.drillOffsetY ?? 0;
                s += `\t\t(drill ${drillStr} (offset ${ox} ${oy}))\n`;
            } else {
                s += `\t\t(drill ${drillStr})\n`;
            }
        }

        s += `\t\t(layers ${pad.layers.map(l => `"${l}"`).join(" ")})\n`;

        if (pad.shape === "roundrect" && pad.roundrectRatio != null) {
            s += `\t\t(roundrect_rratio ${pad.roundrectRatio})\n`;
        }

        s += `\t\t(uuid "${pad.uuid}")\n`;
        s += `\t)`;
        return s;
    }
}