import { CircuitSnapshot, PcbExactRoute, PcbNetClass, PcbRouteHint } from '../synth/types';

export interface RouterPad {
    ref: string;
    pad: string;
    net: string;
    at: { x: number; y: number };
}

export interface RoutingBackendRequest {
    snapshot: CircuitSnapshot;
    /** Original KiCad source supplied for backends that use an interchange format. */
    boardSource: string;
    padsByNet: ReadonlyMap<string, readonly RouterPad[]>;
    eligibleNets: readonly string[];
    existingCopperNets: ReadonlySet<string>;
    lockedNets: ReadonlySet<string>;
    rerouteNets: ReadonlySet<string>;
    routeHints: readonly PcbRouteHint[];
    netClasses: readonly PcbNetClass[];
}

export interface BackendNetResult {
    net: string;
    route?: PcbExactRoute;
    reason?: string;
    constraintViolations?: string[];
}

export interface RoutingBackendResult {
    completed: BackendNetResult[];
    skipped: BackendNetResult[];
    failed: BackendNetResult[];
}

export interface RoutingBackend {
    readonly id: string;
    route(request: RoutingBackendRequest): RoutingBackendResult;
}

export interface IncrementalRoutingOptions {
    /** Include every unrouted board net, even without a hint. */
    routeAll?: boolean;
    backend?: RoutingBackend;
    /** Existing copper may only be replaced for explicitly selected nets. */
    rerouteNets?: string[];
    /** Run kicad-cli DRC after routing when available. Defaults to true. */
    runDrc?: boolean;
}

export interface RoutingReportEntry {
    net: string;
    reason: string;
}

export interface RoutingDrcReport {
    status: 'passed' | 'violations' | 'unavailable' | 'failed' | 'not-run';
    reportPath?: string;
    details?: string;
}

export interface RoutingReport {
    backend: string;
    boardPath: string;
    backupPath?: string;
    rerouteNets: string[];
    completed: RoutingReportEntry[];
    skipped: RoutingReportEntry[];
    failed: RoutingReportEntry[];
    constraintViolating: RoutingReportEntry[];
    preservedManualCopper: { segments: number; arcs: number; vias: number };
    drc: RoutingDrcReport;
    fabricationReady: false;
    humanReviewRequired: true;
}
