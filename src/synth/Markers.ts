import { Component } from "./Component";
import { Net } from "./Net";
import { Pin, FootprintName } from "./types";

/**
 * A special component used to mark a pin as "Do Not Connect".
 *
 * Usage:
 *   esp.pins.GPIO = new DNC();   // explicit
 *   esp.pins.GPIO = null;        // shorthand (equivalent)
 *
 * If a pin is connected to DNC AND to another functional pin, an error is thrown.
 */
export class DNC extends Component {
  constructor(options?: { ref?: string }) {
    super({
      symbol: "Device:DNC",
      ref: options?.ref ?? "DNC",
      footprint: "DNC",
      description: "Do Not Connect marker",
    });
  }
}

/**
 * A TestPoint component that can be assigned directly to a pin.
 *
 * When assigned to a pin, it automatically connects the TestPoint's single pin
 * to the target pin via an implicit net.
 *
 * Usage:
 *   esp.pins.TX2 = new TP({ ref: "TP1" });
 *   // Equivalent to:
 *   //   const tp = new Component({ symbol: "Connector:TestPoint", ... });
 *   //   esp.pins.TX2 = tp.pins[1];
 */
export class TP extends Component {
  constructor(options: {
    ref: string;
    footprint?: FootprintName;
    description?: string;
  }) {
    super({
      symbol: "Connector:TestPoint",
      ref: options.ref,
      footprint: options.footprint ?? "TestPoint:TestPoint_Pad_D2.5mm",
      description: options.description,
    });
  }
}
