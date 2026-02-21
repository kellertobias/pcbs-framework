/**
 * Core types for the PCB design framework.
 */
import type { Net } from "./Net";
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

  constructor(component: { ref: string; symbol: SymbolName }, name: string) {
    this.component = component;
    this.name = name;
  }

  get net(): import("./Net").Net | null {
    return this._net;
  }

  /** @internal */
  _setNet(net: import("./Net").Net): void {
    // If already connected to a different net, we'll allow the override.
    // The Net class is responsible for ensuring consistency during merges.
    this._net = net;
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
  schematicPosition?: SchematicPosition;
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
  schematicPosition?: SchematicPosition;
  pcbPosition?: PcbPosition;
}

/** Options for Composable constructor */
export interface ComposableOptions {
  ref: string;
  description?: string;
  schematicPosition?: SchematicPosition;
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
 * - setter: `component.pins.X = net | pin | DNC | TP | null`
 *
 * TypeScript mapped types can't express different get/set types,
 * so we use a broad union to allow all valid assignment targets.
 */
export type PinAssignable = Pin | Net
  | import("./Markers").DNC
  | import("./Markers").TP
  | null;

export type PinProxy<T extends string | number> = {
  [K in T]: PinAssignable;
} & {
  assign(map: Partial<Record<T, PinAssignable>>): void;
};
