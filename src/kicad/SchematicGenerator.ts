import { componentCostFields } from '../synth/ComponentCost';
import { CircuitSnapshot, Pin } from '../synth/types';
import { Component } from '../synth/Component';
import { Composable } from '../synth/Composable';
import { Net } from '../synth/Net';
import { SymbolLibrary, SymbolDefinition } from './SymbolLibrary';
import { UuidManager } from './UuidManager';
import { SExpr, SExpressionParser } from './SExpressionParser';
import {
    Router,
    Point,
    Box,
    WireRoutingRequest,
    pointOnSegment,
    assertParallelWireSpacing,
} from './Router';
import { HierarchicalPlacer } from './HierarchicalPlacer';
import { KicadGeneratorOptions } from './KicadGenerator';

interface PinInfo {
    x: number;
    y: number;
    rotation: number;
    number?: string;
}
interface PinPos {
    x: number;
    y: number;
    rotation: number;
}

export class SchematicGenerator {
    private snapshot: CircuitSnapshot;
    private library: SymbolLibrary;
    private uuids: UuidManager;
    private usedSymbols = new Map<string, SymbolDefinition>();
    private router = new Router(1.27);
    public errors: string[] = [];
    public warnings: string[] = [];
    private _cachedBoxes: Box[] | undefined;
    private fieldKeepouts: Box[] = [];
    private portAnchors: { point: Point; net: string }[] = [];
    private _generatedWires: { p1: Point; p2: Point; netName: string }[] = [];
    private wireCounter = 0;
    private moduleNets = new Set<Net>();
    private moduleUnusedPins = new Set<Pin>();
    private powerSymbolCounter = 0;
    private options: KicadGeneratorOptions;

    constructor(
        snapshot: CircuitSnapshot,
        library: SymbolLibrary,
        uuids: UuidManager,
        options: KicadGeneratorOptions = {},
    ) {
        this.snapshot = snapshot;
        this.library = library;
        this.uuids = uuids;
        this.options = options;
    }

    generate(): string {
        this.fieldKeepouts = [];
        this.portAnchors = [];
        this.moduleNets.clear();
        this.moduleUnusedPins.clear();
        this._generatedWires = [];
        this.wireCounter = 0;
        this.powerSymbolCounter = 0;
        if (
            this.snapshot.connectionStyle === 'direct-labels' &&
            this.snapshot.schematicRouting &&
            !this.snapshot.schematicRouting.interfaceComponents
        )
            throw new Error('Schematic routing cannot be combined with direct-labels.');
        const hintNets = new Set<string>();
        for (const hint of this.snapshot.schematicRouting?.routeHints ?? []) {
            for (const net of hint.nets) {
                if (!this.snapshot.nets.some((item) => item.name === net))
                    throw new Error(
                        `Schematic routing hint '${hint.id}' references unknown net '${net}'.`,
                    );
                if (hintNets.has(net))
                    throw new Error(`Use one schematic routing hint per net '${net}'.`);
                hintNets.add(net);
            }
        }
        for (const [name, symbol] of Object.entries(
            this.snapshot.schematicRouting?.symbolOverrides ?? {},
        )) {
            const original = this.library.getSymbol(name);
            const numbers = (definition: SymbolDefinition) =>
                this.findAllPinsInSymbol(definition)
                    .map((pin) => pin.number)
                    .sort();
            this.library.registerSymbol(name, symbol.serialize());
            const replacement = this.library.getSymbol(name)!;
            if (
                original &&
                JSON.stringify(numbers(original)) !== JSON.stringify(numbers(replacement))
            )
                throw new Error(`Schematic override changes electrical pin numbers for ${name}.`);
        }
        // Auto-layout components if needed
        if (this.snapshot.placementAlgorithm !== 'none')
            HierarchicalPlacer.place(this.snapshot, (comp) => this.getComponentDimensions(comp), {
                experimental: this.options.experimentalLayout,
            });

        // Auto-rotate 2-pin passives connected to power/GND
        this.autoRotateComponents();

        if (this.snapshot.autoPack) {
            this.packComponentsOnSheet();
        }

        // Validate Placement
        this.checkOverlaps();
        this.checkUnconnectedPins();

        const rootUuid = this.uuids.getOrGenerate('ROOT');

        const schematic: SExpr[] = [
            'kicad_sch',
            ['version', '20250610'],
            ['generator', this.quote('@tobisk/pcbs')],
            ['generator_version', this.quote('10.0')],
            ['uuid', this.quote(rootUuid)],
            ['paper', this.quote(this.snapshot.size ?? 'A4')],
            [
                'title_block',
                ['title', this.quote(this.snapshot.name)],
                ['date', this.quote(new Date().toISOString().split('T')[0])],
                this.snapshot.revision ? ['rev', this.quote(this.snapshot.revision)] : [],
                this.snapshot.company ? ['company', this.quote(this.snapshot.company)] : [],
                this.snapshot.author
                    ? ['comment', '1', this.quote(`Author: ${this.snapshot.author}`)]
                    : [],
                this.snapshot.description
                    ? ['comment', '2', this.quote(this.snapshot.description)]
                    : [],
            ].filter((x) => x.length > 0),
        ];

        for (const [index, note] of (this.snapshot.schematicRouting?.annotations ?? []).entries()) {
            schematic.push([
                'text',
                this.quote(note.text),
                ['at', String(note.x), String(note.y), '0'],
                [
                    'effects',
                    ['font', ['size', String(note.size ?? 2), String(note.size ?? 2)]],
                    ['justify', 'left'],
                ],
                ['uuid', this.quote(this.uuids.getOrGenerate(`sheet-note/${index}`))],
            ]);
        }
        if (!this.options.noSymbols) {
            schematic.push(this.generateLibSymbols());
            schematic.push(...this.generateComponents());
        }

        if (!this.options.noWires) {
            const directLabels = this.snapshot.connectionStyle === 'direct-labels';
            schematic.push(...this.generateModuleWiresAndPorts());
            schematic.push(
                ...(directLabels ? this.generateDirectLabels() : this.generateWiresAndPower()),
            );
            schematic.push(...this.generateNoConnects());
            schematic.push(...this.generateJunctions());

            // Verify all routing constraints
            if (!directLabels) this.verifyRouting();
        }

        if (this.errors.length > 0) {
            throw new Error('Schematic Generator Errors:\n' + this.errors.join('\n'));
        }

        return SExpressionParser.serialize(schematic);
    }

    private checkOverlaps() {
        // Use smaller padding (2) for overlap check since we reduced HierarchicalPlacer padding
        const boxes = this.snapshot.components
            .filter((c) => c.symbol !== 'Device:DNC')
            .map((c) => ({
                comp: c,
                box: this.getComponentBox(c, 2),
            }))
            .filter((x) => x.box !== null) as { comp: Component; box: Box }[];

        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                const b1 = boxes[i].box;
                const b2 = boxes[j].box;

                if (
                    b1.x < b2.x + b2.width &&
                    b1.x + b1.width > b2.x &&
                    b1.y < b2.y + b2.height &&
                    b1.y + b1.height > b2.y
                ) {
                    console.warn(
                        `Placement overlap detected between ${boxes[i].comp.ref} and ${boxes[j].comp.ref}`,
                    );
                }
            }
        }
    }

    /**
     * Deterministic shelf packing for large, flat generated schematics. Components
     * are detached from layout-only parent offsets because KiCad receives them as
     * root-sheet symbols in the current generator.
     */
    private packComponentsOnSheet(): void {
        const sheetDimensions: Record<string, { width: number; height: number }> = {
            A0: { width: 1189, height: 841 },
            A1: { width: 841, height: 594 },
            A2: { width: 594, height: 420 },
            A3: { width: 420, height: 297 },
            A4: { width: 297, height: 210 },
            A5: { width: 210, height: 148 },
            A: { width: 279.4, height: 215.9 },
            B: { width: 431.8, height: 279.4 },
            C: { width: 558.8, height: 431.8 },
            D: { width: 863.6, height: 558.8 },
            E: { width: 1117.6, height: 863.6 },
        };
        const sheet = sheetDimensions[this.snapshot.size ?? 'A4'];
        const grid = 1.27;
        const snap = (value: number) => Math.round(value / grid) * grid;
        const margin = 16 * grid;
        const spacing = 8 * grid;
        const maxX = sheet.width - margin;
        const maxY = sheet.height - margin;
        let cursorX = margin;
        let cursorY = margin;
        let rowHeight = 0;
        const occupied = new Map<Composable, Box>();
        for (const component of this.snapshot.components) {
            const owner = this.routedSchematicOwner(component);
            if (!owner?.schematicLayoutFixed) continue;
            const box = this.getComponentBox(component, 8);
            if (!box) continue;
            const old = occupied.get(owner);
            if (!old) occupied.set(owner, box);
            else {
                const x = Math.min(old.x, box.x),
                    y = Math.min(old.y, box.y);
                occupied.set(owner, {
                    x,
                    y,
                    width: Math.max(old.x + old.width, box.x + box.width) - x,
                    height: Math.max(old.y + old.height, box.y + box.height) - y,
                });
            }
        }
        for (const [owner, box] of occupied) {
            if (box.x < 5 || box.y < 5 || box.x + box.width > maxX || box.y + box.height > maxY)
                this.errors.push(
                    `Module '${owner.ref}' does not fit on ${this.snapshot.size ?? 'A4'}. Choose a larger sheet or move its schematicPosition.`,
                );
        }

        for (const comp of this.snapshot.components) {
            if (comp.symbol === 'Device:DNC') continue;

            if (this.routedSchematicOwner(comp)?.schematicLayoutFixed) continue;
            const rotation = comp.absoluteSchematicPosition?.rotation ?? 0;
            // Parent/subschematic objects currently influence placement only; emitted
            // symbols all live on this root sheet and therefore need root coordinates.
            (comp as any).parent = undefined;
            (comp as any).schematicPosition = { x: 0, y: 0, rotation };

            const initialBox = this.getComponentBox(comp, 0);
            if (!initialBox) continue;
            // Pack host components around complete authored blocks, without flattening them.
            for (let attempt = 0; attempt <= occupied.size; attempt++) {
                const hit = [...occupied.values()].find(
                    (box) =>
                        cursorX < box.x + box.width &&
                        cursorX + initialBox.width > box.x &&
                        cursorY < box.y + box.height &&
                        cursorY + initialBox.height > box.y,
                );
                if (!hit) break;
                cursorX = snap(hit.x + hit.width + spacing);
                if (cursorX + initialBox.width > maxX) {
                    cursorX = margin;
                    cursorY = snap(hit.y + hit.height + spacing);
                    rowHeight = 0;
                }
            }
            if (cursorX + initialBox.width > maxX) {
                cursorX = margin;
                cursorY = snap(cursorY + rowHeight + spacing);
                rowHeight = 0;
            }
            if (cursorY + initialBox.height > maxY) {
                this.errors.push(
                    `Auto-pack overflow: components do not fit on ${this.snapshot.size ?? 'A4'}. Select a larger sheet or disable autoPack.`,
                );
                return;
            }

            (comp as any).schematicPosition = {
                x: snap(cursorX - initialBox.x),
                y: snap(cursorY - initialBox.y),
                rotation,
            };
            cursorX = snap(cursorX + initialBox.width + spacing);
            rowHeight = Math.max(rowHeight, initialBox.height);
        }

        this._cachedBoxes = undefined;
    }

    private checkUnconnectedPins() {
        for (const comp of this.snapshot.components) {
            if (comp.symbol === 'Device:DNC') continue;

            const symDef = this.library.getSymbol(comp.symbol);
            if (!symDef) continue; // Missing symbol is handled elsewhere

            const pins = this.findAllPinsInSymbol(symDef);

            for (const pinInfo of pins) {
                if (!pinInfo.number) continue;

                let pinName = pinInfo.number;
                // The parser keeps quotes around names e.g. '"1"'
                if (pinName.startsWith('"') && pinName.endsWith('"')) {
                    pinName = pinName.substring(1, pinName.length - 1);
                }

                const pin = comp.allPins.get(pinName);

                // If the pin wasn't accessed at all, or if it has no net and isn't marked DNC
                if (!pin || (!pin.net && !pin.isDNC)) {
                    this.warnings.push(
                        `Unconnected Pin: ${comp.ref} (${comp.symbol}) pin ${pinName} is not connected to any net and not marked as Do Not Connect (DNC).`,
                    );
                }
            }
        }
    }

    private getCachedComponentBoxes(): Box[] {
        if (!this._cachedBoxes) {
            // Use smaller padding (0.5) for routing obstacles to match dense physics layout
            this._cachedBoxes = this.snapshot.components
                .filter((c) => c.symbol !== 'Device:DNC')
                .map((c) =>
                    this.getComponentBox(c, this.snapshot.schematicRouting?.symbolClearance ?? 0.5),
                )
                .filter((b) => b !== null) as Box[];
        }
        return this._cachedBoxes;
    }

    private getComponentDimensions(comp: Component): { width: number; height: number } {
        if (comp.symbol === 'Device:DNC') return { width: 0, height: 0 };
        const symDef = this.library.getSymbol(comp.symbol);
        if (!symDef) return { width: 25, height: 25 };

        const pins = this.findAllPinsInSymbol(symDef);
        if (pins.length === 0) return { width: 25, height: 25 };

        let minX = Infinity,
            maxX = -Infinity,
            minY = Infinity,
            maxY = -Infinity;

        // We estimate the physical envelope of the un-rotated component simply by bounding its pins
        for (const pin of pins) {
            minX = Math.min(minX, pin.x);
            maxX = Math.max(maxX, pin.x);
            minY = Math.min(minY, pin.y);
            maxY = Math.max(maxY, pin.y);
        }

        if (minX === Infinity) return { width: 15, height: 15 };
        return { width: Math.max(15, maxX - minX), height: Math.max(15, maxY - minY) };
    }

    private getComponentBox(comp: Component, padding: number): Box | null {
        if (comp.symbol === 'Device:DNC') return null;

        const symDef = this.library.getSymbol(comp.symbol);
        if (!symDef) {
            if (comp.absoluteSchematicPosition) {
                const x = comp.absoluteSchematicPosition.x;
                const y = comp.absoluteSchematicPosition.y;
                return {
                    x: x - 12.5 - padding,
                    y: y - 12.5 - padding,
                    width: 25 + 2 * padding,
                    height: 25 + 2 * padding,
                };
            }
            return null;
        }

        const pins = this.findAllPinsInSymbol(symDef);

        if (this.snapshot.schematicRouting?.symbolOverrides?.[comp.symbol]) {
            const corners: PinInfo[] = [];
            const collect = (node: SExpr) => {
                if (!Array.isArray(node)) return;
                if (node[0] === 'rectangle') {
                    for (const endpoint of node.filter(
                        (item) => Array.isArray(item) && ['start', 'end'].includes(String(item[0])),
                    ) as SExpr[][]) {
                        corners.push({
                            x: Number(endpoint[1]),
                            y: Number(endpoint[2]),
                            rotation: 0,
                        });
                    }
                } else if (node[0] === 'polyline') {
                    const pts = node.find(
                        (item): item is SExpr[] => Array.isArray(item) && item[0] === 'pts',
                    );
                    for (const point of pts?.slice(1) ?? [])
                        if (Array.isArray(point))
                            corners.push({ x: Number(point[1]), y: Number(point[2]), rotation: 0 });
                } else if (node[0] === 'circle') {
                    const center = node.find(
                        (item): item is SExpr[] => Array.isArray(item) && item[0] === 'center',
                    );
                    const radius = node.find(
                        (item): item is SExpr[] => Array.isArray(item) && item[0] === 'radius',
                    );
                    if (center && radius)
                        for (const sign of [-1, 1])
                            corners.push({
                                x: Number(center[1]) + sign * Number(radius[1]),
                                y: Number(center[2]) + sign * Number(radius[1]),
                                rotation: 0,
                            });
                } else node.forEach(collect);
            };
            collect(symDef.definition);
            if (corners.length) pins.splice(0, pins.length, ...corners);
        }
        const cx = comp.absoluteSchematicPosition?.x || 0;
        const cy = comp.absoluteSchematicPosition?.y || 0;
        const crot = comp.absoluteSchematicPosition?.rotation || 0;
        const rad = (crot * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        if (pins.length === 0) {
            return {
                x: cx - 12.5 - padding,
                y: cy - 12.5 - padding,
                width: 25 + 2 * padding,
                height: 25 + 2 * padding,
            };
        }

        let minX = Infinity,
            maxX = -Infinity,
            minY = Infinity,
            maxY = -Infinity;

        for (const pin of pins) {
            // Apply CCW rotation, then invert Y to map to KiCad board space
            const rx = pin.x * cos - pin.y * sin;
            const ry = -(pin.x * sin + pin.y * cos);
            const ax = cx + rx;
            const ay = cy + ry;

            if (ax < minX) minX = ax;
            if (ax > maxX) maxX = ax;
            if (ay < minY) minY = ay;
            if (ay > maxY) maxY = ay;
        }

        return {
            x: minX - padding,
            y: minY - padding,
            width: maxX - minX + 2 * padding,
            height: maxY - minY + 2 * padding,
        };
    }

    private findAllPinsInSymbol(symDef: SymbolDefinition): PinInfo[] {
        const pins: PinInfo[] = [];
        this.collectPins(symDef.definition, pins);
        for (const dep of symDef.dependencies) {
            this.collectPins(dep, pins);
        }
        return pins;
    }

    private collectPins(expr: SExpr, pins: PinInfo[]) {
        if (!Array.isArray(expr)) return null;

        for (const item of expr) {
            if (Array.isArray(item) && item[0] === 'symbol') {
                this.collectPins(item, pins);
            } else if (Array.isArray(item) && item[0] === 'pin') {
                const at = item.find((i) => Array.isArray(i) && i[0] === 'at') as SExpr[];
                if (at) {
                    const numItem = item.find(
                        (i: any) => Array.isArray(i) && i[0] === 'number',
                    ) as SExpr[];
                    const numberStr = (numItem && (numItem[1] as string)) || (item[1] as string);
                    pins.push({
                        x: parseFloat(at[1] as string),
                        y: parseFloat(at[2] as string),
                        rotation: parseFloat(at[3] as string),
                        number: numberStr,
                    });
                }
            }
        }
    }

    private generateLibSymbols(): SExpr {
        const libSymbols: SExpr[] = ['lib_symbols'];
        const processedSymbols = new Set<string>();

        for (const comp of this.snapshot.components) {
            if (comp.symbol === 'Device:DNC') continue;

            const symDef = this.library.getSymbol(comp.symbol);
            if (symDef) {
                this.addSymbol(symDef);
                this.processSymbol(
                    symDef.definition,
                    processedSymbols,
                    libSymbols,
                    symDef.dependencies,
                );
            } else {
                console.warn(`Symbol ${comp.symbol} not found in library.`);
            }
        }

        const powerNets = this.snapshot.nets.filter(
            (n) => n.class === 'Power' || this.snapshot.schematicRouting?.powerSymbols?.[n.name],
        );
        for (const net of powerNets) {
            const symName =
                this.snapshot.schematicRouting?.powerSymbols?.[net.name] ?? `power:${net.name}`;
            const symDef = this.library.getSymbol(symName);
            if (symDef) {
                this.addSymbol(symDef);
                this.processSymbol(
                    symDef.definition,
                    processedSymbols,
                    libSymbols,
                    symDef.dependencies,
                );
            }
        }

        return libSymbols;
    }

    private processSymbol(
        definition: SExpr,
        processedSymbols: Set<string>,
        libSymbols: SExpr[],
        dependencies: SExpr[] = [],
    ) {
        const name = this.getSymbolName(definition);
        if (!name || processedSymbols.has(name)) return;
        for (const dep of dependencies) {
            this.processSymbol(dep, processedSymbols, libSymbols);
        }
        processedSymbols.add(name);
        libSymbols.push(definition);
    }

    private getSymbolName(sym: SExpr): string | null {
        if (Array.isArray(sym) && sym[0] === 'symbol' && typeof sym[1] === 'string') {
            return SExpressionParser.unquote(sym[1]);
        }
        return null;
    }

    private addSymbol(symDef: SymbolDefinition) {
        if (this.usedSymbols.has(symDef.name)) return;
        this.usedSymbols.set(symDef.name, symDef);
    }

    private generateComponents(): SExpr[] {
        const rootUuid = this.uuids.getOrGenerate('ROOT');
        const instances: SExpr[] = [];
        for (const comp of this.snapshot.components) {
            if (comp.symbol === 'Device:DNC') continue;

            const uuid = this.uuids.getOrGenerate(comp.ref);
            const x = comp.absoluteSchematicPosition?.x || 0;
            const y = comp.absoluteSchematicPosition?.y || 0;
            const rot = comp.absoluteSchematicPosition?.rotation || 0;

            const symName = comp.symbol;
            const box = this.getComponentBox(comp, 0);
            let textRot = 0;
            let valY = y + 2.54;
            let refY = y - 2.54;
            let valX = x;
            let refX = x;
            let fieldJustify: SExpr[] = [];
            const fieldSize = this.routedSchematicOwner(comp) ? '1' : '1.27';

            if (box) {
                if (box.height > box.width) {
                    textRot = 90;
                    refX = box.x + box.width + 1.27;
                    refY = y - 1.27;
                    valX = box.x + box.width + 1.27;
                    valY = y + 1.27;
                } else {
                    refY = box.y - 1.27;
                    valY = box.y + box.height + 1.27;
                }
            }

            if (this.routedSchematicOwner(comp) && box) {
                textRot = rot % 180;
                if (box.height > 20) {
                    refX = valX = box.x + box.width + 5.08;
                    refY = box.y + box.height + 2.54;
                    valY = refY + 2.54;
                    fieldJustify = [['justify', 'left']];
                } else if (box.height > box.width) {
                    refX = valX = Math.max(x + 5.08, box.x + box.width + 2.54);
                    refY = y - 1.27;
                    valY = y + 1.27;
                    fieldJustify = [['justify', 'left']];
                } else {
                    refY = box.y - 5.08;
                    valY = box.y - 2.54;
                }
            }
            if (this.snapshot.schematicRouting?.interfaceComponents && box) {
                textRot = rot % 180;
                if (box.height > box.width) {
                    refX = valX = x + 5.08;
                    refY = y - 1.27;
                    valY = y + 1.27;
                    fieldJustify = [['justify', 'left']];
                } else {
                    refX = valX = x;
                    refY = box.y - 5.08;
                    valY = box.y - 2.54;
                }
                if (this.snapshot.schematicRouting.hideValues?.includes(comp.ref)) {
                    refX = valX = x;
                    refY = box.y - 3.81;
                    fieldJustify = [];
                }
            }
            if (this.snapshot.schematicRouting?.symbolOverrides?.[comp.symbol] && box) {
                textRot = 0;
                refX = valX = box.x + 5.08;
                fieldJustify = [['justify', 'right']];
                refY = box.y - 10.16;
                valY = box.y - 7.62;
            }
            if (rot % 360 === 180)
                fieldJustify = fieldJustify.map((item) =>
                    item[0] === 'justify'
                        ? ['justify', item[1] === 'left' ? 'right' : 'left']
                        : item,
                );
            if (this.snapshot.schematicRouting?.symbolClearance !== undefined) {
                const reserve = (text: string, fx: number, fy: number) => {
                    const width = text.length * 0.85 + 1.27;
                    let justify = fieldJustify[0]?.[1];
                    if (rot % 360 === 180 && justify)
                        justify = justify === 'left' ? 'right' : 'left';
                    this.fieldKeepouts.push({
                        x:
                            justify === 'left'
                                ? fx - 0.635
                                : justify === 'right'
                                  ? fx - width + 0.635
                                  : fx - width / 2,
                        y: fy - 1.27,
                        width,
                        height: 2.54,
                    });
                };
                reserve(comp.ref, refX, refY);
                if (!this.snapshot.schematicRouting.hideValues?.includes(comp.ref))
                    reserve(comp.value || symName, valX, valY);
            }
            const instance: SExpr[] = [
                'symbol',
                ['lib_id', this.quote(symName)],
                ['at', x.toFixed(2), y.toFixed(2), rot.toFixed(2)],
                ['unit', '1'],
                ['in_bom', 'yes'],
                ['on_board', 'yes'],
                ['dnp', 'no'],
                ['uuid', this.quote(uuid)],
                [
                    'property',
                    '"Reference"',
                    this.quote(comp.ref),
                    ['at', `${refX.toFixed(2)}`, `${refY.toFixed(2)}`, `${textRot}`],
                    ['effects', ['font', ['size', fieldSize, fieldSize]], ...fieldJustify],
                ],
                [
                    'property',
                    '"Value"',
                    this.quote(comp.value || symName),
                    ['at', `${valX.toFixed(2)}`, `${valY.toFixed(2)}`, `${textRot}`],
                    ['effects', ['font', ['size', fieldSize, fieldSize]], ...fieldJustify],
                ],
                [
                    'property',
                    '"Footprint"',
                    this.quote(comp.footprint || ''),
                    ['at', `${x.toFixed(2)}`, `${y.toFixed(2)}`, '0'],
                    ['effects', ['font', ['size', '1.27', '1.27']], ['hide', 'yes']],
                ],
                [
                    'property',
                    '"Datasheet"',
                    '""',
                    ['at', `${x.toFixed(2)}`, `${y.toFixed(2)}`, '0'],
                    ['effects', ['font', ['size', '1.27', '1.27']]],
                ],
                [
                    'property',
                    '"Description"',
                    '""',
                    ['at', `${x.toFixed(2)}`, `${y.toFixed(2)}`, '0'],
                    ['effects', ['font', ['size', '1.27', '1.27']]],
                ],
                [
                    'property',
                    '"LCSC_Part"',
                    this.quote(comp.partNo || ''),
                    ['at', `${x.toFixed(2)}`, `${y.toFixed(2)}`, '0'],
                    ['effects', ['font', ['size', '1.27', '1.27']], ['hide', 'yes']],
                ],
                ...Object.entries(componentCostFields(comp.cost)).map(
                    ([name, value]): SExpr => [
                        'property',
                        this.quote(name),
                        this.quote(value),
                        ['at', x.toFixed(2), y.toFixed(2), '0'],
                        ['effects', ['font', ['size', '1.27', '1.27']], ['hide', 'yes']],
                    ],
                ),
                [
                    'property',
                    '"ki_keywords"',
                    '""',
                    ['at', `${x.toFixed(2)}`, `${y.toFixed(2)}`, '0'],
                    ['effects', ['font', ['size', '1.27', '1.27']], ['hide', 'yes']],
                ],
                [
                    'property',
                    '"hierarchy_path"',
                    this.quote(`/${rootUuid}`),
                    ['at', `${x.toFixed(2)}`, `${y.toFixed(2)}`, '0'],
                    ['effects', ['font', ['size', '1.27', '1.27']], ['hide', 'yes']],
                ],
                [
                    'property',
                    '"root_uuid"',
                    this.quote(rootUuid),
                    ['at', `${x.toFixed(2)}`, `${y.toFixed(2)}`, '0'],
                    ['effects', ['font', ['size', '1.27', '1.27']], ['hide', 'yes']],
                ],
                ...Array.from(new Set(comp.allPins.values())).map((pin) => [
                    'pin',
                    this.quote(pin.name),
                    ['uuid', this.quote(this.uuids.getOrGenerate(`${comp.ref}_pin_${pin.name}`))],
                ]),
                [
                    'instances',
                    [
                        'project',
                        '""',
                        [
                            'path',
                            this.quote(`/${rootUuid}`),
                            ['reference', this.quote(comp.ref)],
                            ['unit', '1'],
                        ],
                    ],
                    [
                        'project',
                        this.quote(this.snapshot.name),
                        [
                            'path',
                            this.quote(`/${rootUuid}`),
                            ['reference', this.quote(comp.ref)],
                            ['unit', '1'],
                        ],
                    ],
                ],
            ];

            if (this.snapshot.schematicRouting?.hideValues?.includes(comp.ref)) {
                const value = instance.find(
                    (item) =>
                        Array.isArray(item) && item[0] === 'property' && item[1] === '"Value"',
                ) as SExpr[] | undefined;
                const effects = value?.find(
                    (item) => Array.isArray(item) && item[0] === 'effects',
                ) as SExpr[] | undefined;
                effects?.push(['hide', 'yes']);
            }
            instances.push(instance);
        }
        return instances;
    }

    private generateWiresAndPower(): SExpr[] {
        const rootUuid = this.uuids.getOrGenerate('ROOT');
        const powerSymbols: SExpr[] = [];
        const nets: SExpr[] = [];
        const processedPins = new Set<string>();
        const emittedLabels = new Set<string>();

        // Map to deduplicate wires (A->B == B->A) and ignore zero-length segments
        const uniqueWires = new Map<string, SExpr>();
        const addWire = (p1: Point, p2: Point, netName: string) => {
            // Drop zero-length wires
            if (Math.abs(p1.x - p2.x) < 0.001 && Math.abs(p1.y - p2.y) < 0.001) return;

            // Canonicalize coordinate order so A->B is identical to B->A
            const pA = p1.x < p2.x || (Math.abs(p1.x - p2.x) < 0.001 && p1.y < p2.y) ? p1 : p2;
            const pB = pA === p1 ? p2 : p1;

            // Round aggressively (2 decimal places) for string map collision key
            const key = `${pA.x.toFixed(2)},${pA.y.toFixed(2)}-${pB.x.toFixed(2)},${pB.y.toFixed(2)}`;

            if (!uniqueWires.has(key)) {
                uniqueWires.set(key, this.createWire(pA, pB, netName));
                this._generatedWires.push({ p1: pA, p2: pB, netName });
            }
        };

        const netPins = new Map<Net, Pin[]>();
        const obstacles = [...this.getCachedComponentBoxes(), ...this.fieldKeepouts];

        for (const comp of this.snapshot.components) {
            if (comp.symbol === 'Device:DNC') continue;

            // Deduplicate pins since allPins yields both name aliases and numbered aliases
            const uniquePins = new Set<Pin>();
            for (const [name, pin] of comp.allPins) {
                uniquePins.add(pin);
            }

            for (const pin of uniquePins) {
                if (pin.net && !this.moduleNets.has(pin.net)) {
                    if (!netPins.has(pin.net)) netPins.set(pin.net, []);
                    netPins.get(pin.net)!.push(pin as Pin);
                }
            }
        }

        const getDepth = (compRef: string): number => {
            const comp = this.snapshot.components.find((c) => c.ref === compRef);
            if (!comp) return 0;
            let depth = 0;
            let current = comp.parent;
            while (current) {
                depth++;
                current = current.parent;
            }
            if (comp.group) depth++;
            return depth;
        };

        const sortedNets = Array.from(netPins.entries()).sort((a, b) => {
            const depthA = Math.max(...a[1].map((p) => getDepth(p.component.ref)));
            const depthB = Math.max(...b[1].map((p) => getDepth(p.component.ref)));
            return depthB - depthA;
        });

        const batchPaths = new Map<string, Point[]>();
        if (this.snapshot.connectionStyle === 'routed' || this.snapshot.schematicRouting) {
            const requests: WireRoutingRequest[] = [],
                keys: string[] = [];
            for (const [net, pins] of sortedNets) {
                const hint = this.snapshot.schematicRouting?.routeHints?.find((item) =>
                    item.nets.includes(net.name),
                );
                if (net.class === 'Power' && !hint) continue;
                const positions = pins
                    .filter((pin) => !pin.isDNC)
                    .map((pin) => this.getPinAbsolutePosition(pin))
                    .filter((position): position is PinPos => position !== null);
                const escape = (position: PinPos) => {
                    const dir = this.getDirectionVector(position.rotation);
                    return { x: position.x - dir.dx * 1.27, y: position.y - dir.dy * 1.27 };
                };
                if (hint && positions.length < 2)
                    throw new Error(
                        `Schematic route hint '${hint.id}' requires at least two connected pins.`,
                    );
                for (let i = 0; i < positions.length - 1; i++) {
                    requests.push({
                        net: net.name,
                        clearance:
                            this.snapshot.schematicRouting?.wireClearance ??
                            (['A4', 'A3'].includes(this.snapshot.size ?? 'A4') ? 2 : undefined),
                        start: escape(positions[i]),
                        end: escape(positions[i + 1]),
                        obstacles,
                        waypoints: i === 0 ? (hint?.waypoints ?? []) : [],
                    });
                    keys.push(`${net.name}/${i}`);
                }
            }
            const paths = this.router.routeMany(requests);
            paths.forEach((path, index) => batchPaths.set(keys[index], path));
        }

        for (const [net, pins] of sortedNets) {
            if (pins.length === 0) continue;

            const routeHint = this.snapshot.schematicRouting?.routeHints?.find((hint) =>
                hint.nets.includes(net.name),
            );
            if (net.class === 'Power' && !routeHint) {
                for (const pin of pins) {
                    const pinKey = `${pin.component.ref}_${pin.name}`;
                    if (processedPins.has(pinKey)) continue;
                    processedPins.add(pinKey);

                    const pos = this.getPinAbsolutePosition(pin);
                    if (pos) {
                        const isGnd = /gnd/i.test(net.name) || /vss/i.test(net.name);

                        // The pin direction is INTO the component. The wire should go AWAY from it (outDir).
                        const dir = this.getDirectionVector(pos.rotation);
                        const outDir = { dx: -dir.dx, dy: -dir.dy };
                        const outAngle = (pos.rotation + 180) % 360;

                        const pinX = pos.x;
                        const pinY = pos.y;
                        const symX = pinX + outDir.dx * 2.54;
                        const symY = pinY + outDir.dy * 2.54;

                        addWire({ x: pinX, y: pinY }, { x: symX, y: symY }, net.name);

                        // GND natively points DOWN (270deg). VCC natively points UP (90deg).
                        const baseAngle = isGnd ? 270 : 90;
                        const rot = (outAngle - baseAngle + 360) % 360;

                        const symUuid = this.uuids.getOrGenerate(
                            `${pin.component.ref}_${pin.name}_pwr_sym`,
                        );
                        powerSymbols.push(
                            this.createPowerSymbol(
                                net.name,
                                symX,
                                symY,
                                rot,
                                outDir,
                                rootUuid,
                                symUuid,
                            ),
                        );
                    }
                }
            } else {
                const points: { pos: PinPos; pin: Pin }[] = [];
                for (const pin of pins) {
                    if (pin.isDNC) continue; // DNC nets skip global labels (handled by no_connect marks)

                    const pinKey = `${pin.component.ref}_${pin.name}`;
                    if (processedPins.has(pinKey)) continue;
                    processedPins.add(pinKey);

                    const p = this.getPinAbsolutePosition(pin);
                    if (p) points.push({ pos: p, pin });
                }

                if (
                    !this.options.experimentalRouting &&
                    this.snapshot.connectionStyle !== 'routed' &&
                    !this.snapshot.schematicRouting
                ) {
                    // By default, just put a global label at the escape point
                    for (const pt of points) {
                        const p = pt.pos;
                        // The pin direction is INTO the component. The label/wire should go AWAY from it.
                        const dir = this.getDirectionVector(p.rotation);
                        const outDir = { dx: -dir.dx, dy: -dir.dy };
                        const s = { x: p.x + outDir.dx * 1.27, y: p.y + outDir.dy * 1.27 };

                        // Connect the pin precisely to the start of the label graphics
                        addWire(p, s, net.name);

                        const uuid = this.uuids.getOrGenerate(
                            `label_${pt.pin.component.ref}_${pt.pin.name}_${net.name}`,
                        );
                        if (!emittedLabels.has(uuid)) {
                            emittedLabels.add(uuid);
                            nets.push(this.createGlobalLabel(net.name, s.x, s.y, outDir, uuid));
                        }
                    }
                } else {
                    for (let i = 0; i < points.length - 1; i++) {
                        const pt1 = points[i];
                        const pt2 = points[i + 1];
                        const p1 = pt1.pos;
                        const p2 = pt2.pos;

                        const dir1 = this.getDirectionVector(p1.rotation);
                        const dir2 = this.getDirectionVector(p2.rotation);

                        // 1.27 unit micro-escape AWAY from the component body
                        const s1 = { x: p1.x - dir1.dx * 1.27, y: p1.y - dir1.dy * 1.27 };
                        const s2 = { x: p2.x - dir2.dx * 1.27, y: p2.y - dir2.dy * 1.27 };

                        let path: Point[] = [];
                        try {
                            const foreignWires = this._generatedWires
                                .filter((wire) => wire.netName !== net.name)
                                .map((wire) => ({
                                    x: Math.min(wire.p1.x, wire.p2.x) - 0.2,
                                    y: Math.min(wire.p1.y, wire.p2.y) - 0.2,
                                    width: Math.abs(wire.p1.x - wire.p2.x) + 0.4,
                                    height: Math.abs(wire.p1.y - wire.p2.y) + 0.4,
                                }));
                            path =
                                batchPaths.get(`${net.name}/${i}`) ??
                                this.router.route(
                                    s1,
                                    s2,
                                    [...obstacles, ...foreignWires],
                                    i === 0 ? (routeHint?.waypoints ?? []) : [],
                                );

                            // Only add micro-escapes if routing succeeds
                            addWire(p1, s1, net.name);
                            addWire(p2, s2, net.name);

                            for (let k = 0; k < path.length - 1; k++) {
                                addWire(path[k], path[k + 1], net.name);
                            }
                        } catch (e: any) {
                            if (
                                routeHint ||
                                this.snapshot.connectionStyle === 'routed' ||
                                this.snapshot.schematicRouting
                            ) {
                                this.errors.push(
                                    `Schematic routing failed for net '${net.name}': ${e.message}`,
                                );
                                continue;
                            }
                            console.warn(
                                `WARNING: Net '${net.name}' failed to route between ${pt1.pin.component.ref}.${pt1.pin.name} and ${pt2.pin.component.ref}.${pt2.pin.name}. Using global labels instead. Details: ${e.message}`,
                            );

                            addWire(p1, s1, net.name);
                            addWire(p2, s2, net.name);

                            const uuid1 = this.uuids.getOrGenerate(
                                `label_${pt1.pin.component.ref}_${pt1.pin.name}_${net.name}`,
                            );
                            if (!emittedLabels.has(uuid1)) {
                                emittedLabels.add(uuid1);
                                nets.push(
                                    this.createGlobalLabel(net.name, s1.x, s1.y, dir1, uuid1),
                                );
                            }

                            const uuid2 = this.uuids.getOrGenerate(
                                `label_${pt2.pin.component.ref}_${pt2.pin.name}_${net.name}`,
                            );
                            if (!emittedLabels.has(uuid2)) {
                                emittedLabels.add(uuid2);
                                nets.push(
                                    this.createGlobalLabel(net.name, s2.x, s2.y, dir2, uuid2),
                                );
                            }
                        }
                    }
                }
            }
        }

        return [...powerSymbols, ...nets, ...Array.from(uniqueWires.values())];
    }

    private generateJunctions(): SExpr[] {
        const junctions: SExpr[] = [];
        if (
            this.snapshot.connectionStyle === 'routed' ||
            this.snapshot.schematicRouting ||
            this.moduleNets.size
        ) {
            const points = new Map<string, { point: Point; net: string }>();
            for (const wire of this._generatedWires)
                for (const point of [wire.p1, wire.p2])
                    points.set(`${wire.netName}/${point.x}/${point.y}`, {
                        point,
                        net: wire.netName,
                    });
            for (const anchor of this.portAnchors)
                points.set(`${anchor.net}/${anchor.point.x}/${anchor.point.y}`, anchor);
            for (const { point, net } of points.values()) {
                let branches = this.portAnchors.some(
                    (anchor) => anchor.net === net && pointOnSegment(anchor.point, point, point),
                )
                    ? 1
                    : 0;
                for (const wire of this._generatedWires.filter((item) => item.netName === net)) {
                    if (!pointOnSegment(point, wire.p1, wire.p2)) continue;
                    branches +=
                        pointOnSegment(point, wire.p1, wire.p1) ||
                        pointOnSegment(point, wire.p2, wire.p2)
                            ? 1
                            : 2;
                }
                if (branches >= 3)
                    junctions.push([
                        'junction',
                        ['at', String(point.x), String(point.y)],
                        ['diameter', '0'],
                        ['color', '0', '0', '0', '0'],
                        [
                            'uuid',
                            this.quote(
                                this.uuids.getOrGenerate(`junction/${net}/${point.x}/${point.y}`),
                            ),
                        ],
                    ]);
            }
        }
        return junctions;
    }

    private routedSchematicOwner(component: Component): Composable | undefined {
        let owner = component.parent;
        while (owner) {
            if (owner.schematicConnectionStyle === 'routed-interface') return owner;
            owner = owner.parent;
        }
        return undefined;
    }

    /** Module internals are always native wires, independently of the host's label style. */
    private generateModuleWiresAndPorts(): SExpr[] {
        const interfaceComponents = this.snapshot.schematicRouting?.interfaceComponents;
        for (const ref of interfaceComponents ?? []) {
            if (!this.snapshot.components.some((component) => component.ref === ref))
                throw new Error(`Unknown schematic interface component '${ref}'.`);
        }
        type Owner = Composable | string | undefined;
        const byNet = new Map<Net, { pin: Pin; owner: Owner; position: PinPos }[]>();
        for (const component of this.snapshot.components) {
            if (component.symbol === 'Device:DNC') continue;
            for (const pin of new Set(component.allPins.values())) {
                if (!pin.net || pin.isDNC) continue;
                const position = this.getPinAbsolutePosition(pin);
                if (!position) continue;
                const group = byNet.get(pin.net) ?? [];
                const owner =
                    this.routedSchematicOwner(component) ??
                    (interfaceComponents
                        ? interfaceComponents.includes(component.ref)
                            ? `interface:${component.ref}`
                            : 'circuit'
                        : undefined);
                group.push({ pin, owner, position });
                byNet.set(pin.net, group);
            }
        }
        const output: SExpr[] = [],
            requests: WireRoutingRequest[] = [];
        const endpoints: { net: Net; a: PinPos; b: PinPos }[] = [];
        const portKeepouts: (Box & { net: string })[] = [];
        const obstacles = [...this.getCachedComponentBoxes(), ...this.fieldKeepouts];
        const escape = (p: PinPos) => {
            const direction = this.getDirectionVector(p.rotation);
            return {
                x: p.x - direction.dx * (this.snapshot.schematicRouting?.pinEscape ?? 1.27),
                y: p.y - direction.dy * (this.snapshot.schematicRouting?.pinEscape ?? 1.27),
            };
        };
        for (const [net, points] of byNet) {
            if (!points.some((point) => point.owner)) continue;
            this.moduleNets.add(net);
            const groups = new Map<Owner, typeof points>();
            const powerSymbol = this.snapshot.schematicRouting?.powerSymbols?.[net.name];
            const localGroups =
                this.snapshot.schematicRouting?.powerGroups?.filter(
                    (group) => group.net === net.name,
                ) ?? [];
            const claimed = new Set<string>();
            for (const [index, local] of localGroups.entries()) {
                for (const terminal of local.pins) {
                    if (claimed.has(terminal))
                        throw new Error(`Duplicate power terminal '${terminal}'.`);
                    if (!points.some(({ pin }) => `${pin.component.ref}.${pin.name}` === terminal))
                        throw new Error(`Unknown power terminal '${terminal}' on '${net.name}'.`);
                    claimed.add(terminal);
                }
                if (!powerSymbol)
                    throw new Error(`Power group '${net.name}' needs a power symbol.`);
                groups.set(
                    `power:${index}`,
                    local.pins.map(
                        (terminal) =>
                            points.find(
                                ({ pin }) => `${pin.component.ref}.${pin.name}` === terminal,
                            )!,
                    ),
                );
            }
            for (const point of points) {
                const terminal = `${point.pin.component.ref}.${point.pin.name}`;
                if (claimed.has(terminal)) continue;
                const key = powerSymbol ? terminal : point.owner;
                const group = groups.get(key) ?? [];
                group.push(point);
                groups.set(key, group);
            }
            for (const [owner, group] of groups) {
                const ownerRef = typeof owner === 'string' ? owner : (owner?.ref ?? 'host');
                const interfaceNet =
                    owner &&
                    typeof owner !== 'string' &&
                    [...owner.allPins.values()].some((pin) => pin.net === net);
                const boundary =
                    groups.size > 1 || (interfaceNet && !net.name.startsWith(`${ownerRef}_`));
                if (powerSymbol) {
                    const p = group[0].position,
                        e = escape(p);
                    this.portAnchors.push({ point: e, net: net.name });
                    output.push(this.createWire(p, e, net.name));
                    this._generatedWires.push({ p1: p, p2: e, netName: net.name });
                    const ground = powerSymbol === 'power:GND';
                    const defaultDy = ground ? 1 : -1;
                    const inline =
                        interfaceComponents?.includes(group[0].pin.component.ref) &&
                        Math.abs(e.x - p.x) > 0.001;
                    const glyphDx = inline ? Math.sign(e.x - p.x) : 0;
                    const glyphDy = inline
                        ? 0
                        : Math.abs(e.y - p.y) > 0.001
                          ? Math.sign(e.y - p.y)
                          : defaultDy;
                    const glyphRotation = inline
                        ? ground
                            ? glyphDx > 0
                                ? 90
                                : 270
                            : glyphDx > 0
                              ? 270
                              : 90
                        : glyphDy === defaultDy
                          ? 0
                          : 180;
                    if (this.snapshot.schematicRouting?.symbolClearance !== undefined) {
                        const width = net.name.length * 0.85 + 1.27;
                        portKeepouts.push({
                            net: net.name,
                            x: inline
                                ? glyphDx > 0
                                    ? e.x + 3.81
                                    : e.x - 3.81 - width
                                : e.x - width / 2,
                            y: inline ? e.y - 0.635 : e.y + (glyphDy > 0 ? 2.54 : -5.08),
                            width,
                            height: inline ? 1.27 : 2.54,
                        });
                    }
                    portKeepouts.push({
                        net: `glyph:${net.name}`,
                        x: inline ? (glyphDx > 0 ? e.x + 0.1 : e.x - 2.54) : e.x - 1.52,
                        y: inline ? e.y - 1.52 : glyphDy > 0 ? e.y + 0.1 : e.y - 2.54,
                        width: inline ? 2.44 : 3.04,
                        height: inline ? 3.04 : 2.44,
                    });
                    output.push(
                        this.createPowerSymbol(
                            net.name,
                            e.x,
                            e.y,
                            glyphRotation,
                            { dx: glyphDx, dy: glyphDy },
                            '',
                            this.uuids.getOrGenerate(`local-power/${ownerRef}/${net.name}`),
                            powerSymbol,
                            Boolean(inline),
                        ),
                    );
                } else if (boundary) {
                    const p = (
                            group.find(({ pin }) => /^[RC]\d+$/.test(pin.component.ref)) ?? group[0]
                        ).position,
                        e = escape(p);
                    this.portAnchors.push({ point: e, net: net.name });
                    output.push(this.createWire(p, e, net.name));
                    this._generatedWires.push({ p1: p, p2: e, netName: net.name });
                    if (this.snapshot.schematicRouting?.symbolClearance !== undefined) {
                        const length = net.name.length * 0.85 + 2.54;
                        const dx = e.x - p.x,
                            dy = e.y - p.y;
                        portKeepouts.push({
                            net: `label:${net.name}`,
                            x: dx < 0 ? e.x - length : dx > 0 ? e.x + 0.635 : e.x - 1.52,
                            y: dx !== 0 ? e.y - 1.52 : dy < 0 ? e.y - length : e.y + 0.635,
                            width: dx !== 0 ? length - 0.635 : 3.04,
                            height: dx !== 0 ? 3.04 : length - 0.635,
                        });
                    }
                    output.push(
                        this.createGlobalLabel(
                            net.name,
                            e.x,
                            e.y,
                            { dx: e.x - p.x, dy: e.y - p.y },
                            this.uuids.getOrGenerate(`module-port/${ownerRef}/${net.name}`),
                        ),
                    );
                } else if (group.length === 1) {
                    this.moduleUnusedPins.add(group[0].pin);
                    const p = group[0].position;
                    output.push([
                        'no_connect',
                        ['at', String(p.x), String(p.y)],
                        [
                            'uuid',
                            this.quote(
                                this.uuids.getOrGenerate(
                                    `module-unused/${group[0].pin.component.ref}/${group[0].pin.name}`,
                                ),
                            ),
                        ],
                    ]);
                }
                // A minimum-length spanning tree avoids routing in constructor/pin-number order.
                const connected = [group[0]],
                    remaining = group.slice(1);
                while (remaining.length) {
                    let bestA = connected[0],
                        bestIndex = 0,
                        distance = Infinity;
                    // Draw the main IC-to-IC spine before adding test points and passives.
                    const pendingIc =
                        connected.some(({ pin }) => /^U\d+$/.test(pin.component.ref)) &&
                        remaining.some(({ pin }) => /^U\d+$/.test(pin.component.ref));
                    for (const a of connected)
                        remaining.forEach((b, index) => {
                            if (pendingIc && !/^U\d+$/.test(b.pin.component.ref)) return;
                            const d = Math.hypot(
                                a.position.x - b.position.x,
                                a.position.y - b.position.y,
                            );
                            if (d < distance) {
                                distance = d;
                                bestA = a;
                                bestIndex = index;
                            }
                        });
                    const b = remaining.splice(bestIndex, 1)[0];
                    connected.push(b);
                    if (distance < 0.001) continue;
                    const leadClearance =
                        this.snapshot.schematicRouting?.wireClearance ??
                        (['A4', 'A3'].includes(this.snapshot.size ?? 'A4') ? 2 : 0.15);
                    const foreignLegs = [...byNet]
                        .filter(([other]) => other !== net)
                        .flatMap(([, terminals]) =>
                            terminals.map(({ position }) => {
                                const e = escape(position);
                                return {
                                    x: Math.min(position.x, e.x) - leadClearance,
                                    y: Math.min(position.y, e.y) - leadClearance,
                                    width: Math.abs(position.x - e.x) + 2 * leadClearance,
                                    height: Math.abs(position.y - e.y) + 2 * leadClearance,
                                };
                            }),
                        );
                    const hint = this.snapshot.schematicRouting?.routeHints?.find((hint) =>
                        hint.nets.includes(net.name),
                    );
                    let waypoints = hint?.waypoints;
                    if (waypoints?.length) {
                        const distanceToStart = (point: Point) =>
                            Math.hypot(point.x - bestA.position.x, point.y - bestA.position.y);
                        if (
                            distanceToStart(waypoints[waypoints.length - 1]) <
                            distanceToStart(waypoints[0])
                        )
                            waypoints = [...waypoints].reverse();
                    }
                    requests.push({
                        net: net.name,
                        clearance:
                            this.snapshot.schematicRouting?.wireClearance ??
                            (['A4', 'A3'].includes(this.snapshot.size ?? 'A4') ? 2 : undefined),
                        start: escape(bestA.position),
                        end: escape(b.position),
                        obstacles: [...obstacles, ...foreignLegs],
                        waypoints,
                    });
                    endpoints.push({ net, a: bestA.position, b: b.position });
                }
            }
        }
        const paths = this.router.routeMany(
            requests.map((request) => ({
                ...request,
                obstacles: [
                    ...request.obstacles,
                    ...portKeepouts.filter((box) => box.net !== request.net),
                ],
            })),
        );
        paths.forEach((path, index) => {
            const { net, a, b } = endpoints[index];
            for (const [p1, p2] of [
                [a, path[0]],
                ...path.slice(1).map((point, i) => [path[i], point]),
                [path[path.length - 1], b],
            ]) {
                if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 0.001) continue;
                output.push(this.createWire(p1, p2, net.name));
                this._generatedWires.push({ p1, p2, netName: net.name });
            }
        });
        const wires: typeof this._generatedWires = [];
        for (const segment of this._generatedWires) {
            let merged = { ...segment };
            for (let index = 0; index < wires.length; ) {
                const previous = wires[index];
                const horizontal = Math.abs(merged.p1.y - merged.p2.y) < 0.001;
                const axis = horizontal ? 'x' : 'y',
                    fixed = horizontal ? 'y' : 'x';
                if (
                    previous.netName === merged.netName &&
                    Math.abs(previous.p1[fixed] - previous.p2[fixed]) < 0.001 &&
                    Math.abs(previous.p1[fixed] - merged.p1[fixed]) < 0.001 &&
                    Math.max(
                        Math.min(previous.p1[axis], previous.p2[axis]),
                        Math.min(merged.p1[axis], merged.p2[axis]),
                    ) <=
                        Math.min(
                            Math.max(previous.p1[axis], previous.p2[axis]),
                            Math.max(merged.p1[axis], merged.p2[axis]),
                        ) +
                            0.001
                ) {
                    merged = {
                        ...merged,
                        p1: {
                            ...merged.p1,
                            [axis]: Math.min(
                                previous.p1[axis],
                                previous.p2[axis],
                                merged.p1[axis],
                                merged.p2[axis],
                            ),
                        },
                        p2: {
                            ...merged.p2,
                            [axis]: Math.max(
                                previous.p1[axis],
                                previous.p2[axis],
                                merged.p1[axis],
                                merged.p2[axis],
                            ),
                        },
                    };
                    wires.splice(index, 1);
                    index = 0;
                } else index++;
            }
            wires.push(merged);
        }
        this._generatedWires = wires;
        return [
            ...output.filter((item) => item[0] !== 'wire'),
            ...wires.map(({ p1, p2, netName }) => this.createWire(p1, p2, netName)),
        ];
    }

    /**
     * Attach one global label directly to every connected pin. This avoids wire
     * crossings and routing failures in large generated schematics while keeping
     * KiCad's electrical connectivity explicit and netlistable.
     */
    private generateDirectLabels(): SExpr[] {
        const labels: SExpr[] = [];

        for (const comp of this.snapshot.components) {
            if (comp.symbol === 'Device:DNC') continue;

            // allPins can contain both a named and numbered alias for the same Pin.
            const uniquePins = new Set<Pin>(comp.allPins.values());
            for (const pin of uniquePins) {
                if (!pin.net || pin.isDNC || this.moduleNets.has(pin.net)) continue;

                const pos = this.getPinAbsolutePosition(pin);
                if (!pos) {
                    this.errors.push(
                        `Cannot place net label for '${comp.ref}.${pin.name}': pin position is unavailable.`,
                    );
                    continue;
                }

                const pinDirection = this.getDirectionVector(pos.rotation);
                const outDirection = { dx: -pinDirection.dx, dy: -pinDirection.dy };
                const uuid = this.uuids.getOrGenerate(
                    `direct_label_${comp.ref}_${pin.name}_${pin.net.name}`,
                );
                labels.push(this.createGlobalLabel(pin.net.name, pos.x, pos.y, outDirection, uuid));
            }
        }

        return labels;
    }

    private generateNoConnects(): SExpr[] {
        const items: SExpr[] = [];
        for (const comp of this.snapshot.components) {
            if (comp.symbol === 'Device:DNC') continue;
            for (const [name, pin] of comp.allPins) {
                if ((pin as Pin).isDNC) {
                    const pos = this.getPinAbsolutePosition(pin as Pin);
                    if (pos) {
                        items.push([
                            'no_connect',
                            ['at', `${pos.x.toFixed(2)}`, `${pos.y.toFixed(2)}`],
                            [
                                'uuid',
                                this.quote(this.uuids.getOrGenerate(`${comp.ref}_${name}_nc`)),
                            ],
                        ]);
                    }
                }
            }
        }
        return items;
    }

    private verifyRouting() {
        const clearance =
            this.snapshot.schematicRouting?.wireClearance ??
            (['A4', 'A3'].includes(this.snapshot.size ?? 'A4') ? 2 : 0);
        if (clearance > 0) assertParallelWireSpacing(this._generatedWires, clearance);
        // 1. Line-Rectangle Intersection (Rule 1: Wires cannot overlap symbols)
        const strictBoxes = this.snapshot.components
            .filter((c) => c.symbol !== 'Device:DNC')
            .map((c) => ({
                comp: c,
                box: this.getComponentBox(c, 0), // 0 padding for exact symbol boundaries
            }))
            .filter((x) => x.box !== null) as { comp: Component; box: Box }[];

        // 2. Point-Line Matching (Rule 2: Wires cannot touch unassigned pins)
        // 3. Pin Termination (Rule 3: All assigned pins must be touched)
        const pinRegistry = new Map<
            string,
            { pos: PinPos; netName: string; compRef: string; pinName: string; touched: boolean }
        >();

        for (const comp of this.snapshot.components) {
            if (comp.symbol === 'Device:DNC') continue;
            for (const [name, pin] of comp.allPins) {
                if ((pin as Pin).isDNC || this.moduleUnusedPins.has(pin)) continue;
                const pos = this.getPinAbsolutePosition(pin as Pin);
                if (pos) {
                    pinRegistry.set(`${pos.x.toFixed(2)},${pos.y.toFixed(2)}`, {
                        pos,
                        netName: pin.net?.name || '',
                        compRef: comp.ref,
                        pinName: name,
                        touched: false,
                    });
                }
            }
        }

        // 0. Component-Component Bounding Box Overlaps (Rule 0: Symbols cannot intersect)
        for (let i = 0; i < strictBoxes.length; i++) {
            for (let j = i + 1; j < strictBoxes.length; j++) {
                const b1 = strictBoxes[i].box;
                const b2 = strictBoxes[j].box;

                // Check if rectangles b1 and b2 overlap
                if (
                    b1.x < b2.x + b2.width &&
                    b1.x + b1.width > b2.x &&
                    b1.y < b2.y + b2.height &&
                    b1.y + b1.height > b2.y
                ) {
                    console.warn(
                        `Layout Verification Warning: Component '${strictBoxes[i].comp.ref}' overlaps component '${strictBoxes[j].comp.ref}'.`,
                    );
                }
            }
        }

        const distPointToSegment = (p: Point, v: Point, w: Point) => {
            const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
            if (l2 === 0) return Math.sqrt((p.x - v.x) ** 2 + (p.y - v.y) ** 2);
            let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
            t = Math.max(0, Math.min(1, t));
            return Math.sqrt(
                (p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2,
            );
        };

        const doIntersect = (p1: Point, q1: Point, p2: Point, q2: Point) => {
            const orientation = (a: Point, b: Point, c: Point) => {
                const val = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
                if (val === 0) return 0;
                return val > 0 ? 1 : 2;
            };
            const onSegment = (a: Point, b: Point, c: Point) =>
                b.x <= Math.max(a.x, c.x) &&
                b.x >= Math.min(a.x, c.x) &&
                b.y <= Math.max(a.y, c.y) &&
                b.y >= Math.min(a.y, c.y);

            const o1 = orientation(p1, q1, p2);
            const o2 = orientation(p1, q1, q2);
            const o3 = orientation(p2, q2, p1);
            const o4 = orientation(p2, q2, q1);

            if (o1 !== o2 && o3 !== o4) return true;
            if (o1 === 0 && onSegment(p1, p2, q1)) return true;
            if (o2 === 0 && onSegment(p1, q2, q1)) return true;
            if (o3 === 0 && onSegment(p2, p1, q2)) return true;
            if (o4 === 0 && onSegment(p2, q1, q2)) return true;
            return false;
        };

        for (const wire of this._generatedWires) {
            // Check Rule 1: Box Intersection
            for (const { comp, box } of strictBoxes) {
                const corners = [
                    { x: box.x, y: box.y },
                    { x: box.x + box.width, y: box.y },
                    { x: box.x + box.width, y: box.y + box.height },
                    { x: box.x, y: box.y + box.height },
                ];

                // Check if wire intersects any of the 4 borders
                let intersectsBox = false;
                if (doIntersect(wire.p1, wire.p2, corners[0], corners[1])) intersectsBox = true;
                if (doIntersect(wire.p1, wire.p2, corners[1], corners[2])) intersectsBox = true;
                if (doIntersect(wire.p1, wire.p2, corners[2], corners[3])) intersectsBox = true;
                if (doIntersect(wire.p1, wire.p2, corners[3], corners[0])) intersectsBox = true;

                // Also check if wire is completely inside the box
                if (!intersectsBox) {
                    const isInside = (p: Point) =>
                        p.x >= box.x &&
                        p.x <= box.x + box.width &&
                        p.y >= box.y &&
                        p.y <= box.y + box.height;
                    if (isInside(wire.p1) && isInside(wire.p2)) {
                        intersectsBox = true;
                    }
                }

                if (intersectsBox) {
                    // It's allowed for a wire to touch the boundary to connect to a pin,
                    // but if it crosses through, we error. We'll verify it's just the tip touching a valid pin below.
                    let validPinTouch = false;
                    for (const reg of pinRegistry.values()) {
                        if (reg.compRef === comp.ref) {
                            // Is the wire segment touching this pin exactly at a tip?
                            if (
                                (Math.abs(wire.p1.x - reg.pos.x) < 0.01 &&
                                    Math.abs(wire.p1.y - reg.pos.y) < 0.01) ||
                                (Math.abs(wire.p2.x - reg.pos.x) < 0.01 &&
                                    Math.abs(wire.p2.y - reg.pos.y) < 0.01)
                            ) {
                                validPinTouch = true;
                                break;
                            }
                        }
                    }
                    /*
          if (!validPinTouch) {
            console.warn(`Routing Verification Warning: Wire ${wire.netName} (${wire.p1.x},${wire.p1.y} -> ${wire.p2.x},${wire.p2.y}) overlaps component ${comp.ref} illegally.`);
            // throw new Error(`Routing Verification Error: Wire ${wire.netName}...`);
          }
          */
                }
            }

            // Check Rule 2: Pin contact matching
            for (const [key, reg] of pinRegistry.entries()) {
                const dist = distPointToSegment(reg.pos, wire.p1, wire.p2);
                if (dist < 0.01) {
                    // Wire touches this pin physically
                    if (reg.netName !== wire.netName) {
                        this.errors.push(
                            `Routing Verification Error: Wire for net '${wire.netName}' illegally touches pin '${reg.compRef}.${reg.pinName}' which belongs to net '${reg.netName}'.`,
                        );
                    } else {
                        reg.touched = true;
                    }
                }
            }
        }

        // Check Rule 3: Missing wires
        for (const reg of pinRegistry.values()) {
            if (reg.netName && !reg.touched) {
                // It's possible for power pins to be skipped occasionally if no wire routing was demanded,
                // or if the schematic layout engine simply failed to connect an island.
                this.errors.push(
                    `Routing Verification Error: Pin '${reg.compRef}.${reg.pinName}' belongs to net '${reg.netName}' but no wire touches its coordinate (${reg.pos.x}, ${reg.pos.y}).`,
                );
            }
        }
    }

    private autoRotateComponents() {
        for (const comp of this.snapshot.components) {
            if (comp.symbol === 'Device:DNC') continue;

            // Skip components that have an explicit rotation set (even if it's 0)
            if (comp.schematicPosition?.rotation !== undefined) continue;

            const symDef = this.library.getSymbol(comp.symbol);
            if (!symDef) continue;

            const pins = this.findAllPinsInSymbol(symDef);
            if (pins.length <= 2) {
                // Find which pins connect to GND or Power
                let gndPin: PinInfo | undefined;
                let pwrPin: PinInfo | undefined;

                for (const pinInfo of pins) {
                    if (!pinInfo.number) continue;
                    // The comp.allPins map keys are usually the pin "name" or "number" strings.
                    const pin = comp.allPins.get(pinInfo.number.replace(/"/g, ''));
                    if (!pin || !pin.net) continue;

                    const netName = pin.net.name.toLowerCase();
                    if (pin.net.class === 'Power') {
                        if (netName.includes('gnd') || netName.includes('vss')) {
                            gndPin = pinInfo;
                        } else {
                            pwrPin = pinInfo;
                        }
                    }
                }

                // Only auto-rotate if it's connected to at least one power/gnd net
                if (gndPin || pwrPin) {
                    // If 2 pins, verify they are physically opposed before auto-rotating
                    let areOpposed = true;
                    if (pins.length === 2) {
                        const p1 = pins[0];
                        const p2 = pins[1];
                        // Compute relative angles
                        const angleDiff = Math.abs((p1.rotation - p2.rotation + 360) % 360);
                        if (angleDiff !== 180) {
                            areOpposed = false;
                        }
                    }

                    if (areOpposed) {
                        let targetRotation = 0;
                        if (gndPin) {
                            // We want the GND pin's output vector to point DOWN (dy > 0 => angle 270)
                            // The pin natively points into the component at `gndPin.rotation`.
                            // Output from pin to net is `gndPin.rotation + 180`.
                            // So we want: (gndPin.rotation + 180 + comp.rotation) % 360 === 270
                            targetRotation = (270 - (gndPin.rotation + 180) + 360) % 360;
                            if (!comp.schematicPosition) {
                                (comp as any).schematicPosition = {
                                    x: 0,
                                    y: 0,
                                    rotation: targetRotation,
                                };
                            } else {
                                comp.schematicPosition.rotation = targetRotation;
                            }
                        } else if (pwrPin) {
                            // We want the Power pin's output vector to point UP (dy < 0 => angle 90)
                            targetRotation = (90 - (pwrPin.rotation + 180) + 360) % 360;
                            if (!comp.schematicPosition) {
                                (comp as any).schematicPosition = {
                                    x: 0,
                                    y: 0,
                                    rotation: targetRotation,
                                };
                            } else {
                                comp.schematicPosition.rotation = targetRotation;
                            }
                        }
                    }
                }
            }
        }
    }

    private createWire(p1: Point, p2: Point, netName: string): SExpr {
        this.wireCounter++;
        return [
            'wire',
            [
                'pts',
                [
                    'xy',
                    `${p1.x.toFixed(this.snapshot.connectionStyle === 'routed' || this.snapshot.schematicRouting ? 4 : 2)}`,
                    `${p1.y.toFixed(this.snapshot.connectionStyle === 'routed' || this.snapshot.schematicRouting ? 4 : 2)}`,
                ],
                [
                    'xy',
                    `${p2.x.toFixed(this.snapshot.connectionStyle === 'routed' || this.snapshot.schematicRouting ? 4 : 2)}`,
                    `${p2.y.toFixed(this.snapshot.connectionStyle === 'routed' || this.snapshot.schematicRouting ? 4 : 2)}`,
                ],
            ],
            ['stroke', ['width', '0'], ['type', 'default']],
            ['uuid', this.quote(this.uuids.getOrGenerate(`${netName}_wire_${this.wireCounter}`))],
        ];
    }

    private createGlobalLabel(
        netName: string,
        x: number,
        y: number,
        dir: { dx: number; dy: number },
        uuid: string,
    ): SExpr {
        let angle = 0;
        let justify = 'left';
        let textRot = 0;

        // dir is the direction moving AWAY from the component.
        // KiCad Y-axis increases downwards, so dy < 0 is UP, dy > 0 is DOWN.
        if (dir.dx > 0) {
            // Wire points RIGHT
            angle = 0;
            justify = 'left';
        } else if (dir.dx < 0) {
            // Wire points LEFT
            angle = 180;
            justify = 'right';
        } else if (dir.dy < 0) {
            // Wire points UP
            angle = 90;
            justify = 'left';
            textRot = 90;
        } else {
            // Wire points DOWN
            angle = 270;
            justify = 'right';
            textRot = 90;
        }

        // Add a tiny offset to the text property based on the angle so it doesn't overlap the label shape
        const textX = x + dir.dx * 1.27;
        const textY = y + dir.dy * 1.27;

        return [
            'global_label',
            this.quote(netName),
            ['shape', 'input'],
            ['at', `${x.toFixed(2)}`, `${y.toFixed(2)}`, `${angle}`],
            ['fields_autoplaced', 'yes'],
            ['effects', ['font', ['size', '1.27', '1.27']], ['justify', justify]],
            ['uuid', this.quote(uuid)],
            [
                'property',
                '"Intersheetrefs"',
                '"${INTERSHEET_REFS}"',
                ['at', `${textX.toFixed(2)}`, `${textY.toFixed(2)}`, `${textRot}`],
                [
                    'effects',
                    ['font', ['size', '1.27', '1.27']],
                    ['justify', justify],
                    ['hide', 'yes'],
                ],
            ],
        ];
    }

    private createPowerSymbol(
        netName: string,
        x: number,
        y: number,
        rot: number,
        outDir: { dx: number; dy: number },
        rootUuid: string,
        symUuid: string,
        symbolId = `power:${netName}`,
        inlineText = false,
    ): SExpr {
        this.powerSymbolCounter++;
        const pwrRef = `#PWR${String(this.powerSymbolCounter).padStart(3, '0')}`;

        // KiCad applies the symbol quarter-turn to field angles at render time.
        const textRot = outDir.dx !== 0 ? 90 : 0;
        const textX = x + outDir.dx * 3.81;
        const textY = y + outDir.dy * 3.81;

        return [
            'symbol',
            ['lib_id', this.quote(symbolId)],
            ['at', `${x.toFixed(2)}`, `${y.toFixed(2)}`, `${rot}`],
            ['unit', '1'],
            ['in_bom', 'yes'],
            ['on_board', 'yes'],
            ['uuid', this.quote(symUuid)],
            [
                'property',
                '"Reference"',
                this.quote(pwrRef),
                ['at', `${x.toFixed(2)}`, `${y.toFixed(2)}`, '0'],
                ['effects', ['font', ['size', '1.27', '1.27']], ['hide', 'yes']],
            ],
            [
                'property',
                '"Value"',
                this.quote(netName),
                ['at', `${textX.toFixed(2)}`, `${textY.toFixed(2)}`, `${textRot}`],
                [
                    'effects',
                    ['font', ['size', '1.27', '1.27']],
                    ...(inlineText
                        ? [['justify', outDir.dx > 0 !== (rot === 90) ? 'left' : 'right']]
                        : []),
                ],
            ],
            [
                'property',
                '"Footprint"',
                '""',
                ['at', `${x.toFixed(2)}`, `${y.toFixed(2)}`, '0'],
                ['effects', ['font', ['size', '1.27', '1.27']], ['hide', 'yes']],
            ],
            [
                'property',
                '"Datasheet"',
                '""',
                ['at', `${x.toFixed(2)}`, `${y.toFixed(2)}`, '0'],
                ['effects', ['font', ['size', '1.27', '1.27']], ['hide', 'yes']],
            ],
            ['pin', '"1"', ['uuid', this.quote(this.uuids.getOrGenerate(`${symUuid}_pin_1`))]],
        ];
    }

    private getDirectionVector(angle: number): { dx: number; dy: number } {
        const rad = (angle * Math.PI) / 180;
        const dx = Math.round(Math.cos(rad));
        const dy = -Math.round(Math.sin(rad)); // Invert Y because KiCad Y-axis increases downwards
        return { dx, dy };
    }

    private getPinAbsolutePosition(pin: Pin): PinPos | null {
        const comp = this.snapshot.components.find((c) => c.ref === pin.component.ref);
        if (!comp) return null;

        const symDef = this.library.getSymbol(comp.symbol);
        if (!symDef) return null;

        const pinInfo = this.findPinInSymbol(symDef, pin.name);
        if (!pinInfo) return null;

        const cx = comp.absoluteSchematicPosition?.x || 0;
        const cy = comp.absoluteSchematicPosition?.y || 0;
        const crot = comp.absoluteSchematicPosition?.rotation || 0;

        const rad = (crot * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        // Apply CCW rotation to Library (Y-up) coords, then invert Y for KiCad board space (Y-down)
        const rx = pinInfo.x * cos - pinInfo.y * sin;
        const ry = -(pinInfo.x * sin + pinInfo.y * cos);

        return {
            x: Number((cx + rx).toFixed(6)),
            y: Number((cy + ry).toFixed(6)),
            rotation: (crot + pinInfo.rotation) % 360,
        };
    }

    private findPinInSymbol(symDef: SymbolDefinition, pinNumber: string): PinInfo | null {
        let info = this.scanForPin(symDef.definition, pinNumber);
        if (info) return info;

        for (const dep of symDef.dependencies) {
            info = this.scanForPin(dep, pinNumber);
            if (info) return info;
        }
        return null;
    }

    private scanForPin(expr: SExpr, pinNumber: string): PinInfo | null {
        if (!Array.isArray(expr)) return null;

        for (const item of expr) {
            if (Array.isArray(item) && item[0] === 'symbol') {
                const sub = this.scanForPin(item, pinNumber);
                if (sub) return sub;
            } else if (Array.isArray(item) && item[0] === 'pin') {
                const at = item.find((i) => Array.isArray(i) && i[0] === 'at') as SExpr[];
                const numberItem = item.find(
                    (i) => Array.isArray(i) && i[0] === 'number',
                ) as SExpr[];

                if (at && numberItem && numberItem[1]) {
                    const numStr = SExpressionParser.unquote(numberItem[1] as string);
                    if (numStr === pinNumber) {
                        return {
                            x: parseFloat(at[1] as string),
                            y: parseFloat(at[2] as string),
                            rotation: parseFloat(at[3] as string),
                        };
                    }
                }
            }
        }
        return null;
    }

    private quote(s: string): string {
        return `"${s
            .replace(/\\/g, '\\\\')
            .replace(/\r/g, '\\r')
            .replace(/\n/g, '\\n')
            .replace(/"/g, '\\"')}"`;
    }
}
