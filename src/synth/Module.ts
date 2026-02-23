import { ModuleOptions, PinMapFn } from "@tobisk/pcbs/types";
import { Component } from "@tobisk/pcbs/Component";
import { KicadSymbol } from "@tobisk/pcbs/KicadSymbol";
import { KicadFootprint } from "@tobisk/pcbs/KicadFootprint";
import type { Kicad3DModel } from "@tobisk/pcbs/3d";

export type ExtendedModuleOptions<T extends Record<string, any>, PinNames extends string | number = number> = Omit<ModuleOptions<PinNames>, "symbol" | "footprint" | "pins"> & T

/**
 * A Module is a Component that represents a finished PCB module
 * (e.g., an ESP32 dev board, a sensor breakout) that can be soldered
 * onto the main PCB.
 * 
 * Modules have their own symbols and footprints, which can be
 * generated via the static `makeSymbol()` and `makeFootprint()` methods.
 * 
 * Modules live in `src/module/`.
 * 
 * @example
 * ```ts
 * class ESP32_ETH01 extends Module<"VCC" | "GND" | "TX" | "RX"> {
 *   constructor() {
 *     super({
 *       symbol: "Project_Symbols:ESP32_ETH01",
 *       ref: "U",
 *       footprint: "Project_Footprints:ESP32_ETH01",
 *       description: "ESP32-ETH01 WiFi+Ethernet module",
 *       pins: (pin) => ({
 *         VCC: pin(1), GND: pin(2), TX: pin(14), RX: pin(15),
 *       }),
 *     });
 *   }
 * 
 *   static makeSymbol(): void { ... }
 *   static makeFootprint(): void { ... }
 * }
 * ```
 */
export class Module<PinNames extends string | number = number> extends Component<PinNames> {
  constructor(options: ModuleOptions<PinNames>) {
    super(options);
  }

  /**
   * Generate the KiCad symbol (.kicad_sym) for this module.
   * Override in subclasses to define the symbol geometry and pins.
   */
  static makeSymbol(): KicadSymbol {
    throw new Error(
      `${this.name}.makeSymbol() is not implemented. ` +
      `Override this static method to generate the KiCad symbol.`
    );
  }

  /**
   * Generate the KiCad footprint (.kicad_mod) for this module.
   * Override in subclasses to define the footprint pads and geometry.
   */
  static makeFootprint(): KicadFootprint {
    throw new Error(
      `${this.name}.makeFootprint() is not implemented. ` +
      `Override this static method to generate the KiCad footprint.`
    );
  }

  /**
   * Generate a 3D model for this module (optional).
   * Override in subclasses to define the parametric 3D geometry.
   * Return undefined to skip 3D model generation.
   */
  static make3DModel(): Kicad3DModel | Promise<Kicad3DModel> | undefined {
    return undefined;
  }
}
