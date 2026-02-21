import { Component } from "./Component";
import { Net } from "./Net";
import { KicadLibrarySymbol, KicadLibraryFootprint } from "@tobisk/pcbs/kicad-types";

export type SymbolName = KicadLibrarySymbol | `Composable:${string}` | `Project_Symbols:${string}`;
export type FootprintName = KicadLibraryFootprint | `MountingHole:${string}` | `Composable:${string}` | `Project_Footprints:${string}`;

/** Represents a reference to a physical component pin */
export class Pin {
  /** The component this pin belongs to */
  readonly component: { ref: string; symbol: SymbolName };
  /** The pin name (number or string) */
  readonly name: string;
  /** The net this pin is connected to, if any */
  private _net: import("./Net").Net | null = null;
  /** Whether this pin has been explicitly marked as Do Not Connect */
  private _isDNC: boolean = false;

  constructor(component: { ref: string; symbol: SymbolName }, name: string) {
    this.component = component;
    this.name = name;
  }

  get net(): import("./Net").Net | null {
    return this._net;
  }

  get isDNC(): boolean {
    return this._isDNC;
  }

  /** @internal */
  _setNet(net: import("./Net").Net): void {
    // If already connected to a different net, we'll allow the override.
    // The Net class is responsible for ensuring consistency during merges.
    this._net = net;
  }

  /**
   * Explicitly marks this pin as Do Not Connect (DNC).
   * @param reason Optional description for why it is not connected
   */
  dnc(reason?: string): this {
    if (this._isDNC) return this;

    const dnc = new Component({
      symbol: "Device:DNC",
      ref: `DNC_${this.component.ref}_${this.name}`,
      footprint: "DNC",
      description: reason || "Implicit DNC",
    });
    const ret = this.tie(dnc.pins[1]);
    this._isDNC = true;
    return ret;
  }

  /**
   * Connects this pin to one or more targets (other pins, nets, null).
   */
  tie(...targets: PinAssignable[]): this {
    if (this._isDNC && targets.length > 0) {
      throw new Error(`Cannot connect to Pin ${this.component.ref}.${this.name} because it is marked as Do Not Connect (DNC)`);
    }

    for (let target of targets) {
      if (target === null || target === undefined) {
        this.dnc();
        continue;
      }

      if (target instanceof Component && (target as any).symbol === "Device:DNC") {
        this.tie((target as any).pins[1]);
        continue;
      }

      if (target instanceof Component && (target as any).symbol === "Connector:TestPoint") {
        this.tie((target as any).pins[1]);
        continue;
      }

      if (target instanceof Net || (target && target.constructor && target.constructor.name === "Net")) {
        (target as any).tie(this);
      } else if (target instanceof Pin || (target && target.constructor && target.constructor.name === "Pin")) {
        const otherPin = target as Pin;
        if (otherPin.net) {
          otherPin.net.tie(this);
        } else if (this.net) {
          this.net.tie(otherPin);
        } else {
          const implicit = new Net({
            name: `${otherPin.component.ref}_${otherPin.name}__${this.component.ref}_${this.name}`,
          });
          implicit.tie(otherPin);
          implicit.tie(this);
        }
      }
    }
    return this;
  }
}

/** Net class categories */
export type NetClass = "Power" | "Signal" | "Data" | string;

/** Schematic position info */
export interface SchematicPosition {
  x: number;
  y: number;
  rotation?: number;
}

/** PCB position info */
export interface PcbPosition {
  x: number;
  y: number;
  rotation?: number;
  side?: "front" | "back";
}

/** Common interface for items that can be positioned in a layout */
export interface LayoutItem {
  schematicPosition?: SchematicPosition | null;
  readonly ref: string;
}

/** Interface for layout algorithms */
export interface ILayout {
  apply(items: LayoutItem[]): void;
}

/** Placement algorithms supported by circuit-synth */
export type PlacementAlgorithm = "hierarchical" | "force_directed" | "linear" | "none";

/** Options for Net constructor */
export interface NetOptions {
  name: string;
  class?: NetClass;
}

/** Options for Component constructor (without pin mapping) */
export interface ComponentOptions {
  symbol: SymbolName;
  ref: string;
  footprint: FootprintName;
  description?: string;
  partNo?: string;
  value?: string;
  schematicPosition?: SchematicPosition | null;
  pcbPosition?: PcbPosition;
  /** Group assignment for layout clustering */
  group?: string;
  /** Subschematic page assignment */
  subschematic?: string;
  /** Explicit parent override */
  parent?: any;
}

/** Options for Composable constructor */
export interface ComposableOptions {
  ref: string;
  description?: string;
  schematicPosition?: SchematicPosition | null;
  pcbPosition?: PcbPosition;
  /** Optional layout to apply to internal components */
  layout?: ILayout;
}

/** Options for Module constructor (extends Component) */
export interface ModuleOptions extends ComponentOptions { }

/** Options for Schematic constructor */
export interface SchematicOptions {
  name: string;
  /** Optional layout to apply to top-level components */
  layout?: ILayout;
  /** The algorithm used by circuit-synth for automatic placement. Defaults to "hierarchical". */
  placementAlgorithm?: PlacementAlgorithm;
  /** Size of the schematic (default: "A4") */
  size?: string;
  /** Author of the schematic */
  author?: string;
  /** Revision of the schematic (default: "v1.0") */
  revision?: string;
  /** Description of the schematic */
  description?: string;
}

/**
 * A function that maps numbered pins to named pins.
 * Receives a `pin(n)` helper that returns the Pin for pin number `n`.
 * Returns a record mapping name → Pin.
 */
export type PinMapFn<P extends string> = (pin: (n: string | number) => Pin) => Record<P, Pin>;

/**
 * Proxy type for pin access on Component/Composable.
 *
 * - getter: `component.pins.X` returns `Pin` at runtime
 * - setter: Intentionally restricted. Use `.tie(target)` to connect pins.
 *   This avoids confusing overwrites.
 */
export type PinAssignable = Pin | Net
  | import("./Markers").DNC
  | import("./Markers").TP
  | null;

export type PinProxy<T extends string | number> = {
  readonly [K in T]: Pin;
} & {
  assign(map: Partial<Record<T, PinAssignable>>): void;
};
