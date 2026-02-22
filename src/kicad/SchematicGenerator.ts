import { CircuitSnapshot, Pin } from "../synth/types";
import { Component } from "../synth/Component";
import { Net } from "../synth/Net";
import { SymbolLibrary, SymbolDefinition } from "./SymbolLibrary";
import { UuidManager } from "./UuidManager";
import { SExpr, SExpressionParser } from "./SExpressionParser";
import { Router, Point, Box } from "./Router";

interface PinInfo { x: number; y: number; rotation: number; }
interface PinPos { x: number; y: number; rotation: number; }

export class SchematicGenerator {
  private snapshot: CircuitSnapshot;
  private library: SymbolLibrary;
  private uuids: UuidManager;
  private usedSymbols = new Map<string, SymbolDefinition>();
  private router = new Router();
  private _cachedBoxes: Box[] | undefined;
  private wireCounter = 0;

  constructor(snapshot: CircuitSnapshot, library: SymbolLibrary, uuids: UuidManager) {
    this.snapshot = snapshot;
    this.library = library;
    this.uuids = uuids;
  }

  generate(): string {
    // Validate Placement
    this.checkOverlaps();

    const rootUuid = this.uuids.getOrGenerate("ROOT");

    const schematic: SExpr[] = [
      "kicad_sch",
      ["version", "20250114"],
      ["generator", this.quote("eeschema")],
      ["generator_version", this.quote("9.0")],
      ["uuid", this.quote(rootUuid)],
      ["paper", this.quote("A4")],
      ["title_block",
        ["title", this.quote(this.snapshot.name)],
        ["date", this.quote(new Date().toISOString().split('T')[0])],
        this.snapshot.author ? ["author", this.quote(this.snapshot.author)] : [],
        this.snapshot.revision ? ["rev", this.quote(this.snapshot.revision)] : [],
        this.snapshot.description ? ["desc", this.quote(this.snapshot.description)] : [],
        this.snapshot.company ? ["company", this.quote(this.snapshot.company)] : [],
      ].filter(x => x.length > 0),
      this.generateLibSymbols(),
      ...this.generateComponents(),
      ...this.generateWiresAndPower(),
      ...this.generateNoConnects(),
    ];

    return SExpressionParser.serialize(schematic);
  }

  private checkOverlaps() {
    // Use larger padding (50) for overlap check to ensure safe distance
    const boxes = this.snapshot.components
      .filter(c => c.symbol !== "Device:DNC")
      .map(c => ({
        comp: c,
        box: this.getComponentBox(c, 50)
      }))
      .filter(x => x.box !== null) as { comp: Component, box: Box }[];

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const b1 = boxes[i].box;
        const b2 = boxes[j].box;

        if (b1.x < b2.x + b2.width &&
            b1.x + b1.width > b2.x &&
            b1.y < b2.y + b2.height &&
            b1.y + b1.height > b2.y) {
          throw new Error(`Placement overlap detected between ${boxes[i].comp.ref} and ${boxes[j].comp.ref}`);
        }
      }
    }
  }

  private getCachedComponentBoxes(): Box[] {
    if (!this._cachedBoxes) {
      // Use smaller padding (25) for routing obstacles to allow wires near components but not touching
      this._cachedBoxes = this.snapshot.components
        .filter(c => c.symbol !== "Device:DNC")
        .map(c => this.getComponentBox(c, 25))
        .filter(b => b !== null) as Box[];
    }
    return this._cachedBoxes;
  }

  private getComponentBox(comp: Component, padding: number): Box | null {
    if (comp.symbol === "Device:DNC") return null;

    const symDef = this.library.getSymbol(comp.symbol);
    if (!symDef) {
        if (comp.absoluteSchematicPosition) {
             const x = comp.absoluteSchematicPosition.x;
             const y = comp.absoluteSchematicPosition.y;
             return { x: x - 50, y: y - 50, width: 100, height: 100 };
        }
        return null;
    }

    const pins = this.findAllPinsInSymbol(symDef);

    const cx = comp.absoluteSchematicPosition?.x || 0;
    const cy = comp.absoluteSchematicPosition?.y || 0;
    const crot = comp.absoluteSchematicPosition?.rotation || 0;
    const rad = (crot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    if (pins.length === 0) {
        return { x: cx - 50, y: cy - 50, width: 100, height: 100 };
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const pin of pins) {
      const rx = pin.x * cos - pin.y * sin;
      const ry = pin.x * sin + pin.y * cos;
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
      width: (maxX - minX) + 2 * padding,
      height: (maxY - minY) + 2 * padding
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
      if (Array.isArray(item) && item[0] === "symbol") {
        this.collectPins(item, pins);
      } else if (Array.isArray(item) && item[0] === "pin") {
        const at = item.find(i => Array.isArray(i) && i[0] === "at") as SExpr[];
        if (at) {
          pins.push({
            x: parseFloat(at[1] as string),
            y: parseFloat(at[2] as string),
            rotation: parseFloat(at[3] as string)
          });
        }
      }
    }
  }

  private generateLibSymbols(): SExpr {
    const libSymbols: SExpr[] = ["lib_symbols"];
    const processedSymbols = new Set<string>();

    for (const comp of this.snapshot.components) {
      if (comp.symbol === "Device:DNC") continue;

      const symDef = this.library.getSymbol(comp.symbol);
      if (symDef) {
        this.addSymbol(symDef);
        this.processSymbol(symDef.definition, processedSymbols, libSymbols, symDef.dependencies);
      } else {
        console.warn(`Symbol ${comp.symbol} not found in library.`);
      }
    }

    const powerNets = this.snapshot.nets.filter(n => n.class === "Power");
    for (const net of powerNets) {
      const symName = `power:${net.name}`;
      const symDef = this.library.getSymbol(symName);
      if (symDef) {
        this.addSymbol(symDef);
        this.processSymbol(symDef.definition, processedSymbols, libSymbols, symDef.dependencies);
      }
    }

    return libSymbols;
  }

  private processSymbol(definition: SExpr, processedSymbols: Set<string>, libSymbols: SExpr[], dependencies: SExpr[] = []) {
    const name = this.getSymbolName(definition);
    if (!name || processedSymbols.has(name)) return;
    for (const dep of dependencies) {
      this.processSymbol(dep, processedSymbols, libSymbols);
    }
    processedSymbols.add(name);
    libSymbols.push(definition);
  }

  private getSymbolName(sym: SExpr): string | null {
    if (Array.isArray(sym) && sym[0] === "symbol" && typeof sym[1] === "string") {
      return SExpressionParser.unquote(sym[1]);
    }
    return null;
  }

  private addSymbol(symDef: SymbolDefinition) {
    if (this.usedSymbols.has(symDef.name)) return;
    this.usedSymbols.set(symDef.name, symDef);
  }

  private generateComponents(): SExpr[] {
    const rootUuid = this.uuids.getOrGenerate("ROOT");
    const instances: SExpr[] = [];
    for (const comp of this.snapshot.components) {
      if (comp.symbol === "Device:DNC") continue;

      const uuid = this.uuids.getOrGenerate(comp.ref);
      const x = comp.absoluteSchematicPosition?.x || 0;
      const y = comp.absoluteSchematicPosition?.y || 0;
      const rot = comp.absoluteSchematicPosition?.rotation || 0;

      const symName = comp.symbol;

      const instance: SExpr[] = [
        "symbol",
        ["lib_id", this.quote(symName)],
        ["at", x.toFixed(2), y.toFixed(2), rot.toFixed(2)],
        ["unit", "1"],
        ["in_bom", "yes"],
        ["on_board", "yes"],
        ["dnp", "no"],
        ["uuid", this.quote(uuid)],
        ["property", '"Reference"', this.quote(comp.ref), ["at", `${x}`, `${y - 2.54}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]]]],
        ["property", '"Value"', this.quote(comp.value || symName), ["at", `${x}`, `${y + 2.54}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]]]],
        ["property", '"Footprint"', this.quote(comp.footprint || ""), ["at", `${x}`, `${y}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]], ["hide", "yes"]]],
        ["property", '"Datasheet"', '""', ["at", `${x}`, `${y}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]]]],
        ["property", '"Description"', '""', ["at", `${x}`, `${y}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]]]],
        ["property", '"LCSC_Part"', this.quote(comp.partNo || ""), ["at", `${x}`, `${y}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]], ["hide", "yes"]]],
        ["property", '"ki_keywords"', '""', ["at", `${x}`, `${y}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]], ["hide", "yes"]]],
        ["property", '"hierarchy_path"', this.quote(`/${rootUuid}`), ["at", `${x}`, `${y}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]], ["hide", "yes"]]],
        ["property", '"root_uuid"', this.quote(rootUuid), ["at", `${x}`, `${y}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]], ["hide", "yes"]]],
        ...Array.from(comp.allPins.values()).map(pin => [
          "pin",
          this.quote(pin.name),
          ["uuid", this.quote(this.uuids.getOrGenerate(`${comp.ref}_pin_${pin.name}`))]
        ]),
        [
          "instances",
          [
            "project",
            '""',
            [
              "path",
              this.quote(`/${rootUuid}`),
              ["reference", this.quote(comp.ref)],
              ["unit", "1"]
            ]
          ],
          [
            "project",
            this.quote(this.snapshot.name),
            [
              "path",
              this.quote(`/${rootUuid}`),
              ["reference", this.quote(comp.ref)],
              ["unit", "1"]
            ]
          ]
        ]
      ];

      instances.push(instance);
    }
    return instances;
  }

  private generateWiresAndPower(): SExpr[] {
    const rootUuid = this.uuids.getOrGenerate("ROOT");
    const powerSymbols: SExpr[] = [];
    const nets: SExpr[] = [];
    const wires: SExpr[] = [];
    const netPins = new Map<Net, Pin[]>();
    const obstacles = this.getCachedComponentBoxes();

    for (const comp of this.snapshot.components) {
      if (comp.symbol === "Device:DNC") continue;
      for (const [name, pin] of comp.allPins) {
        if (pin.net) {
          if (!netPins.has(pin.net)) netPins.set(pin.net, []);
          netPins.get(pin.net)!.push(pin as Pin);
        }
      }
    }

    for (const [net, pins] of netPins) {
      if (pins.length === 0) continue;

      if (net.class === "Power") {
        for (const pin of pins) {
          const pos = this.getPinAbsolutePosition(pin);
          if (pos) {
            const isGnd = /gnd/i.test(net.name) || /vss/i.test(net.name);
            const dy = isGnd ? 2.54 : -2.54;

            const pinX = pos.x;
            const pinY = pos.y;
            const symX = pinX;
            const symY = pinY + dy;

            wires.push([
              "wire",
              ["pts", ["xy", `${pinX}`, `${pinY}`], ["xy", `${symX}`, `${symY}`]],
              ["stroke", ["width", "0"], ["type", "default"]],
              ["uuid", this.quote(this.uuids.getOrGenerate(`${pin.component.ref}_${pin.name}_pwr_wire`))]
            ]);

             const symUuid = this.uuids.getOrGenerate(`${pin.component.ref}_${pin.name}_pwr_sym`);
             powerSymbols.push(this.createPowerSymbol(net.name, symX, symY, isGnd, rootUuid, symUuid));
          }
        }
      } else {
        const points: PinPos[] = [];
        for (const pin of pins) {
          const p = this.getPinAbsolutePosition(pin);
          if (p) points.push(p);
        }

        for (let i = 0; i < points.length - 1; i++) {
          const p1 = points[i];
          const p2 = points[i + 1];

          const dir1 = this.getDirectionVector(p1.rotation);
          const dir2 = this.getDirectionVector(p2.rotation);

          const s1 = { x: p1.x + dir1.dx * 50, y: p1.y + dir1.dy * 50 };
          const s2 = { x: p2.x + dir2.dx * 50, y: p2.y + dir2.dy * 50 };

          wires.push(this.createWire(p1, s1, net.name));
          wires.push(this.createWire(p2, s2, net.name));

          const path = this.router.route(s1, s2, obstacles);
          for (let k = 0; k < path.length - 1; k++) {
              wires.push(this.createWire(path[k], path[k+1], net.name));
          }
        }
      }
    }

    return [...powerSymbols, ...nets, ...wires];
  }

  private generateNoConnects(): SExpr[] {
    const items: SExpr[] = [];
    for (const comp of this.snapshot.components) {
      if (comp.symbol === "Device:DNC") continue;
      for (const [name, pin] of comp.allPins) {
        if ((pin as Pin).isDNC) {
          const pos = this.getPinAbsolutePosition(pin as Pin);
          if (pos) {
            items.push([
              "no_connect",
              ["at", `${pos.x}`, `${pos.y}`],
              ["uuid", this.quote(this.uuids.getOrGenerate(`${comp.ref}_${name}_nc`))]
            ]);
          }
        }
      }
    }
    return items;
  }

  private createWire(p1: Point, p2: Point, netName: string): SExpr {
      this.wireCounter++;
      return [
            "wire",
            ["pts", ["xy", `${p1.x}`, `${p1.y}`], ["xy", `${p2.x}`, `${p2.y}`]],
            ["stroke", ["width", "0"], ["type", "default"]],
            ["uuid", this.quote(this.uuids.getOrGenerate(`${netName}_wire_${this.wireCounter}`))]
      ];
  }

  private createPowerSymbol(netName: string, x: number, y: number, isGnd: boolean, rootUuid: string, symUuid: string): SExpr {
      return [
              "symbol",
              ["lib_id", this.quote(`power:${netName}`)],
              ["at", `${x}`, `${y}`, "0"],
              ["unit", "1"],
              ["in_bom", "yes"],
              ["on_board", "yes"],
              ["uuid", this.quote(symUuid)],
              ["property", '"Reference"', '"#PWR"', ["at", `${x}`, `${y}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]], ["hide", "yes"]]],
              ["property", '"Value"', this.quote(netName), ["at", `${x}`, `${y + (isGnd ? 2.54 : -2.54)}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]]]],
              ["property", '"Footprint"', '""', ["at", `${x}`, `${y}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]]]],
              ["property", '"Datasheet"', '""', ["at", `${x}`, `${y}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]]]],
              ["property", '"Description"', '""', ["at", `${x}`, `${y}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]]]],
              ["property", '"ki_keywords"', '""', ["at", `${x}`, `${y}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]], ["hide", "yes"]]],
              ["property", '"hierarchy_path"', this.quote(`/${rootUuid}`), ["at", `${x}`, `${y}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]], ["hide", "yes"]]],
              ["property", '"root_uuid"', this.quote(rootUuid), ["at", `${x}`, `${y}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]], ["hide", "yes"]]],
              [
                "pin",
                '"1"',
                ["uuid", this.quote(this.uuids.getOrGenerate(`${symUuid}_pin_1`))]
              ],
              [
                "instances",
                [
                  "project",
                  '""',
                  [
                    "path",
                    this.quote(`/${rootUuid}`),
                    ["reference", '"#PWR"'],
                    ["unit", "1"]
                  ]
                ],
                [
                  "project",
                  this.quote(this.snapshot.name),
                  [
                    "path",
                    this.quote(`/${rootUuid}`),
                    ["reference", '"#PWR"'],
                    ["unit", "1"]
                  ]
                ]
              ]
            ];
  }

  private getDirectionVector(angle: number): { dx: number, dy: number } {
      const rad = (angle * Math.PI) / 180;
      const dx = Math.round(Math.cos(rad));
      const dy = Math.round(Math.sin(rad));
      return { dx, dy };
  }

  private getPinAbsolutePosition(pin: Pin): PinPos | null {
    const comp = this.snapshot.components.find(c => c.ref === pin.component.ref);
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

    const rx = pinInfo.x * cos - pinInfo.y * sin;
    const ry = pinInfo.x * sin + pinInfo.y * cos;

    return {
      x: cx + rx,
      y: cy + ry,
      rotation: (crot + pinInfo.rotation) % 360
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
      if (Array.isArray(item) && item[0] === "symbol") {
        const sub = this.scanForPin(item, pinNumber);
        if (sub) return sub;
      } else if (Array.isArray(item) && item[0] === "pin") {
        const at = item.find(i => Array.isArray(i) && i[0] === "at") as SExpr[];
        const numberItem = item.find(i => Array.isArray(i) && i[0] === "number") as SExpr[];

        if (at && numberItem && numberItem[1]) {
          const numStr = SExpressionParser.unquote(numberItem[1] as string);
          if (numStr === pinNumber) {
            return {
              x: parseFloat(at[1] as string),
              y: parseFloat(at[2] as string),
              rotation: parseFloat(at[3] as string)
            };
          }
        }
      }
    }
    return null;
  }

  private quote(s: string): string {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
}
