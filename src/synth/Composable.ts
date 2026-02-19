import { Pin, ComposableOptions, PinProxy, PinAssignable, SchematicPosition, PcbPosition } from "@tobisk-pcb/framework/types";
import { Net } from "@tobisk-pcb/framework/Net";
import { createPinProxy } from "@tobisk-pcb/framework/Component";
import { registry } from "@tobisk-pcb/framework/Registry";

/**
 * Represents a reusable building block — a sub-circuit composed of
 * multiple components and nets that exposes a defined interface.
 *
 * Composables live in `src/lib/` and are meant to be reused
 * across multiple schematics.
 *
 * Subclasses must implement `defineInterface()` which maps each
 * interface pin to an internal component Pin or Net. This method
 * is called lazily on first access of `.pins`.
 *
 * @example
 * ```ts
 * class VoltageDivider extends Composable<"IN" | "OUT" | "GND"> {
 *   constructor() {
 *     super({ ref: "VD", description: "Resistor voltage divider" });
 *   }
 *
 *   protected defineInterface() {
 *     const rTop = new Component({ symbol: "Device:R", ref: `R_${this.ref}_T`, ... });
 *     const rBot = new Component({ symbol: "Device:R", ref: `R_${this.ref}_B`, ... });
 *     const mid = new Net({ name: `${this.ref}_mid` });
 *     mid.tie(rTop.pins[2]);
 *     mid.tie(rBot.pins[1]);
 *     return {
 *       IN:  rTop.pins[1],   // top of divider
 *       OUT: rTop.pins[2],   // midpoint (same Pin as rBot.pins[1] via net)
 *       GND: rBot.pins[2],   // bottom of divider
 *     };
 *   }
 * }
 * ```
 */
export abstract class Composable<InterfaceNets extends string = string> {
  readonly ref: string;
  readonly description?: string;
  readonly schematicPosition?: SchematicPosition;
  readonly pcbPosition?: PcbPosition;
  readonly parent?: Composable<any>;

  /** @internal The current composable being initialized — used for parent assignment */
  static activeComposable: Composable<any> | undefined = undefined;

  /** Pin storage — populated by defineInterface() on first access */
  private _pinStore = new Map<string, Pin>();
  private _interfaceInitialized = false;
  private _pinProxy: PinProxy<InterfaceNets>;
  private _layout?: import("./types").ILayout;

  constructor(options: ComposableOptions) {
    this.ref = options.ref;
    this.description = options.description;
    this.schematicPosition = options.schematicPosition;
    this.pcbPosition = options.pcbPosition;
    this.parent = Composable.activeComposable;
    this._layout = options.layout;

    this._pinProxy = createPinProxy<InterfaceNets>(
      { ref: this.ref, symbol: `Composable:${this.ref}` },
      this._pinStore
    );

    registry.registerComposable(this);
  }

  /**
   * Define the composable's interface by mapping each interface pin name
   * to an internal component Pin or Net.
   *
   * - **Pin**: The composable's interface pin becomes a direct alias for
   *   this component pin. External nets connected to the composable will
   *   tie to this pin.
   *
   * - **Net**: A new interface Pin is created and tied to this internal net.
   *   External nets will connect via this bridge pin.
   *
   * Called once, lazily, on first access of `.pins`.
   */
  protected abstract defineInterface(): Record<InterfaceNets, PinAssignable>;

  /** @internal Initialize the interface from defineInterface() */
  private _ensureInterface(): void {
    if (this._interfaceInitialized) return;
    this._interfaceInitialized = true;

    const prevActive = Composable.activeComposable;
    Composable.activeComposable = this;

    let iface: Record<InterfaceNets, PinAssignable>;
    try {
      iface = this.defineInterface();
    } finally {
      // Get all items from registry and filter for direct children to maintain order
      const children = registry.getItems().filter((c: any) => c.parent === this);

      Composable.activeComposable = prevActive;

      // Apply layout if defined
      if (this._layout) {
        this._layout.apply(children);
      }
    }

    for (const [name, value] of Object.entries(iface)) {
      if (value instanceof Pin) {
        // Direct alias — the composable's pin IS this component pin
        this._pinStore.set(name, value);
      } else if (value instanceof Net) {
        // Bridge — create an interface pin tied to the internal net
        const ifacePin = new Pin(
          { ref: this.ref, symbol: `Composable:${this.ref}` },
          name
        );
        (value as Net).tie(ifacePin);
        this._pinStore.set(name, ifacePin);
      }
    }
  }

  /** Proxy-based pin access — triggers defineInterface() on first access */
  get pins(): PinProxy<InterfaceNets> {
    this._ensureInterface();
    return this._pinProxy;
  }

  /** Get all defined pins */
  get allPins(): ReadonlyMap<string, Pin> {
    this._ensureInterface();
    return this._pinStore;
  }

  /** Get absolute schematic position (recursive) */
  get absoluteSchematicPosition(): SchematicPosition {
    const local = this.schematicPosition || { x: 0, y: 0, rotation: 0 };
    if (!this.parent) return local;

    const parentPos = this.parent.absoluteSchematicPosition;
    return {
      x: parentPos.x + (local.x || 0),
      y: parentPos.y + (local.y || 0),
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
