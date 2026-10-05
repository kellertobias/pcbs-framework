import type { CircuitSnapshot, PcbPoint } from './types';

export interface BoardPlacement {
    /** Unique instance identity, also used to isolate child reference and net names. */
    id: string;
    /** Existing source project directory: footprint libraries and captured routing. */
    sourceDirectory?: string;
    /** Use this saved native PCB instead of regenerating copper from the snapshot.
     * Relative paths resolve against sourceDirectory. Missing files fail closed. */
    sourcePcb?: string;
    /** Outer perimeter replaced by the parent panel's tabs/routing. Internal cuts remain. */
    replaceOutline?: PcbPoint[];
    x: number;
    y: number;
    rotation?: number;
    /** Point in the source PCB mapped onto x/y. Defaults to (0, 0). */
    origin?: PcbPoint;
}

export interface BoardReference extends BoardPlacement {
    snapshot: CircuitSnapshot;
}
