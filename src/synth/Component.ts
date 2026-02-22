import { Pin, SymbolName, FootprintName, PinProxy, PinAssignable, ComponentOptions, PinMapFn, SchematicPosition, PcbPosition } from "@tobisk/pcbs/types";
import { Composable } from "@tobisk/pcbs/Composable";
import { KicadLibrarySymbol, KicadLibraryFootprint } from "@tobisk/pcbs/kicad-types";
import { Net } from "@tobisk/pcbs/Net";
import { registry } from "@tobisk/pcbs/Registry";

/**
 * Creates a Proxy that provides typed pin access on a component or composable.
 *
 * - getter: returns the Pin object (creates it lazily if not yet accessed)
 * - setter: accepts a Pin or Net; if Net, calls net.tie(pin)
 */
export function createPinProxy<T extends string | number>(
  owner: { ref: string; symbol: SymbolName },
  pinStore: Map<string, Pin>
): PinProxy<T> {
  const setPin = (key: string, value: Pin | Net | Component | null | undefined): boolean => {
    // Ensure the pin exists
    if (!pinStore.has(key)) {
      pinStore.set(key, new Pin(owner, key));
    }
    const pin = pinStore.get(key)!;

    if (value !== null && value !== undefined) {
      throw new Error(`Direct pin assignment via '=' is not allowed by the runtime proxy. Use pin.tie() to connect nets or pin.dnc() to mark as Do Not Connect.`);
    }

    // Pass the target to `.tie()` to respect its internal DNC markers
    pin.tie(value ?? null);

    return true;
  };

  return new Proxy({} as PinProxy<T>, {
    get(_target, prop: string | symbol): any {
      const key = String(prop);
      if (key === "assign") {
        return (map: Record<string, PinAssignable>) => {
          for (const [k, v] of Object.entries(map)) {
            if (!pinStore.has(k)) {
              pinStore.set(k, new Pin(owner, k));
            }
            pinStore.get(k)!.tie(v);
          }
        };
      }
      if (!pinStore.has(key)) {
        pinStore.set(key, new Pin(owner, key));
      }
      return pinStore.get(key)!;
    },
    set(_target, prop: string | symbol, value: Pin | Net | Component | null | undefined): boolean {
      return setPin(String(prop), value);
    },
  });
}

/**
 * Represents an electronic component in a circuit.
 *
 * Components have a KiCad symbol, reference designator, footprint,
 * and proxy-based pin access for type-safe net connections.
 *
 * @example
 * ```ts
 * // Numeric pins (default)
 * const r1 = new Component({
 *   symbol: "Device:R", ref: "R1",
 *   footprint: "Resistor_SMD:R_0603_1608Metric",
 *   value: "10k",
 * });
 * r1.pins[1] = vccNet;
 * r1.pins[2] = gndNet;
 *
 * // Named pins via mapping function
 * const esp = new Component({
 *   symbol: "Project_Symbols:ESP32", ref: "U1",
 *   footprint: "Project_Footprints:ESP32",
 *   pins: (pin) => ({
 *     VCC: pin(1),
 *     GND: pin(2),
 *     TX:  pin(14),
 *     RX:  pin(15),
 *   }),
 * });
 * esp.pins.VCC = vcc3v3;
 * ```
 */
export class Component<PinNames extends string | number = number> {
  static activeGroup?: string = undefined;
  static activeSubschematic?: string = undefined;

  readonly symbol: SymbolName;
  readonly ref: string;
  readonly footprint: FootprintName;
  readonly description?: string;
  readonly partNo?: string;
  readonly value?: string;
  readonly schematicPosition?: SchematicPosition | null;
  readonly pcbPosition?: PcbPosition;
  readonly parent?: Composable<any>;
  readonly group?: string;
  readonly subschematic?: string;

  /** Pin storage */
  private _pinStore = new Map<string, Pin>();

  /** Proxy-based pin access: get returns Pin, set accepts Pin | Net */
  readonly pins: PinProxy<PinNames>;

  constructor(options: ComponentOptions & {
    pins?: PinMapFn<PinNames & string>;
  }) {
    this.symbol = options.symbol;
    this.ref = options.ref;
    this.footprint = options.footprint;
    this.description = options.description;
    this.partNo = options.partNo;
    this.value = options.value;

    if (options.pos) {
      this.schematicPosition = { x: options.pos.x, y: options.pos.y, rotation: options.pos.r || 0 };
    } else {
      this.schematicPosition = options.schematicPosition;
    }

    this.pcbPosition = options.pcbPosition;
    this.parent = options.parent ?? Composable.activeComposable;
    this.group = options.group || Component.activeGroup;
    this.subschematic = options.subschematic || Component.activeSubschematic;

    // If a pin mapping function is provided, call it to create named aliases
    if (options.pins) {
      const pinGetter = (n: string | number): Pin => {
        const key = String(n);
        if (!this._pinStore.has(key)) {
          this._pinStore.set(key, new Pin({ ref: this.ref, symbol: this.symbol }, key));
        }
        return this._pinStore.get(key)!;
      };

      const mapping = options.pins(pinGetter);

      // Register named aliases pointing to the same Pin objects
      for (const [name, pin] of Object.entries(mapping)) {
        this._pinStore.set(name, pin as Pin);
      }
    }

    this.pins = createPinProxy<PinNames>(
      { ref: this.ref, symbol: this.symbol },
      this._pinStore
    );

    registry.registerComponent(this);
  }

  /**
   * Helper to quickly assign power pins from a record.
   */
  power(mapping: Record<string, PinAssignable>): this {
    for (const [key, val] of Object.entries(mapping)) {
      this._pinStore.get(key)?.tie(val) || (this.pins as any)[key].tie(val);
    }
    return this;
  }

  /** Get all defined pins */
  get allPins(): ReadonlyMap<string, Pin> {
    return this._pinStore;
  }

  /** Get absolute schematic position (recursive) */
  get absoluteSchematicPosition(): SchematicPosition | null {
    if (this.schematicPosition === null) return null;
    const local = this.schematicPosition || { x: 0, y: 0, rotation: 0 };
    if (!this.parent) return local;

    const parentPos = this.parent.absoluteSchematicPosition;
    if (parentPos === null) return null;

    const pRot = (parentPos.rotation || 0) * (Math.PI / 180);
    const cos = Math.cos(pRot);
    const sin = Math.sin(pRot);

    const localX = local.x || 0;
    const localY = local.y || 0;

    return {
      x: parentPos.x + (localX * cos - localY * sin),
      y: parentPos.y + (localX * sin + localY * cos),
      rotation: (parentPos.rotation || 0) + (local.rotation || 0),
    };
  }

  /** Get absolute PCB position (recursive) */
  get absolutePcbPosition(): PcbPosition {
    const local = this.pcbPosition || { x: 0, y: 0, rotation: 0 };
    const side = local.side || this.parent?.absolutePcbPosition.side || "front";

    if (!this.parent) return { ...local, side };

    const parentPos = this.parent.absolutePcbPosition;
    return {
      x: parentPos.x + (local.x || 0),
      y: parentPos.y + (local.y || 0),
      rotation: (parentPos.rotation || 0) + (local.rotation || 0),
      side,
    };
  }
}
