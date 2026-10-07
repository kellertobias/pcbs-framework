import { loadProjectBranding } from './ProjectBranding';
import {
    SchematicOptions,
    PlacementAlgorithm,
    CircuitSnapshot,
    SchematicConnectionStyle,
    SchematicPaperSize,
    PcbOptions,
} from '@tobisk/pcbs/types';
import { registry } from '@tobisk/pcbs/Registry';
import { Component } from '@tobisk/pcbs/Component';
import { Composable } from './Composable';
import { Net } from '@tobisk/pcbs/Net';
import { RoutedComposable } from './RoutedComposable';
import { loadRoutingFile } from '../kicad/RoutingFile';
import type { BoardReference, BoardPlacement } from './BoardReference';
import { GravityLayout } from './Layout';
import { circuitNetClasses } from './NetClasses';
import type { SchematicGroupOptions } from './SchematicGroup';
import type { SchematicGroup as GroupDefinition } from './types';

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
    readonly projectName?: string;
    readonly branding: NonNullable<SchematicOptions['branding']>;
    readonly schematicRevision: number;
    readonly company: string;
    readonly name: string;
    readonly size: SchematicPaperSize;
    readonly connectionStyle: SchematicConnectionStyle;
    readonly schematicRouting?: SchematicOptions['schematicRouting'];
    readonly autoPack: boolean;
    readonly author: string;
    readonly revision: string;
    readonly description?: string;
    readonly pcb?: PcbOptions;
    readonly netClasses: NonNullable<SchematicOptions['netClasses']>;
    readonly moduleInterface?: import('./BoardModule').BoardModuleInterface;
    private _layout?: import('./Layout').Layout;
    private _placementAlgorithm?: PlacementAlgorithm;
    private _capturedComponents: readonly Component<any>[] = [];

    private _boards: BoardReference[] = [];
    private _capturing = false;
    private _schematicGroups: GroupDefinition[] = [];

    /** @internal Used by schematicGroup; capture is scoped to this generation. */
    _captureSchematicGroup(options: SchematicGroupOptions, build: () => unknown): unknown {
        if (!this._capturing) throw new Error('schematicGroup methods must run inside generate()');
        if (this._schematicGroups.some((group) => group.id === options.id))
            throw new Error(`Duplicate schematic group '${options.id}'`);
        const before = new Set(registry.getComponents());
        // Reserve the group before nested decorated calls, which claim their own components.
        const { nodes = [], ...definition } = options;
        const group: GroupDefinition = { ...definition, components: [] };
        this._schematicGroups.push(group);
        const result = build();
        if (result && typeof (result as { then?: unknown }).then === 'function')
            throw new Error('schematicGroup methods must be synchronous');
        const claimed = new Set(
            this._schematicGroups
                .filter((item) => item !== group)
                .flatMap((item) => item.components.map((node) => node.split('/')[0])),
        );
        const explicit = new Set(nodes.map((node) => node.split('/')[0]));
        group.components = [
            ...new Set([
                ...registry
                    .getComponents()
                    .filter(
                        (component) =>
                            component.symbol !== 'Device:DNC' &&
                            !before.has(component) &&
                            !claimed.has(component.ref) &&
                            !explicit.has(component.ref),
                    )
                    .map((component) => component.ref),
                ...nodes,
            ]),
        ];
        return result;
    }

    /** Place an independent board on this schematic's panel, in PCB millimetres. */
    addBoard(schematic: Schematic, placement: BoardPlacement): void {
        if (!this._capturing) throw new Error('addBoard must be called inside generate()');
        if (!placement.id || !/^[A-Za-z0-9_-]+$/.test(placement.id))
            throw new Error('Board id must contain only letters, numbers, underscores or hyphens');
        if (this._boards.some((board) => board.id === placement.id))
            throw new Error(`Duplicate board id '${placement.id}'`);
        for (const value of [
            placement.x,
            placement.y,
            placement.rotation ?? 0,
            placement.origin?.x ?? 0,
            placement.origin?.y ?? 0,
        ]) {
            if (!Number.isFinite(value))
                throw new Error('Board placement must use finite coordinates');
        }
        const capture = schematic._generateWithCapture();
        const snapshot = placement.sourceDirectory
            ? loadRoutingFile(capture, placement.sourceDirectory)
            : capture;
        this._boards.push({
            ...placement,
            snapshot,
        });
    }

    /** Select a component from this schematic's most recent circuit capture. */
    getComponent(ref: string): Component<any> {
        const matches = this._capturedComponents.filter((component) => component.ref === ref);
        if (matches.length !== 1)
            throw new Error(
                `${this.name}: expected one generated component '${ref}', found ${matches.length}`,
            );
        return matches[0];
    }

    constructor(options: SchematicOptions) {
        this.projectName = options.projectName;
        this.branding = { ...loadProjectBranding(), ...options.branding };
        this.schematicRevision = options.schematicRevision ?? 1;
        this.name = options.name;
        this.size = options.size ?? 'A4';
        this.connectionStyle = options.connectionStyle ?? 'stub-labels';
        this.schematicRouting = options.schematicRouting;
        this.autoPack = options.autoPack ?? false;
        this.author = options.author ?? '';
        this.revision = options.revision ?? 'v1.0';
        this.company = options.company ?? this.branding.company ?? 'Generated by @tobisk/pcbs';
        this.description = options.description;
        this.pcb = options.pcb;
        this.netClasses = options.netClasses ?? [];
        this.moduleInterface = options.moduleInterface;
        this._layout = options.layout;
        this._placementAlgorithm = options.placementAlgorithm;
    }

    /** Generate the circuit — define all nets, components, and connections. */
    abstract generate(): void;

    /** @internal Generate and capture registered objects */
    _generateWithCapture(): CircuitSnapshot {
        if (this._capturing) throw new Error(`Cyclic schematic reference: ${this.name}`);
        this._capturing = true;
        const context = [
            Composable.activeComposable,
            Component.activeGroup,
            Component.activeSubschematic,
        ] as const;
        Composable.activeComposable = undefined;
        Component.activeGroup = undefined;
        Component.activeSubschematic = undefined;
        try {
            return registry.isolated(() => this._captureCircuit());
        } finally {
            this._capturing = false;
            [Composable.activeComposable, Component.activeGroup, Component.activeSubschematic] =
                context;
        }
    }

    private _captureCircuit(): CircuitSnapshot {
        this._boards = [];
        this._schematicGroups = [];
        this._capturedComponents = [];
        registry.start();
        try {
            this.generate();
            // Reading the interface constructs even modules with no external connections.
            for (const item of registry.getComposables()) {
                if (item instanceof RoutedComposable) item.pins;
            }

            const topLevelItems = registry.getItems().filter((c: any) => !c.parent);

            if (this._layout) {
                this._layout.apply(topLevelItems);
            } else {
                // Auto-layout trigger if any item is unpositioned
                const unpositioned = topLevelItems.filter((i: any) => !i.schematicPosition);
                if (unpositioned.length > 0) {
                    new GravityLayout().apply(topLevelItems);
                }
            }
        } finally {
            registry.stop();
        }
        const moduleRouting = registry
            .getComposables()
            .filter((item): item is RoutedComposable => item instanceof RoutedComposable)
            .map((item) => item._pcbRouting());
        this._capturedComponents = [...registry.getComponents()];
        const firstBoardPcb = this._boards[0]?.snapshot.pcb;
        const basePcb =
            this.pcb ??
            (this._boards.length
                ? {
                      thickness: firstBoardPcb?.thickness,
                      stackup: firstBoardPcb?.stackup,
                  }
                : undefined);
        const pcb = basePcb && {
            ...basePcb,
            exactRoutes: [
                ...(basePcb.exactRoutes ?? []),
                ...moduleRouting.flatMap((item) => item.routes),
            ],
            handoffs: [
                ...(basePcb.handoffs ?? []),
                ...moduleRouting.flatMap((item) => item.handoffs),
            ],
            zones: [...(basePcb.zones ?? []), ...moduleRouting.flatMap((item) => item.zones)],
            netClasses: [
                ...circuitNetClasses(this.netClasses, registry.getNets()),
                ...moduleRouting.flatMap((item) => item.netClasses),
                ...this._boards.flatMap((board) =>
                    (board.snapshot.pcb?.netClasses ?? []).map((netClass) => ({
                        ...netClass,
                        name: `${board.id}/${netClass.name}`,
                        nets: [
                            ...new Set([
                                ...(netClass.nets ?? []),
                                ...board.snapshot.nets
                                    .filter((net) => net.class === netClass.name)
                                    .map((net) => net.name),
                            ]),
                        ].map((net) => `${board.id}/${net}`),
                    })),
                ),
                ...(basePcb.netClasses ?? []),
            ],
            designRules: Object.assign(
                {},
                ...moduleRouting.map((item) => item.designRules),
                basePcb.designRules,
            ),
        };
        return {
            boards: [...this._boards],
            name: this.name,
            projectName: this.projectName,
            branding: this.branding,
            schematicRevision: this.schematicRevision,
            size: this.size,
            connectionStyle: this.connectionStyle,
            schematicRouting: this._schematicGroups.length
                ? {
                      ...this.schematicRouting,
                      autoLayout: {
                          ...this.schematicRouting?.autoLayout,
                          groups: [
                              ...(this.schematicRouting?.autoLayout?.groups ?? []),
                              ...this._schematicGroups,
                          ],
                      },
                  }
                : this.schematicRouting,
            autoPack: this.autoPack,
            author: this.author,
            revision: this.revision,
            company: this.company,
            description: this.description,
            components: registry.getComponents(),
            nets: registry.getNets(),
            placementAlgorithm: this._placementAlgorithm,
            pcb,
        };
    }
}
