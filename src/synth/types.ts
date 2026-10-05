import type { VerticalFrontPanelInterface } from '../frontpanel/types';
import { Component } from './Component';
import { Net } from './Net';
import { KicadLibrarySymbol, KicadLibraryFootprint } from '@tobisk/pcbs/kicad-types';

export type SymbolName = KicadLibrarySymbol | `Composable:${string}` | `Project_Symbols:${string}`;
export type FootprintName =
    | `Board_Modules:${string}`
    | KicadLibraryFootprint
    | `MountingHole:${string}`
    | `Composable:${string}`
    | `Project_Footprints:${string}`;

/** Represents a reference to a physical component pin */
export class Pin {
    /** The component this pin belongs to */
    readonly component: { ref: string; symbol: SymbolName };
    /** The pin name (number or string) */
    readonly name: string;
    /** The net this pin is connected to, if any */
    private _net: import('./Net').Net | null = null;
    /** Whether this pin has been explicitly marked as Do Not Connect */
    private _isDNC: boolean = false;

    constructor(component: { ref: string; symbol: SymbolName }, name: string) {
        this.component = component;
        this.name = name;
    }

    get net(): import('./Net').Net | null {
        return this._net;
    }

    get isDNC(): boolean {
        return this._isDNC;
    }

    /** @internal */
    _setNet(net: import('./Net').Net): void {
        // If already connected to a different net, we'll allow the override.
        // The Net class is responsible for ensuring consistency during merges.
        this._net = net;
    }

    /**
     * Explicitly marks this pin as Do Not Connect (DNC).
     * @param reason Optional description for why it is not connected
     */
    dnc(reason?: string): this {
        if (this._isDNC) return this;

        const dnc = new Component({
            symbol: 'Device:DNC',
            ref: `DNC_${this.component.ref}_${this.name}`,
            footprint: 'DNC',
            description: reason || 'Implicit DNC',
        });
        const ret = this.tie(dnc.pins[1]);
        this._isDNC = true;
        return ret;
    }

    /**
     * Connects this pin to one or more targets (other pins, nets, null).
     */
    tie(...targets: PinAssignable[]): this {
        if (this._isDNC && targets.length > 0) {
            throw new Error(
                `Cannot connect to Pin ${this.component.ref}.${this.name} because it is marked as Do Not Connect (DNC)`,
            );
        }

        for (let target of targets) {
            if (target === null || target === undefined) {
                this.dnc();
                continue;
            }

            if (target instanceof Component && (target as any).symbol === 'Device:DNC') {
                this.tie((target as any).pins[1]);
                this._isDNC = true;
                continue;
            }

            if (target instanceof Component && (target as any).symbol === 'Connector:TestPoint') {
                this.tie((target as any).pins[1]);
                continue;
            }

            if (
                target instanceof Net ||
                (target && target.constructor && target.constructor.name === 'Net')
            ) {
                (target as any).tie(this);
            } else if (
                target instanceof Pin ||
                (target && target.constructor && target.constructor.name === 'Pin')
            ) {
                const otherPin = target as Pin;
                if (otherPin.net) {
                    otherPin.net.tie(this);
                } else if (this.net) {
                    this.net.tie(otherPin);
                } else {
                    const implicit = new Net({
                        name: `${otherPin.component.ref}_${otherPin.name}__${this.component.ref}_${this.name}`,
                    });
                    implicit.tie(otherPin);
                    implicit.tie(this);
                }
            }
        }
        return this;
    }
}

/** Net class categories */
export type NetClass = 'Power' | 'Signal' | 'Data' | string;

/** Schematic position info */
export interface SchematicPosition {
    x: number;
    y: number;
    rotation?: number;
}

/** PCB position info */
export interface PcbPosition {
    x: number;
    y: number;
    rotation?: number;
    side?: 'front' | 'back';
}

/** A point on the PCB outline, in millimetres. */
export interface PcbPoint {
    x: number;
    y: number;
}

export interface PcbLineEdge {
    kind: 'line';
    start: PcbPoint;
    end: PcbPoint;
    /** Stable identity within the containing contour. */
    id?: string;
}

export interface PcbArcEdge {
    kind: 'arc';
    start: PcbPoint;
    mid: PcbPoint;
    end: PcbPoint;
    /** Stable identity within the containing contour. */
    id?: string;
}

export type PcbEdge = PcbLineEdge | PcbArcEdge;

export interface PcbContour {
    /** Stable TypeScript ownership identity. */
    id: string;
    /** Closed straight polygon. Mutually exclusive with edges. */
    points?: PcbPoint[];
    /** Explicit line/arc chain. The chain must form a closed contour. */
    edges?: PcbEdge[];
}

export interface PcbRoutedSlot {
    id: string;
    start: PcbPoint;
    end: PcbPoint;
    width: number;
}

export interface PcbMountingHole {
    id: string;
    at: PcbPoint;
    drill: number;
    /** Annular diameter for a plated hole. Omit for an NPTH mechanical hole. */
    diameter?: number;
    plated?: boolean;
}

export interface PcbMechanicalKeepout {
    id: string;
    points: PcbPoint[];
    layers?: Array<'F.Cu' | 'B.Cu'>;
    tracks?: boolean;
    vias?: boolean;
    pads?: boolean;
    copperPour?: boolean;
    footprints?: boolean;
}

export interface PcbStackup {
    copperThickness?: number;
    solderMaskThickness?: number;
    dielectricMaterial?: string;
    dielectricEpsilonR?: number;
    dielectricLossTangent?: number;
    copperFinish?: string;
    solderMaskColor?: string;
}

export interface PcbLengthTarget {
    min?: number;
    max?: number;
    target?: number;
    tolerance?: number;
}

export interface PcbNetClass {
    name: string;
    /** Explicit net names. Nets whose Net.class matches name are assigned automatically too. */
    nets?: string[];
    width: number;
    clearance: number;
    viaDiameter?: number;
    viaDrill?: number;
    microviaDiameter?: number;
    microviaDrill?: number;
    diffPairWidth?: number;
    diffPairGap?: number;
    diffPairViaGap?: number;
    preferredLayers?: Array<'F.Cu' | 'B.Cu'>;
    length?: PcbLengthTarget;
}

export interface PcbCopperZone {
    id: string;
    net: string;
    layer: 'F.Cu' | 'B.Cu';
    /** Explicit polygon. Mutually exclusive with boardInset. */
    points?: PcbPoint[];
    /** Bounding-board inset in millimetres. The zone is clipped by KiCad to the actual board contour. */
    boardInset?: number;
    clearance?: number;
    minThickness?: number;
    thermalGap?: number;
    thermalBridgeWidth?: number;
    padConnection?: 'thermal' | 'solid';
    priority?: number;
    removeIslands?: 'always' | 'never';
}

export interface PcbPadReference {
    ref: string;
    pad: string;
}

export interface PcbHandoffReference {
    module: string;
    port: string;
}

export interface PcbHandoff {
    module: string;
    port: string;
    net: string;
    at: PcbPoint;
    layer: 'F.Cu' | 'B.Cu';
}

export type PcbRoutePoint = PcbPoint | PcbPadReference | PcbHandoffReference;

export interface PcbRouteHint {
    id: string;
    nets: string[];
    preferredLayers?: Array<'F.Cu' | 'B.Cu'>;
    corridors?: PcbPoint[][];
    waypoints?: PcbPoint[];
    /** Copper layer of explicit waypoint trunks (grid backend). */
    waypointLayer?: 'F.Cu' | 'B.Cu';
    /** Route zone-net pads as well as pouring copper; guarantees explicit links. */
    routeZonePads?: boolean;
    forbiddenRegions?: PcbPoint[][];
    maxVias?: number;
    topology?: 'point-to-point' | 'daisy-chain' | 'star';
    length?: PcbLengthTarget;
    differential?: {
        positive: string;
        negative: string;
        gap?: number;
        maxSkew?: number;
    };
}

export interface PcbExactSegment {
    /** Original KiCad identity when copper was captured from a board. */
    uuid?: string;
    id?: string;
    start: PcbRoutePoint;
    end: PcbRoutePoint;
    layer: 'F.Cu' | 'B.Cu';
    width?: number;
}

export interface PcbExactArc {
    /** Original KiCad identity when copper was captured from a board. */
    uuid?: string;
    id?: string;
    start: PcbRoutePoint;
    mid: PcbPoint;
    end: PcbRoutePoint;
    layer: 'F.Cu' | 'B.Cu';
    width?: number;
}

export interface PcbExactVia {
    /** Original KiCad identity when copper was captured from a board. */
    uuid?: string;
    id?: string;
    at: PcbRoutePoint;
    fromLayer?: 'F.Cu' | 'B.Cu';
    toLayer?: 'F.Cu' | 'B.Cu';
    diameter?: number;
    drill?: number;
}

export interface PcbExactRoute {
    id: string;
    net: string;
    width?: number;
    segments?: PcbExactSegment[];
    arcs?: PcbExactArc[];
    vias?: PcbExactVia[];
}

/** PCB generation options. Only explicitly positioned footprints are emitted. */
export interface PcbFiducial {
    id: string;
    at: PcbPoint;
    diameter?: number;
    maskDiameter?: number;
    side?: 'front' | 'back';
}

export interface PcbOptions {
    /** Direct manufacturing alignment marks; excluded from component BOM/CPL. */
    fiducials?: PcbFiducial[];
    /** KiCad board capability limits. These are checked against the actual copper. */
    designRules?: Partial<
        Record<
            | 'min_clearance'
            | 'min_copper_edge_clearance'
            | 'min_track_width'
            | 'min_via_diameter'
            | 'min_through_hole_diameter'
            | 'min_hole_clearance'
            | 'min_hole_to_hole'
            | 'min_silk_text_height',
            number
        >
    >;
    /** Persistent copper file, relative to the board output directory. Defaults to routing.json when present. */
    routingFile?: string;
    /** Reject omitted/unresolved physical components instead of emitting a partial board. */
    requireAllPlaced?: boolean;
    /** Replace declared footprint geometry from the current library during sync. */
    refreshFootprints?: boolean;
    /** Resolved module interfaces, normally populated by RoutedComposable. */
    handoffs?: PcbHandoff[];
    /** Legacy outer polygon. Prefer contours for new boards. */
    outline?: PcbPoint[];
    /** One or more closed outer board contours with straight and/or arc edges. */
    contours?: PcbContour[];
    /** Closed internal Edge.Cuts contours. */
    cutouts?: PcbContour[];
    /** Capsule-shaped routed slots emitted directly on Edge.Cuts. */
    slots?: PcbRoutedSlot[];
    /** Direct mechanical holes; no custom footprint class is required. */
    mountingHoles?: PcbMountingHole[];
    /** Direct copper/mechanical keepout zones. */
    keepouts?: PcbMechanicalKeepout[];
    /** Finished board thickness in millimetres. Defaults to 1.6. */
    thickness?: number;
    /** Optional two-layer fabrication stack-up metadata. */
    stackup?: PcbStackup;
    /** Named KiCad net classes and optional custom routing constraints. */
    netClasses?: PcbNetClass[];
    /** Managed copper-zone outlines. Filled polygon caches are intentionally not generated. */
    zones?: PcbCopperZone[];
    /** Non-copper constraints consumed by routing backends. */
    routeHints?: PcbRouteHint[];
    /** Opt-in, framework-owned exact copper for critical nets. */
    exactRoutes?: PcbExactRoute[];
    /** Edge.Cuts line width in millimetres. Defaults to 0.05. */
    outlineLineWidth?: number;
    /** Optional reference globs limiting which positioned components are emitted (for example, ["SW*", "J1"]). */
    place?: string[];
}

/** Common interface for items that can be positioned in a layout */
export interface LayoutItem {
    schematicPosition?: SchematicPosition | null;
    readonly ref: string;
}

/** Interface for layout algorithms */
export interface ILayout {
    apply(items: LayoutItem[]): void;
}

/** Placement algorithms supported by circuit-synth */
export type PlacementAlgorithm = 'hierarchical' | 'force_directed' | 'linear' | 'none';

/** How assigned pins are represented in the generated KiCad schematic. */
export type SchematicConnectionStyle = 'stub-labels' | 'direct-labels' | 'routed';

export interface SchematicRouteHint {
    id: string;
    nets: string[];
    /** Required support points, in sheet millimetres and traversal order. */
    waypoints: PcbPoint[];
}
export interface SchematicRoutingOptions {
    /** Hide redundant drawing values (e.g. generic connector/test-point symbol names). */
    hideValues?: string[];
    /** Drawing-only symbol definitions. Electrical pin numbers must remain unchanged. */
    symbolOverrides?: Record<string, import('./KicadSymbol').KicadSymbol>;
    /** Sheet headings or explanatory notes, in millimetres. */
    annotations?: Array<{ text: string; x: number; y: number; size?: number }>;
    /** External connector references. Wire the remaining circuit; label only its interface nets. */
    interfaceComponents?: string[];
    /** Native power glyphs, keyed by circuit net name. The net name remains unchanged. */
    powerSymbols?: Record<string, string>;
    /** Short local supply branches; remaining supply pins receive individual power symbols. */
    powerGroups?: Array<{ net: string; pins: string[] }>;
    /** Reserved space outside symbol bodies, in millimetres. */
    symbolClearance?: number;
    /** Straight lead length before a signal wire may turn, in millimetres. */
    pinEscape?: number;
    /** Hard parallel wire separation, in millimetres. Defaults to 2 on A4/A3. */
    wireClearance?: number;
    routeHints?: SchematicRouteHint[];
}

/** Paper sizes supported by KiCad's schematic file format. */
export type SchematicPaperSize =
    | 'A0'
    | 'A1'
    | 'A2'
    | 'A3'
    | 'A4'
    | 'A5'
    | 'A'
    | 'B'
    | 'C'
    | 'D'
    | 'E';

/** Options for Net constructor */
export interface NetOptions {
    name: string;
    class?: NetClass;
}

/** Dated component-only supplier quote. Assembly, shipping and taxes are excluded. */
export interface ComponentCost {
    /** Unit price at basisQuantity, expressed in currency (never cents). */
    unitPrice: number;
    currency: string;
    supplier: string;
    basisQuantity: number;
    checkedAt: string;
    sourceUrl: string;
    assemblyClass?: 'Basic' | 'Extended' | 'Unknown';
    /** Minimum purchased quantity of this part number for each price tier. */
    priceBreaks?: readonly { quantity: number; unitPrice: number }[];
}

/** Options for Component constructor (without pin mapping) */
export interface ComponentOptions {
    /** Short function label on PCB silkscreen, independently of the BOM reference. */
    pcbLabel?: string;
    symbol: SymbolName;
    ref: string;
    footprint: FootprintName;
    description?: string;
    partNo?: string;
    cost?: ComponentCost;
    value?: string;
    pos?: { x: number; y: number; r?: number };
    schematicPosition?: SchematicPosition | null;
    pcbPosition?: PcbPosition;
    /** Optional operator-facing text emitted at the footprint's front-panel label anchor. */
    frontPanelLabel?: string;
    /** Smaller alternate action below the primary 3D key legend. */
    frontPanelSecondaryLabel?: string;
    /** Number of horizontal bars in the keycap bottom marking area (1 to 3). */
    keycapBottomBars?: number;
    /** Optional instance override for the footprint-defined vertical connector face. */
    verticalFrontPanelInterface?: VerticalFrontPanelInterface;
    /** Connector face in footprint-local 3D coordinates. */
    frontPanelInterface?: VerticalFrontPanelInterface;
    /** Group assignment for layout clustering */
    group?: string;
    /** Subschematic page assignment */
    subschematic?: string;
    /** Explicit parent override */
    parent?: any;
}

/** Options for Composable constructor */
export interface ComposableOptions {
    /** Preserve module-authored relative schematic geometry. */
    schematicLayoutFixed?: boolean;
    /** Suppress long internal reference text on copper-dense module silkscreen. */
    pcbHideReferences?: boolean;
    /** Wire module internals and label only nets crossing its boundary. */
    schematicConnectionStyle?: 'routed-interface';
    ref: string;
    description?: string;
    pos?: { x: number; y: number; r?: number };
    schematicPosition?: SchematicPosition | null;
    pcbPosition?: PcbPosition;
    /** Passed through by reusable footprint modules for front-panel marking text. */
    frontPanelLabel?: string;
    /** Smaller alternate action below the primary 3D key legend. */
    frontPanelSecondaryLabel?: string;
    /** Number of horizontal bars in the keycap bottom marking area (1 to 3). */
    keycapBottomBars?: number;
    /** Optional instance override for the footprint-defined vertical connector face. */
    verticalFrontPanelInterface?: VerticalFrontPanelInterface;
    /** Connector face in footprint-local 3D coordinates. */
    frontPanelInterface?: VerticalFrontPanelInterface;
    /** Optional layout to apply to internal components */
    layout?: ILayout;
}

/** Options for Module constructor (extends Component) */
export interface ModuleOptions<PinNames> extends ComponentOptions {
    pins?: PinMapFn<PinNames & string>;
}

/** Options for Schematic constructor */
export interface SchematicOptions {
    /** Physical contacts exported when this board is used as a module. */
    moduleInterface?: import('./BoardModule').BoardModuleInterface;
    name: string;
    /** Optional layout to apply to top-level components */
    layout?: ILayout;
    /** The algorithm used by circuit-synth for automatic placement. Defaults to "hierarchical". */
    placementAlgorithm?: PlacementAlgorithm;
    /** Size of the schematic (default: "A4") */
    size?: SchematicPaperSize;
    /**
     * Render short wire stubs with labels, or attach global labels directly to
     * pins. Direct labels are robust for very large, densely connected designs.
     */
    connectionStyle?: SchematicConnectionStyle;
    /** Enable libavoid wire routing with optional required support points. */
    schematicRouting?: SchematicRoutingOptions;
    /** Deterministically pack all symbols onto the selected sheet after layout. */
    autoPack?: boolean;
    /** Author of the schematic */
    author?: string;
    /** Revision of the schematic (default: "v1.0") */
    revision?: string;
    /** Description of the schematic */
    description?: string;
    /** Company of the schematic */
    company?: string;
    /** Optional PCB outline and partial footprint-placement definition. */
    pcb?: PcbOptions;
}

/**
 * A function that maps numbered pins to named pins.
 * Receives a `pin(n)` helper that returns the Pin for pin number `n`.
 * Returns a record mapping name → Pin.
 */
export type PinMapFn<P extends string> = (pin: (n: string | number) => Pin) => Record<P, Pin>;

/**
 * Proxy type for pin access on Component/Composable.
 *
 * - getter: `component.pins.X` returns `Pin` at runtime
 * - setter: Intentionally restricted. Use `.tie(target)` to connect pins.
 *   This avoids confusing overwrites.
 */
export type PinAssignable = Pin | Net | import('./Markers').DNC | import('./Markers').TP | null;

export type PinProxy<T extends string | number> = {
    readonly [K in T]: Pin;
} & {
    assign(map: Partial<Record<T, PinAssignable>>): void;
};

/** A snapshot of the circuit state needed for codegen/synthesis. */
export interface CircuitSnapshot {
    /** Independent boards placed on a panel; never merged into the parent circuit. */
    boards?: import('./BoardReference').BoardReference[];
    name: string;
    size?: SchematicPaperSize;
    connectionStyle?: SchematicConnectionStyle;
    /** Enable libavoid wire routing with optional required support points. */
    schematicRouting?: SchematicRoutingOptions;
    autoPack?: boolean;
    author?: string;
    revision?: string;
    description?: string;
    company?: string;
    components: Component<any>[];
    nets: Net[];
    placementAlgorithm?: PlacementAlgorithm;
    pcb?: PcbOptions;
}
