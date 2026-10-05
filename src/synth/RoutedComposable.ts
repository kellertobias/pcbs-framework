import { transformPcbPoint } from './PcbPosition';
import { Composable } from './Composable';
import { Net } from './Net';
import {
    Pin,
    PcbExactRoute,
    PcbPoint,
    PcbPosition,
    PcbRoutePoint,
    PcbHandoff,
    PcbCopperZone,
    PcbOptions,
    PcbNetClass,
} from './types';

export type ModuleRoute = Omit<PcbExactRoute, 'net'> & { net: Pin | Net };
export interface ModuleRouting<Ports extends string> {
    routes: ModuleRoute[];
    zones?: (Omit<PcbCopperZone, 'net'> & { net: Pin | Net })[];
    designRules?: PcbOptions['designRules'];
    netClasses?: (Omit<PcbNetClass, 'nets'> & { nets: (Pin | Net)[] })[];
    handoffs: Record<Ports, { at: PcbPoint; layer: 'F.Cu' | 'B.Cu' }>;
}

/** Reusable circuit whose child placements and copper live in a local coordinate frame. */
export abstract class RoutedComposable<Ports extends string = string> extends Composable<Ports> {
    readonly pcbLocalCoordinates = true;

    protected abstract defineRouting(): ModuleRouting<Ports>;

    override get absolutePcbPosition(): PcbPosition {
        const local = this.pcbPosition ?? { x: 0, y: 0 };
        if (!this.parent) return { ...local, side: local.side ?? 'front' };
        const origin = this.parent.absolutePcbPosition;
        return {
            ...transformPcbPoint(local, origin),
            rotation:
                (origin.rotation ?? 0) + (origin.side === 'back' ? -1 : 1) * (local.rotation ?? 0),
            side: local.side ?? origin.side,
        };
    }

    /** @internal Resolve after the whole circuit is connected, so merged nets retain their final names. */
    _pcbRouting(): {
        routes: PcbExactRoute[];
        handoffs: PcbHandoff[];
        zones: PcbCopperZone[];
        designRules?: PcbOptions['designRules'];
        netClasses: PcbNetClass[];
    } {
        this.pins;
        let placed: Composable<any> | undefined = this;
        while (placed && !placed.pcbPosition) placed = placed.parent;
        if (!placed) return { routes: [], handoffs: [], zones: [], netClasses: [] };
        const definition = this.defineRouting();
        const origin = this.absolutePcbPosition;
        const point = (value: PcbRoutePoint): PcbRoutePoint =>
            'x' in value ? transformPcbPoint(value, origin) : value;
        const layer = (value: 'F.Cu' | 'B.Cu') =>
            origin.side === 'back' ? (value === 'F.Cu' ? 'B.Cu' : 'F.Cu') : value;
        const routes = definition.routes.map((route): PcbExactRoute => {
            const net =
                route.net instanceof Pin
                    ? route.net.net
                    : ([...route.net.pins][0]?.net ?? route.net);
            if (!net)
                throw new Error(
                    `Module '${this.ref}' route '${route.id}' is not connected to a net.`,
                );
            return {
                ...route,
                id: `${this.ref}/${route.id}`,
                net: net.name,
                segments: route.segments?.map((item) => ({
                    ...item,
                    start: point(item.start),
                    end: point(item.end),
                    layer: layer(item.layer),
                })),
                arcs: route.arcs?.map((item) => ({
                    ...item,
                    start: point(item.start),
                    mid: transformPcbPoint(item.mid, origin),
                    end: point(item.end),
                    layer: layer(item.layer),
                })),
                vias: route.vias?.map((item) => ({
                    ...item,
                    at: point(item.at),
                    fromLayer: layer(item.fromLayer ?? 'F.Cu'),
                    toLayer: layer(item.toLayer ?? 'B.Cu'),
                })),
            };
        });
        const handoffs = Object.entries(definition.handoffs).map(([port, raw]): PcbHandoff => {
            const value = raw as { at: PcbPoint; layer: 'F.Cu' | 'B.Cu' };
            const net = this.allPins.get(port)?.net;
            if (!net)
                throw new Error(
                    `Module '${this.ref}' handoff '${port}' has no connected interface net.`,
                );
            return {
                module: this.ref,
                port,
                net: net.name,
                at: transformPcbPoint(value.at, origin),
                layer: layer(value.layer),
            };
        });
        for (const port of this.allPins.keys()) {
            if (!handoffs.some((handoff) => handoff.port === port))
                throw new Error(`Module '${this.ref}' is missing handoff '${port}'.`);
        }
        const zones = (definition.zones ?? []).map((zone) => {
            const net =
                zone.net instanceof Pin ? zone.net.net : ([...zone.net.pins][0]?.net ?? zone.net);
            if (!net) throw new Error(`Module '${this.ref}' zone '${zone.id}' has no net.`);
            if (!zone.points)
                throw new Error(`Module '${this.ref}' zone '${zone.id}' requires a local polygon.`);
            return {
                ...zone,
                id: `${this.ref}/${zone.id}`,
                net: net.name,
                layer: layer(zone.layer),
                points: zone.points.map((p) => transformPcbPoint(p, origin)),
            };
        });
        const netClasses = (definition.netClasses ?? []).map((rule) => ({
            ...rule,
            name: `${this.ref}/${rule.name}`,
            nets: [
                ...new Set(
                    rule.nets.map((value) => {
                        const net =
                            value instanceof Pin ? value.net : ([...value.pins][0]?.net ?? value);
                        if (!net)
                            throw new Error(
                                `Module '${this.ref}' net class '${rule.name}' has an unconnected net.`,
                            );
                        return net.name;
                    }),
                ),
            ],
        }));
        return { routes, handoffs, zones, netClasses, designRules: definition.designRules };
    }
}
