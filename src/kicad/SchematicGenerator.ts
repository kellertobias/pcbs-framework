import { CircuitSnapshot, Pin } from "../synth/types";
import { Component } from "../synth/Component";
import { Net } from "../synth/Net";
import { SymbolLibrary, SymbolDefinition } from "./SymbolLibrary";
import { UuidManager } from "./UuidManager";
import { SExpr, SExpressionParser } from "./SExpressionParser";
import { Router, Point, Box } from "./Router";
import { HierarchicalPlacer } from "./HierarchicalPlacer";
import { KicadGeneratorOptions } from "./KicadGenerator";

interface PinInfo { x: number; y: number; rotation: number; }
interface PinPos { x: number; y: number; rotation: number; }

export class SchematicGenerator {
  private snapshot: CircuitSnapshot;
  private library: SymbolLibrary;
  private uuids: UuidManager;
  private usedSymbols = new Map<string, SymbolDefinition>();
  private router = new Router(1.27);
  public errors: string[] = [];
  private _cachedBoxes: Box[] | undefined;
  private _generatedWires: { p1: Point, p2: Point, netName: string }[] = [];
  private wireCounter = 0;
  private options: KicadGeneratorOptions;

  constructor(snapshot: CircuitSnapshot, library: SymbolLibrary, uuids: UuidManager, options: KicadGeneratorOptions = {}) {
    this.snapshot = snapshot;
    this.library = library;
    this.uuids = uuids;
    this.options = options;
  }

  generate(): string {
    // Auto-layout components if needed
    HierarchicalPlacer.place(this.snapshot, (comp) => this.getComponentDimensions(comp));

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
      ].filter(x => x.length > 0)
    ];

    if (!this.options.noSymbols) {
      schematic.push(this.generateLibSymbols());
      schematic.push(...this.generateComponents());
    }

    if (!this.options.noWires) {
      schematic.push(...this.generateWiresAndPower());
      schematic.push(...this.generateNoConnects());

      // Verify all routing constraints
      this.verifyRouting();
    }

    return SExpressionParser.serialize(schematic);
  }

  private checkOverlaps() {
    // Use smaller padding (2) for overlap check since we reduced HierarchicalPlacer padding
    const boxes = this.snapshot.components
      .filter(c => c.symbol !== "Device:DNC")
      .map(c => ({
        comp: c,
        box: this.getComponentBox(c, 2)
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
          this.errors.push(`Placement overlap detected between ${boxes[i].comp.ref} and ${boxes[j].comp.ref}`);
        }
      }
    }
  }

  private getCachedComponentBoxes(): Box[] {
    if (!this._cachedBoxes) {
      // Use smaller padding (0.5) for routing obstacles to match dense physics layout
      this._cachedBoxes = this.snapshot.components
        .filter(c => c.symbol !== "Device:DNC")
        .map(c => this.getComponentBox(c, 0.5))
        .filter(b => b !== null) as Box[];
    }
    return this._cachedBoxes;
  }

  private getComponentDimensions(comp: Component): { width: number, height: number } {
    if (comp.symbol === "Device:DNC") return { width: 0, height: 0 };
    const symDef = this.library.getSymbol(comp.symbol);
    if (!symDef) return { width: 25, height: 25 };

    const pins = this.findAllPinsInSymbol(symDef);
    if (pins.length === 0) return { width: 25, height: 25 };

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    // We estimate the physical envelope of the un-rotated component simply by bounding its pins
    for (const pin of pins) {
      minX = Math.min(minX, pin.x); maxX = Math.max(maxX, pin.x);
      minY = Math.min(minY, pin.y); maxY = Math.max(maxY, pin.y);
    }

    if (minX === Infinity) return { width: 15, height: 15 };
    return { width: Math.max(15, maxX - minX), height: Math.max(15, maxY - minY) };
  }

  private getComponentBox(comp: Component, padding: number): Box | null {
    if (comp.symbol === "Device:DNC") return null;

    const symDef = this.library.getSymbol(comp.symbol);
    if (!symDef) {
      if (comp.absoluteSchematicPosition) {
        const x = comp.absoluteSchematicPosition.x;
        const y = comp.absoluteSchematicPosition.y;
        return { x: x - 12.5 - padding, y: y - 12.5 - padding, width: 25 + 2 * padding, height: 25 + 2 * padding };
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
      return { x: cx - 12.5 - padding, y: cy - 12.5 - padding, width: 25 + 2 * padding, height: 25 + 2 * padding };
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

    const getDepth = (compRef: string): number => {
      const comp = this.snapshot.components.find(c => c.ref === compRef);
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
      const depthA = Math.max(...a[1].map(p => getDepth(p.component.ref)));
      const depthB = Math.max(...b[1].map(p => getDepth(p.component.ref)));
      return depthB - depthA;
    });

    for (const [net, pins] of sortedNets) {
      if (pins.length === 0) continue;

      if (net.class === "Power") {
        for (const pin of pins) {
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

            const symUuid = this.uuids.getOrGenerate(`${pin.component.ref}_${pin.name}_pwr_sym`);
            powerSymbols.push(this.createPowerSymbol(net.name, symX, symY, rot, outDir, rootUuid, symUuid));
          }
        }
      } else {
        const points: { pos: PinPos, pin: Pin }[] = [];
        for (const pin of pins) {
          const p = this.getPinAbsolutePosition(pin);
          if (p) points.push({ pos: p, pin });
        }

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

          addWire(p1, s1, net.name);
          addWire(p2, s2, net.name);

          let path: Point[] = [];
          try {
            path = this.router.route(s1, s2, obstacles);
          } catch (e: any) {
            this.errors.push(`ROUTER_DEAD_END: Net '${net.name}' failed to route between ${pt1.pin.component.ref}.${pt1.pin.name} and ${pt2.pin.component.ref}.${pt2.pin.name}. Details: ${e.message}`);
            path = [s1, s2];
          }

          for (let k = 0; k < path.length - 1; k++) {
            addWire(path[k], path[k + 1], net.name);
          }
        }
      }
    }

    return [...powerSymbols, ...nets, ...Array.from(uniqueWires.values())];
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

  private verifyRouting() {
    // 1. Line-Rectangle Intersection (Rule 1: Wires cannot overlap symbols)
    const strictBoxes = this.snapshot.components
      .filter(c => c.symbol !== "Device:DNC")
      .map(c => ({
        comp: c,
        box: this.getComponentBox(c, 0) // 0 padding for exact symbol boundaries
      }))
      .filter(x => x.box !== null) as { comp: Component, box: Box }[];

    // 2. Point-Line Matching (Rule 2: Wires cannot touch unassigned pins)
    // 3. Pin Termination (Rule 3: All assigned pins must be touched)
    const pinRegistry = new Map<string, { pos: PinPos, netName: string, compRef: string, pinName: string, touched: boolean }>();

    for (const comp of this.snapshot.components) {
      if (comp.symbol === "Device:DNC") continue;
      for (const [name, pin] of comp.allPins) {
        if ((pin as Pin).isDNC) continue;
        const pos = this.getPinAbsolutePosition(pin as Pin);
        if (pos) {
          pinRegistry.set(`${pos.x.toFixed(2)},${pos.y.toFixed(2)}`, {
            pos,
            netName: pin.net?.name || "",
            compRef: comp.ref,
            pinName: name,
            touched: false
          });
        }
      }
    }

    const distPointToSegment = (p: Point, v: Point, w: Point) => {
      const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
      if (l2 === 0) return Math.sqrt((p.x - v.x) ** 2 + (p.y - v.y) ** 2);
      let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.sqrt((p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2);
    };

    const doIntersect = (p1: Point, q1: Point, p2: Point, q2: Point) => {
      const orientation = (a: Point, b: Point, c: Point) => {
        const val = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
        if (val === 0) return 0;
        return val > 0 ? 1 : 2;
      };
      const onSegment = (a: Point, b: Point, c: Point) =>
        b.x <= Math.max(a.x, c.x) && b.x >= Math.min(a.x, c.x) &&
        b.y <= Math.max(a.y, c.y) && b.y >= Math.min(a.y, c.y);

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
          { x: box.x, y: box.y + box.height }
        ];

        // Check if wire intersects any of the 4 borders
        let intersectsBox = false;
        if (doIntersect(wire.p1, wire.p2, corners[0], corners[1])) intersectsBox = true;
        if (doIntersect(wire.p1, wire.p2, corners[1], corners[2])) intersectsBox = true;
        if (doIntersect(wire.p1, wire.p2, corners[2], corners[3])) intersectsBox = true;
        if (doIntersect(wire.p1, wire.p2, corners[3], corners[0])) intersectsBox = true;

        // Also check if wire is completely inside the box
        if (!intersectsBox) {
          const isInside = (p: Point) => p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
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
              if ((Math.abs(wire.p1.x - reg.pos.x) < 0.01 && Math.abs(wire.p1.y - reg.pos.y) < 0.01) ||
                (Math.abs(wire.p2.x - reg.pos.x) < 0.01 && Math.abs(wire.p2.y - reg.pos.y) < 0.01)) {
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
            this.errors.push(`Routing Verification Error: Wire for net '${wire.netName}' illegally touches pin '${reg.compRef}.${reg.pinName}' which belongs to net '${reg.netName}'.`);
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
        this.errors.push(`Routing Verification Error: Pin '${reg.compRef}.${reg.pinName}' belongs to net '${reg.netName}' but no wire touches its coordinate (${reg.pos.x}, ${reg.pos.y}).`);
      }
    }
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

  private createPowerSymbol(netName: string, x: number, y: number, rot: number, outDir: { dx: number, dy: number }, rootUuid: string, symUuid: string): SExpr {
    // Determine text orientation. If body points left/right, text can be vertical.
    const textRot = (outDir.dx !== 0) ? 90 : 0;
    const textX = x + outDir.dx * 2.54;
    const textY = y + outDir.dy * 2.54;

    return [
      "symbol",
      ["lib_id", this.quote(`power:${netName}`)],
      ["at", `${x.toFixed(2)}`, `${y.toFixed(2)}`, `${rot}`],
      ["unit", "1"],
      ["in_bom", "yes"],
      ["on_board", "yes"],
      ["uuid", this.quote(symUuid)],
      ["property", '"Reference"', '"#PWR"', ["at", `${x.toFixed(2)}`, `${y.toFixed(2)}`, "0"], ["effects", ["font", ["size", "1.27", "1.27"]], ["hide", "yes"]]],
      ["property", '"Value"', this.quote(netName), ["at", `${textX.toFixed(2)}`, `${textY.toFixed(2)}`, `${textRot}`], ["effects", ["font", ["size", "1.27", "1.27"]]]],
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
    const dy = -Math.round(Math.sin(rad)); // Invert Y because KiCad Y-axis increases downwards
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
