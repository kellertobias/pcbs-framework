import type { PcbPosition, PcbPoint } from './types';

const allowedKeys = new Set(['x', 'y', 'rotation', 'side']);

/** Validate placement at runtime so transpile-only execution cannot hide misspelled keys. */
export function assertPcbPosition(position: PcbPosition | undefined, context: string): void {
    if (position === undefined) return;
    if (position === null || typeof position !== 'object' || Array.isArray(position)) {
        throw new TypeError(
            `${context} pcbPosition must be an object with x, y, optional rotation, and optional side.`,
        );
    }

    const values = position as unknown as Record<string, unknown>;
    for (const key of Object.keys(values)) {
        if (key === 'rotate') {
            throw new TypeError(
                `${context} pcbPosition uses 'rotate', which is not supported. Use 'rotation' (degrees) instead.`,
            );
        }
        if (!allowedKeys.has(key)) {
            throw new TypeError(
                `${context} pcbPosition contains unknown key '${key}'. Allowed keys are x, y, rotation, and side.`,
            );
        }
    }

    for (const key of ['x', 'y'] as const) {
        if (typeof values[key] !== 'number' || !Number.isFinite(values[key])) {
            throw new TypeError(
                `${context} pcbPosition.${key} must be a finite number in millimetres.`,
            );
        }
    }
    if (
        values.rotation !== undefined &&
        (typeof values.rotation !== 'number' || !Number.isFinite(values.rotation))
    ) {
        throw new TypeError(`${context} pcbPosition.rotation must be a finite number in degrees.`);
    }
    if (values.side !== undefined && values.side !== 'front' && values.side !== 'back') {
        throw new TypeError(`${context} pcbPosition.side must be 'front' or 'back'.`);
    }
}

/** Transform module-local coordinates using the same rotation convention as PCB pads. */
export function transformPcbPoint(point: PcbPoint, origin: PcbPosition): PcbPoint {
    const x = origin.side === 'back' ? -point.x : point.x;
    const angle = (-(origin.rotation ?? 0) * Math.PI) / 180;
    const clean = (value: number) => Math.round(value * 1e9) / 1e9;
    return {
        x: clean(origin.x + x * Math.cos(angle) - point.y * Math.sin(angle)),
        y: clean(origin.y + x * Math.sin(angle) + point.y * Math.cos(angle)),
    };
}
