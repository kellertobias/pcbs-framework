import { Pin, NetOptions, NetClass, PinAssignable } from "@tobisk/pcbs/types";
import { registry } from "@tobisk/pcbs/Registry";

/**
 * Represents an electrical net (connection) in a circuit.
 * 
 * Nets connect component pins together. Use `tie()` to connect a pin to this net.
 * 
 * @example
 * ```ts
 * const vcc = new Net({ name: "VCC_3V3", class: "Power" });
 * vcc.tie(component.pins.VCC);
 * ```
 */
export class Net {
  readonly name: string;
  readonly class: NetClass;

  /** All pins connected to this net */
  private _pins: Pin[] = [];

  constructor(options: NetOptions) {
    this.name = options.name;
    this.class = options.class ?? "Signal";
    registry.registerNet(this);
  }

  /** Connect a pin (or another net's pin reference) to this net */
  tie(pinOrNet: PinAssignable): void {
    if (pinOrNet === null || pinOrNet === undefined) return;

    let otherNet: Net | null = null;
    let pin: Pin | null = null;

    if (pinOrNet instanceof Net) {
      if (pinOrNet === this) return;
      otherNet = pinOrNet;
    } else {
      pin = pinOrNet as Pin;
      if (pin.net === this) return;
      if (pin.net) {
        otherNet = pin.net;
      }
    }

    if (otherNet) {
      // Check if merging these nets would violate DNC rules
      const thisIsDnc = this._pins.some(p => p.component.symbol === "Device:DNC");
      const otherIsDnc = otherNet.pins.some(p => p.component.symbol === "Device:DNC");

      if (thisIsDnc || otherIsDnc) {
        const thisHasFunctional = this._pins.some(p => p.component.symbol !== "Device:DNC");
        const otherHasFunctional = otherNet.pins.some(p => p.component.symbol !== "Device:DNC");

        if ((thisIsDnc && otherHasFunctional) || (otherIsDnc && thisHasFunctional)) {
          throw new Error(`Cannot merge nets: one is a DNC (Do Not Connect) net and the other has functional connections.`);
        }
      }

      // Merge: transfer all pins from otherNet to this net
      const otherPins = [...otherNet.pins];
      for (const p of otherPins) {
        p._setNet(this);
        if (!this._pins.includes(p)) {
          this._pins.push(p);
        }
      }

      // Remove the old net from registry
      registry.unregisterNet(otherNet);
      return;
    }

    // If we reach here, we are tying a single pin that doesn't have a net yet
    if (!pin) return;

    // Check DNC rule for single pin connection
    const isDncPin = pin.component.symbol === "Device:DNC";
    const dncPins = this._pins.filter(p => p.component.symbol === "Device:DNC");
    const functionalPins = this._pins.filter(p => p.component.symbol !== "Device:DNC");

    if (isDncPin) {
      if (functionalPins.length > 1) {
        throw new Error(`Cannot connect DNC pin to net "${this.name}" because it has multiple functional connections.`);
      }
    } else {
      if (dncPins.length > 0 && functionalPins.length > 0) {
        throw new Error(`Cannot connect pin "${pin.component.ref}.${pin.name}" to net "${this.name}" because it already has a functional connection and is marked as DNC.`);
      }
    }

    // Update the pin and add it to our list.
    pin._setNet(this);
    if (!this._pins.includes(pin)) {
      this._pins.push(pin);
    }
  }

  /** Get all pins connected to this net (read-only) */
  get pins(): ReadonlyArray<Pin> {
    return this._pins;
  }
}
