import { Component } from './Component';
import type { PcbPosition as BoardPosition } from './types';

export function offsetPosition(origin: BoardPosition, x: number, y: number): BoardPosition {
    return { x: origin.x + x, y: origin.y + y, rotation: origin.rotation, side: origin.side };
}

export function resistor(ref: string, a: any, b: any, value = '10k', position?: BoardPosition) {
    const part = new Component({
        symbol: 'Device:R',
        ref,
        footprint: 'Resistor_SMD:R_0603_1608Metric',
        value,
        pcbPosition: position,
    });
    part.pins[1].tie(a);
    part.pins[2].tie(b);
    return part;
}

export function capacitor(
    ref: string,
    rail: any,
    ground: any,
    value = '100nF',
    position?: BoardPosition,
    footprint = 'Capacitor_SMD:C_0603_1608Metric',
) {
    const part = new Component({
        symbol: 'Device:C',
        ref,
        footprint,
        value,
        pcbPosition: position,
    });
    part.pins[1].tie(rail);
    part.pins[2].tie(ground);
    return part;
}
