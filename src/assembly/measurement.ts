import type { AssemblyVector } from '../synth/Assembly';
/** Coordinates are already transformed into assembly space, in millimetres. */
export function measureAssemblyPoints(a: AssemblyVector, b: AssemblyVector) {
    if (![...a, ...b].every(Number.isFinite))
        throw new Error('Measurement needs finite coordinates');
    const delta = b.map((value, axis) => value - a[axis]) as AssemblyVector;
    return { distance: Math.hypot(...delta), delta };
}
