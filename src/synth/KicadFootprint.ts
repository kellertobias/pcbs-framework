import type { ComponentDatasheetMetadata } from '../datasheet/LibraryDatasheets';
import { canonicalFootprintLayer, type SemanticFootprintLayer } from './FootprintLayers';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Model3DLink } from './3d/types';
import type {
    FrontPanelCutout,
    FrontPanelLabelAnchor,
    VerticalFrontPanelInterface,
} from '../frontpanel/types';

// ─── Types ───────────────────────────────────────────────────────────

export type PadType = 'smd' | 'thru_hole' | 'np_thru_hole';
export type PadShape = 'roundrect' | 'circle' | 'rect' | 'oval';
export type FootprintLayer =
    | SemanticFootprintLayer
    | 'User.Eco1'
    | 'User.Eco2'
    | 'User.Drawings'
    | 'Eco1.User'
    | 'Eco2.User'
    | 'F.Cu'
    | 'B.Cu'
    | 'F.SilkS'
    | 'B.SilkS'
    | 'F.Fab'
    | 'B.Fab'
    | 'F.Mask'
    | 'B.Mask'
    | 'F.Paste'
    | 'B.Paste'
    | 'Edge.Cuts'
    | 'Dwgs.User'
    | 'Cmts.User'
    | 'F.CrtYd'
    | 'B.CrtYd';
export type TextJustify = 'left' | 'right' | 'top' | 'bottom';

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
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    layer: string;
    width: number;
    uuid: string;
}

interface FpRect {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    layer: string;
    width: number;
    uuid: string;
}

interface FpArc {
    startX: number;
    startY: number;
    midX: number;
    midY: number;
    endX: number;
    endY: number;
    layer: string;
    width: number;
    uuid: string;
}

interface FpText {
    text: string;
    x: number;
    y: number;
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
    const tabs = '\t'.repeat(level);
    return s
        .split('\n')
        .map((line) => (line ? tabs + line : line))
        .join('\n');
}

// ─── Default pad layers ──────────────────────────────────────────────

function defaultLayers(type: PadType): string[] {
    switch (type) {
        case 'smd':
            return ['F.Cu', 'F.Mask', 'F.Paste'];
        case 'thru_hole':
            return ['*.Cu', '*.Mask'];
        case 'np_thru_hole':
            return ['*.Cu', '*.Mask'];
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
    public readonly attr: 'through_hole' | 'smd';

    private _datasheet?: Partial<ComponentDatasheetMetadata>;

    /** Attach specifications/provenance without changing serialized KiCad geometry. */
    public setDatasheet(metadata: Partial<ComponentDatasheetMetadata>): this {
        this._datasheet = metadata;
        return this;
    }

    public get datasheet(): Partial<ComponentDatasheetMetadata> | undefined {
        return this._datasheet;
    }

    private _pads: FpPad[] = [];
    private _lines: FpLine[] = [];
    private _rects: FpRect[] = [];
    private _arcs: FpArc[] = [];
    private _texts: FpText[] = [];
    private _models3d: Model3DLink[] = [];
    private _keycapLegendSurface?: import('./3d/KeycapLegend').KeycapLegendSurface;
    private _verticalFrontPanelInterface?: VerticalFrontPanelInterface;
    private _frontPanelCutouts: FrontPanelCutout[] = [];
    private _mountingLayerCutouts: FrontPanelCutout[] = [];
    private _userInteractionAreas: FrontPanelCutout[] = [];
    private _value?: string;
    private _frontPanelLabelAnchor?: FrontPanelLabelAnchor;

    constructor(options: {
        name: string;
        layer?: FootprintLayer;
        attr?: 'through_hole' | 'smd';
        value?: string;
    }) {
        this.name = options.name;
        this.layer = options.layer ?? 'F.Cu';
        this.attr = options.attr ?? 'smd';
        this._value = options.value;
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
            layer: canonicalFootprintLayer(options.layer ?? 'F.SilkS'),
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
            layer: canonicalFootprintLayer(options.layer ?? 'F.SilkS'),
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
            layer: canonicalFootprintLayer(options.layer ?? 'F.SilkS'),
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
            layer: canonicalFootprintLayer(options.layer ?? 'F.SilkS'),
            fontSize: options.fontSize ?? 1,
            thickness: options.thickness ?? 0.1,
            justify: options.justify,
            uuid: uuid(),
        });
        return this;
    }

    /** Define a face perpendicular to the PCB; this is not top-view artwork. */
    public setVerticalFrontPanelInterface(face: VerticalFrontPanelInterface): this {
        this._verticalFrontPanelInterface = face;
        return this;
    }

    public setFrontPanelInterface(face: VerticalFrontPanelInterface): this {
        return this.setVerticalFrontPanelInterface(face);
    }

    /** Add a panel opening in footprint-local millimetre coordinates. */
    public addFrontPanelCutout(cutout: FrontPanelCutout): this {
        this.drawMechanicalContour(cutout, 'FrontpanelCutout');
        this._frontPanelCutouts.push(cutout);
        return this;
    }

    /** Actual template value; board generation replaces this with component.value (e.g. 10k). */
    public setValue(value: string): this {
        this._value = value;
        return this;
    }

    /** Frame/mounting-plate openings, NOT front-panel or PCB Edge.Cuts geometry. */
    public addMountingLayerCutout(cutout: FrontPanelCutout): this {
        this.drawMechanicalContour(cutout, 'MountingLayerCutout');
        this._mountingLayerCutouts.push(cutout);
        return this;
    }

    /** Top-view swept operator envelope: keycaps, knobs, travel + endpoint caps. */
    public addUserInteractionArea(area: FrontPanelCutout): this {
        this.drawMechanicalContour(area, 'UserInteractionArea');
        this._userInteractionAreas.push(area);
        return this;
    }

    private drawMechanicalContour(shape: FrontPanelCutout, layer: FootprintLayer): void {
        const width = 0.1;
        if (shape.type === 'circle') {
            if (!Number.isFinite(shape.diameter) || shape.diameter <= 0)
                throw new Error('Circle diameter must be positive');
            const x = shape.x ?? 0,
                y = shape.y ?? 0,
                r = shape.diameter / 2;
            this.addArc({
                start: { x: x + r, y },
                mid: { x, y: y + r },
                end: { x: x - r, y },
                layer,
                width,
            });
            this.addArc({
                start: { x: x - r, y },
                mid: { x, y: y - r },
                end: { x: x + r, y },
                layer,
                width,
            });
            return;
        }
        const radians = (-(shape.rotation ?? 0) * Math.PI) / 180;
        const x = shape.type === 'roundedRect' ? (shape.x ?? 0) : 0;
        const y = shape.type === 'roundedRect' ? (shape.y ?? 0) : 0;
        const point = (p: { x: number; y: number }) => ({
            x: x + p.x * Math.cos(radians) - p.y * Math.sin(radians),
            y: y + p.x * Math.sin(radians) + p.y * Math.cos(radians),
        });
        const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
            if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) return;
            const first = point(a),
                last = point(b);
            this.addLine({ x1: first.x, y1: first.y, x2: last.x, y2: last.y, layer, width });
        };
        if (shape.type === 'polygon') {
            if (shape.points.length < 3) throw new Error('Contour requires at least three points');
            shape.points.forEach((p, i) => line(p, shape.points[(i + 1) % shape.points.length]));
            return;
        }
        if (
            !Number.isFinite(shape.width) ||
            !Number.isFinite(shape.height) ||
            shape.width <= 0 ||
            shape.height <= 0
        )
            throw new Error('Rectangle dimensions must be positive');
        const halfX = shape.width / 2,
            halfY = shape.height / 2;
        const r = Math.max(0, Math.min(shape.radius ?? 0, halfX, halfY));
        line({ x: -halfX + r, y: -halfY }, { x: halfX - r, y: -halfY });
        line({ x: halfX, y: -halfY + r }, { x: halfX, y: halfY - r });
        line({ x: halfX - r, y: halfY }, { x: -halfX + r, y: halfY });
        line({ x: -halfX, y: halfY - r }, { x: -halfX, y: -halfY + r });
        if (!r) return;
        for (let i = 0; i < 4; i++) {
            const a = -Math.PI / 2 + (i * Math.PI) / 2;
            const cx = (i < 2 ? 1 : -1) * (halfX - r),
                cy = (i === 0 || i === 3 ? -1 : 1) * (halfY - r);
            const at = (angle: number) =>
                point({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
            this.addArc({
                start: at(a),
                mid: at(a + Math.PI / 4),
                end: at(a + Math.PI / 2),
                layer,
                width,
            });
        }
    }

    /** Set the footprint-local anchor used by an optional component label. */
    /** Printable face in model-local millimetres (Cartesian Y, not PCB Y).
     * A component frontPanelLabel becomes a fitted opaque WRL mesh on this face. */
    public setKeycapLegendSurface(surface: import('./3d/KeycapLegend').KeycapLegendSurface): this {
        this._keycapLegendSurface = surface;
        return this;
    }

    public setFrontPanelLabelAnchor(anchor: FrontPanelLabelAnchor): this {
        this._frontPanelLabelAnchor = anchor;
        return this;
    }

    /** Model links, including their mounting transforms. */
    public get3DModels(): Model3DLink[] {
        return this._models3d.map((link) => ({
            ...link,
            offset: link.offset && { ...link.offset },
            scale: link.scale && { ...link.scale },
            rotate: link.rotate && { ...link.rotate },
        }));
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
    public addExternal3DModel(
        baseDir: string,
        relativePath: string,
        options?: Omit<Model3DLink, 'path'>,
    ): this {
        const absPath = path.resolve(baseDir, relativePath).replace(/\\/g, '/');
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
        parts.push(this._serializeProperty('Reference', 'REF**', 0, -2, 'F.SilkS'));
        // Value property
        parts.push(
            this._serializeProperty(
                'Value',
                this._value ?? this.name,
                0,
                2,
                this.layer === 'B.Cu' ? 'B.Fab' : 'F.Fab',
            ),
        );
        // Datasheet property (hidden)
        parts.push(this._serializeProperty('Datasheet', '', 0, 0, 'F.Fab', true));
        // Description property (hidden)
        parts.push(this._serializeProperty('Description', '', 0, 0, 'F.Fab', true));
        if (this._verticalFrontPanelInterface) {
            parts.push(
                this._serializeProperty(
                    'VerticalFrontPanelInterface',
                    JSON.stringify(this._verticalFrontPanelInterface),
                    0,
                    0,
                    'F.Fab',
                    true,
                ),
            );
        }
        if (this._frontPanelCutouts.length > 0) {
            parts.push(
                this._serializeProperty(
                    'FrontPanelCutouts',
                    JSON.stringify(this._frontPanelCutouts),
                    0,
                    0,
                    'F.Fab',
                    true,
                ),
            );
        }
        for (const [key, shapes] of [
            ['MountingLayerCutouts', this._mountingLayerCutouts],
            ['UserInteractionAreas', this._userInteractionAreas],
        ] as const) {
            if (shapes.length)
                parts.push(
                    this._serializeProperty(key, JSON.stringify(shapes), 0, 0, 'F.Fab', true),
                );
        }
        if (this._frontPanelLabelAnchor) {
            parts.push(
                this._serializeProperty(
                    'FrontPanelLabelAnchor',
                    JSON.stringify(this._frontPanelLabelAnchor),
                    0,
                    0,
                    'F.Fab',
                    true,
                ),
            );
        }

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

        if (this._keycapLegendSurface) {
            parts.push(
                this._serializeProperty(
                    'KeycapLegendSurface',
                    JSON.stringify(this._keycapLegendSurface),
                    0,
                    0,
                    'F.Fab',
                    true,
                ),
            );
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

        return parts.join('\n') + '\n';
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
        fs.writeFileSync(filePath, this.serialize(), 'utf-8');
        return filePath;
    }

    // ── Private serialization helpers ──────────────────────────────────

    private _serializeProperty(
        key: string,
        value: string,
        x: number,
        y: number,
        layer: string,
        hide = false,
    ): string {
        const id = uuid();
        let s = `\t(property "${this._escapeQuoted(key)}" "${this._escapeQuoted(value)}"\n`;
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

    private _escapeQuoted(value: string): string {
        return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
        return lines
            .map((l) => {
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
            })
            .join('\n');
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
        const typeStr =
            pad.type === 'thru_hole'
                ? 'thru_hole'
                : pad.type === 'np_thru_hole'
                  ? 'np_thru_hole'
                  : 'smd';
        const shapeStr = pad.shape;

        let s = `\t(pad "${pad.number}" ${typeStr} ${shapeStr}\n`;
        s += `\t\t(at ${pad.x} ${pad.y})\n`;
        s += `\t\t(size ${pad.width} ${pad.height})\n`;

        if (pad.drill) {
            let drillStr = '';
            if (typeof pad.drill === 'number') {
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

        s += `\t\t(layers ${pad.layers.map((l) => `"${l}"`).join(' ')})\n`;

        if (pad.shape === 'roundrect' && pad.roundrectRatio != null) {
            s += `\t\t(roundrect_rratio ${pad.roundrectRatio})\n`;
        }

        s += `\t\t(uuid "${pad.uuid}")\n`;
        s += `\t)`;
        return s;
    }
}
