import { SchematicOptions, PlacementAlgorithm } from "@tobisk/pcbs/types";
import { registry } from "@tobisk/pcbs/Registry";
import { Component } from "@tobisk/pcbs/Component";
import { Net } from "@tobisk/pcbs/Net";

/**
 * Abstract base class for all schematics.
 * 
 * A schematic defines a complete circuit design composed of
 * Nets, Components, Composables, and Modules.
 * 
 * @example
 * ```ts
 * class MyBoard extends Schematic {
 *   generate() {
 *     const vcc = new Net({ name: "VCC", class: "Power" });
 *     const r1 = new Component({ symbol: "Device:R", ref: "R1", footprint: "..." });
 *     r1.pins.A = vcc;
 *   }
 * }
 * export default new MyBoard({ name: "MyBoard" });
 * ```
 */
export abstract class Schematic {
  readonly name: string;
  private _layout?: import("./Layout").Layout;
  private _placementAlgorithm?: PlacementAlgorithm;

  constructor(options: SchematicOptions) {
    this.name = options.name;
    this._layout = options.layout;
    this._placementAlgorithm = options.placementAlgorithm;
  }

  /** Generate the circuit — define all nets, components, and connections. */
  abstract generate(): void;

  /** @internal Generate and capture registered objects */
  _generateWithCapture(): {
    name: string;
    components: Component<any>[];
    nets: Net[];
    placementAlgorithm?: PlacementAlgorithm;
  } {
    registry.start();
    try {
      this.generate();

      const topLevelItems = registry.getItems().filter((c: any) => !c.parent);

      if (this._layout) {
        this._layout.apply(topLevelItems);
      }
    } finally {
      registry.stop();
    }
    return {
      name: this.name,
      components: registry.getComponents(),
      nets: registry.getNets(),
      placementAlgorithm: this._placementAlgorithm,
    };
  }
}
