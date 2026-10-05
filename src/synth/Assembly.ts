import type { Kicad3DModel } from './3d/Kicad3DModel';
import type { Schematic } from './Schematic';

export type AssemblyVector = [number, number, number];
export interface AssemblyPlacement {
    id: string;
    name?: string;
    /** Millimetres, in a right-handed Z-up assembly coordinate system. */
    position?: AssemblyVector;
    /** Euler XYZ rotation in degrees, applied before translation. */
    rotation?: AssemblyVector;
    visible?: boolean;
    /** Parent assembly group; transforms are relative to that group. */
    group?: string;
}
export interface AssemblyGroup extends AssemblyPlacement {
    kind: 'group';
}
export interface AssemblyBoard extends AssemblyPlacement {
    kind: 'board';
    /** Existing PCB, KiCad schematic (sibling PCB), or TypeScript schematic entry. */
    file?: string;
    /** A schematic instance requires sourceDirectory; its PCB must already exist. */
    schematic?: Schematic;
    sourceDirectory?: string;
    /** KiCad PCB XY origin exported to assembly (0,0); coordinates are millimetres.
     * Native board Z=0 is the substrate mid-plane; PCB Y maps to model -Y. */
    origin?: [number, number];
}
export interface AssemblyFileModel extends AssemblyPlacement {
    kind: 'model';
    file: string;
    /** WRL defaults to KiCad tenths-of-inch, GLTF/GLB to metres; others to mm. */
    unit?: 'mm' | 'm' | 'tenths';
    /** GLTF/GLB default to Y-up; other models to Z-up. */
    upAxis?: 'y' | 'z';
}
export interface AssemblyGeneratedModel extends AssemblyPlacement {
    kind: 'generated';
    /** Additional file inputs read by the generator, relative to the assembly entry. */
    inputs?: string[];
    model: Kicad3DModel | (() => Kicad3DModel | Promise<Kicad3DModel>);
}
export interface AssemblyFrontPanel extends AssemblyPlacement {
    kind: 'front-panel';
    /** IDs of boards whose footprint cutouts are projected along board normals. */
    sources: Array<string | { part: string; references: string[] }>;
    /** Outline in local panel XY millimetres. Plate extends from Z=0 to thickness. */
    outline: [number, number][];
    thickness: number;
    /** Extra distance along the rotated panel normal, in millimetres. */
    offset?: number;
    color?: string;
    /** Additional through openings for mechanical fixings, in panel-local XY millimetres. */
    cutouts?: [number, number][][];
    /** Underside pockets, depth measured upward from the plate near face. */
    reliefs?: Array<{ outline: [number, number][]; depth: number }>;
    /** Fold centreline profiles in panel-local YZ, across the outline width. */
    folds?: Array<{
        name?: string;
        path: [number, number][];
        insideRadius: number;
    }>;
}
export interface AssemblyView {
    id: string;
    name?: string;
    position: AssemblyVector;
    target: AssemblyVector;
    up?: AssemblyVector;
    projection?: 'perspective' | 'orthographic';
    /** Orthographic vertical span in millimetres. */
    span?: number;
    visibleParts?: string[];
}
export type AssemblyPart =
    | AssemblyBoard
    | AssemblyFileModel
    | AssemblyGeneratedModel
    | AssemblyFrontPanel
    | AssemblyGroup;
export interface AssemblyOptions {
    name: string;
    parts?: AssemblyPart[];
    views?: AssemblyView[];
}
export interface AssemblyPlacements {
    unit: 'mm';
    parts: AssemblyPlacement[];
}
/** Mechanical assembly of independent physical boards and models. No electrical
 * merging, synthesis or PCB writes occur while preparing or viewing an assembly.
 */
export class Assembly {
    readonly name: string;
    readonly views: AssemblyView[];
    private readonly _parts: AssemblyPart[] = [];
    constructor(options: AssemblyOptions) {
        if (!options.name?.trim()) throw new Error('Assembly needs a name');
        this.name = options.name;
        this.views = structuredClone(options.views ?? []);
        const ids = new Set<string>();
        for (const view of this.views) {
            if (!/^[\w.-]+$/.test(view.id) || ids.has(view.id))
                throw new Error('Invalid or duplicate view ID');
            ids.add(view.id);
            for (const vector of [view.position, view.target, view.up ?? [0, 0, 1]])
                if (vector.length !== 3 || !vector.every(Number.isFinite))
                    throw new Error('Invalid view vector');
            if (view.position.every((v, i) => v === view.target[i]))
                throw new Error('View camera needs a direction');
            if (view.up?.every((v) => v === 0)) throw new Error('View up vector cannot be zero');
            if (view.span !== undefined && (!Number.isFinite(view.span) || view.span <= 0))
                throw new Error('Invalid view span');
            if (view.projection && !['perspective', 'orthographic'].includes(view.projection))
                throw new Error('Invalid view projection');
        }
        for (const part of options.parts ?? []) this.add(part);
    }
    get parts(): readonly AssemblyPart[] {
        return this._parts;
    }
    add(part: AssemblyPart): this {
        if (!/^[\w.-]+$/.test(part.id) || this._parts.some((p) => p.id === part.id))
            throw new Error(`Invalid or duplicate assembly part ID: ${part.id}`);
        if (!['board', 'model', 'generated', 'front-panel', 'group'].includes(part.kind))
            throw new Error('Unknown assembly source');
        for (const key of ['position', 'rotation'] as const) {
            const v = part[key];
            if (v && (v.length !== 3 || !v.every(Number.isFinite)))
                throw new Error(`Invalid ${key} for ${part.id}`);
        }
        if (part.kind === 'board') {
            if (Boolean(part.file) === Boolean(part.schematic))
                throw new Error(`Board ${part.id} needs exactly one file or schematic`);
            if (part.schematic && !part.sourceDirectory)
                throw new Error('Schematic instance needs sourceDirectory');
            if (part.origin && (part.origin.length !== 2 || !part.origin.every(Number.isFinite)))
                throw new Error(`Invalid PCB origin for ${part.id}`);
        }
        if (part.kind === 'model') {
            if (!part.file) throw new Error(`Missing model file for ${part.id}`);
            if (part.unit && !['mm', 'm', 'tenths'].includes(part.unit))
                throw new Error('Unknown model unit');
            if (part.upAxis && !['y', 'z'].includes(part.upAxis))
                throw new Error('Unknown model up axis');
        }
        if (part.kind === 'generated' && !part.model)
            throw new Error(`Missing generator for ${part.id}`);
        if (part.kind === 'front-panel') {
            if (
                !part.sources.length ||
                part.outline.length < 3 ||
                part.outline.some((p) => p.length !== 2 || !p.every(Number.isFinite)) ||
                !Number.isFinite(part.thickness) ||
                part.thickness <= 0 ||
                !Number.isFinite(part.offset ?? 0)
            )
                throw new Error('Invalid front panel');
            for (const relief of part.reliefs ?? [])
                if (
                    !Number.isFinite(relief.depth) ||
                    relief.depth <= 0 ||
                    relief.depth >= part.thickness ||
                    relief.outline.length < 3 ||
                    relief.outline.some((p) => p.length !== 2 || !p.every(Number.isFinite))
                )
                    throw new Error('Invalid panel relief');
            for (const ring of part.cutouts ?? [])
                if (
                    ring.length < 3 ||
                    ring.some((p) => p.length !== 2 || !p.every(Number.isFinite))
                )
                    throw new Error('Invalid panel mechanical cutout');
            if (part.color && !/^#[0-9a-f]{6}$/i.test(part.color))
                throw new Error('Panel color must be #RRGGBB');
        }
        this._parts.push({
            ...part,
            position: part.position ? [...part.position] : undefined,
            rotation: part.rotation ? [...part.rotation] : undefined,
        });
        return this;
    }
    /** Apply a downloaded viewer placement file. Validate the whole update before
     * mutation so a bad identity or unit cannot partially move an assembly.
     */
    applyPlacements(placements: AssemblyPlacements): this {
        if (placements.unit !== 'mm' || !Array.isArray(placements.parts))
            throw new Error('Placements must use millimetres');
        const updates = new Map<string, AssemblyPlacement>();
        for (const placement of placements.parts) {
            if (!this._parts.some((p) => p.id === placement.id) || updates.has(placement.id))
                throw new Error(`Unknown or duplicate placement: ${placement.id}`);
            for (const key of ['position', 'rotation'] as const) {
                const value = placement[key];
                if (value && (value.length !== 3 || !value.every(Number.isFinite)))
                    throw new Error(`Invalid placement ${key}`);
            }
            if (placement.visible !== undefined && typeof placement.visible !== 'boolean')
                throw new Error('Invalid placement visibility');
            updates.set(placement.id, placement);
        }
        for (const part of this._parts) {
            const update = updates.get(part.id);
            if (!update) continue;
            if (update.position) part.position = [...update.position];
            if (update.rotation) part.rotation = [...update.rotation];
            if (update.visible !== undefined) part.visible = update.visible;
        }
        return this;
    }
    addGroup(part: Omit<AssemblyGroup, 'kind'>): this {
        return this.add({ ...part, kind: 'group' });
    }
    addFrontPanel(part: Omit<AssemblyFrontPanel, 'kind'>): this {
        return this.add({ ...part, kind: 'front-panel' });
    }
    addBoard(part: Omit<AssemblyBoard, 'kind'>): this {
        return this.add({ ...part, kind: 'board' });
    }
    addModel(part: Omit<AssemblyFileModel, 'kind'>): this {
        return this.add({ ...part, kind: 'model' });
    }
    addGenerated(part: Omit<AssemblyGeneratedModel, 'kind'>): this {
        return this.add({ ...part, kind: 'generated' });
    }
}
