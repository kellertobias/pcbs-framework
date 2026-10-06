import { writeKeycapLegend } from '../synth/3d/KeycapLegend';
import { BoardModule } from '../synth/BoardModule';
import { appendBoard, boardRoot, removeBoardOutline } from './BoardComposition';
import * as fs from 'fs';
import * as path from 'path';
import {
    CircuitSnapshot,
    PcbContour,
    PcbCopperZone,
    PcbExactRoute,
    PcbMechanicalKeepout,
    PcbMountingHole,
    PcbFiducial,
    PcbOptions,
    PcbPadReference,
    PcbPoint,
    PcbRoutePoint,
    PcbRoutedSlot,
} from '../synth/types';
import { Component } from '../synth/Component';
import { UuidManager } from './UuidManager';
import { SExpr, SExpressionParser } from './SExpressionParser';
import { KICAD_PCB_FILE_VERSION, KICAD_TARGET_VERSION } from './KicadFormat';

export interface PcbGenerationResult {
    content: string;
    placed: number;
    warnings: string[];
}

/** Generates an initial board containing the outline and explicitly positioned footprints. */
export class PcbGenerator {
    private readonly footprintSources = new Map<string, string>();
    constructor(
        private readonly snapshot: CircuitSnapshot,
        private readonly uuids: UuidManager,
        private readonly outputDir: string,
        private readonly footprintDirectory: string = outputDir,
    ) {}

    generate(): PcbGenerationResult {
        const pcb = this.snapshot.pcb;
        if (!pcb) throw new Error('Cannot generate a PCB without schematic pcb options.');
        this.validateGeometry(pcb);
        this.footprintSources.clear();

        const warnings: string[] = [];
        if (pcb.requireAllPlaced) {
            for (const component of this.snapshot.components) {
                if (!component.footprint || component.footprint === 'DNC') continue;
                if (!this.hasExplicitPcbPosition(component) || !this.isIncluded(component.ref))
                    throw new Error(
                        `Full placement requires a PCB position for '${component.ref}' and inclusion in pcb.place.`,
                    );
            }
        }
        const footprints: string[] = [];
        const placedComponents: { component: Component<any>; source: string }[] = [];
        for (const component of this.snapshot.components) {
            if (
                !component.footprint ||
                component.footprint === 'DNC' ||
                !this.hasExplicitPcbPosition(component) ||
                !this.isIncluded(component.ref)
            )
                continue;
            if (component instanceof BoardModule) {
                const footprintSource = component._generateBoardFootprint(this.outputDir);
                placedComponents.push({ component, source: footprintSource });
                this.footprintSources.set(component.ref, footprintSource);
                continue;
            }
            const source = this.resolveFootprint(component.footprint);
            if (!source) {
                if (pcb.requireAllPlaced)
                    throw new Error(
                        `Full placement cannot resolve footprint ${component.footprint} for ${component.ref}.`,
                    );
                warnings.push(
                    `Could not resolve footprint '${component.footprint}' for positioned component ${component.ref}; it was left for KiCad import.`,
                );
                continue;
            }
            const footprintSource = fs.readFileSync(source, 'utf-8');
            placedComponents.push({ component, source: footprintSource });
            this.footprintSources.set(component.ref, footprintSource);
        }

        const usedNetNames = new Set<string>();
        for (const { component } of placedComponents) {
            for (const pin of new Set(component.allPins.values())) {
                if (pin.net && !pin.isDNC) usedNetNames.add(pin.net.name);
            }
        }
        for (const zone of pcb.zones ?? []) usedNetNames.add(zone.net);
        for (const route of pcb.exactRoutes ?? []) usedNetNames.add(route.net);
        const netCodes = new Map<string, number>();
        [...usedNetNames].sort().forEach((name, index) => netCodes.set(name, index + 1));
        for (const { component, source } of placedComponents) {
            footprints.push(this.instantiateFootprint(component, source, netCodes, warnings));
        }

        const geometry = this.generateGeometry(pcb);
        const mountingHoles = (pcb.mountingHoles ?? []).map((hole) =>
            this.generateMountingHole(hole),
        );
        const fiducialIds = new Set<string>();
        const fiducials = (pcb.fiducials ?? []).map((fiducial) => {
            if (fiducialIds.has(fiducial.id)) throw new Error('Duplicate fiducial id');
            fiducialIds.add(fiducial.id);
            return this.generateFiducial(fiducial);
        });
        const keepouts = (pcb.keepouts ?? []).map((keepout) => this.generateKeepout(keepout));
        const zones = (pcb.zones ?? []).map((zone) => this.generateCopperZone(zone, pcb, netCodes));
        const exactRoutes = (pcb.exactRoutes ?? []).flatMap((route) =>
            this.generateExactRoute(route, netCodes, warnings),
        );
        this.validateDifferentialConstraints(pcb, warnings);

        const result = {
            content: `${this.header(pcb.thickness ?? 1.6, netCodes, pcb)}\n${footprints.join('\n')}\n${mountingHoles.join('\n')}\n${fiducials.join('\n')}\n${geometry.join('\n')}\n${keepouts.join('\n')}\n${zones.join('\n')}\n${exactRoutes.join('\n')}\n\t(embedded_fonts no)\n)\n`,
            placed: footprints.length + mountingHoles.length + fiducials.length,
            warnings,
        };
        if (this.snapshot.boards?.length) {
            const root = boardRoot(result.content);
            for (const board of this.snapshot.boards) {
                const generated = board.sourcePcb
                    ? {
                          content: fs.readFileSync(
                              path.resolve(
                                  board.sourceDirectory ?? this.outputDir,
                                  board.sourcePcb,
                              ),
                              'utf8',
                          ),
                          placed: board.snapshot.components.length,
                          warnings: [] as string[],
                      }
                    : new PcbGenerator(
                          board.snapshot,
                          this.uuids,
                          this.outputDir,
                          board.sourceDirectory ?? this.footprintDirectory,
                      ).generate();
                const source = boardRoot(generated.content);
                if (board.replaceOutline) removeBoardOutline(source, board.replaceOutline);
                appendBoard(root, source, board, this.uuids);
                result.placed += generated.placed;
                result.warnings.push(
                    ...generated.warnings.map((warning) => `${board.id}: ${warning}`),
                );
            }
            result.content = `${SExpressionParser.serialize(root)}\n`;
        }
        return result;
    }

    private validateGeometry(pcb: PcbOptions): void {
        const contours: PcbContour[] = [
            ...(pcb.outline ? [{ id: 'legacy-outline', points: pcb.outline }] : []),
            ...(pcb.contours ?? []),
            ...(pcb.cutouts ?? []),
        ];
        if (!(pcb.outline?.length || pcb.contours?.length || this.snapshot.boards?.length)) {
            throw new Error('PCB geometry requires an outline or at least one outer contour.');
        }
        const ids = new Set<string>();
        for (const contour of contours) {
            if (!contour.id || ids.has(contour.id))
                throw new Error(`PCB contour IDs must be non-empty and unique: '${contour.id}'.`);
            ids.add(contour.id);
            if (contour.points && contour.edges)
                throw new Error(
                    `PCB contour '${contour.id}' cannot declare both points and edges.`,
                );
            if (contour.points && contour.points.length < 3)
                throw new Error(`PCB contour '${contour.id}' requires at least three points.`);
            if (contour.edges && contour.edges.length < 2)
                throw new Error(`PCB contour '${contour.id}' requires at least two edges.`);
            if (!contour.points && !contour.edges)
                throw new Error(`PCB contour '${contour.id}' must declare points or edges.`);
            const points =
                contour.points ??
                contour.edges!.flatMap((edge) =>
                    edge.kind === 'arc' ? [edge.start, edge.mid, edge.end] : [edge.start, edge.end],
                );
            this.validatePoints(points, `PCB contour '${contour.id}'`);
        }
        for (const slot of pcb.slots ?? []) {
            this.validatePoints([slot.start, slot.end], `PCB slot '${slot.id}'`);
            if (!(slot.width > 0) || (slot.start.x === slot.end.x && slot.start.y === slot.end.y))
                throw new Error(
                    `PCB slot '${slot.id}' requires positive width and distinct endpoints.`,
                );
        }
        for (const hole of pcb.mountingHoles ?? []) {
            this.validatePoints([hole.at], `PCB mounting hole '${hole.id}'`);
            if (!(hole.drill > 0) || (hole.plated && !((hole.diameter ?? 0) > hole.drill))) {
                throw new Error(`PCB mounting hole '${hole.id}' has invalid drill/diameter.`);
            }
        }
        for (const keepout of pcb.keepouts ?? []) {
            if (keepout.points.length < 3)
                throw new Error(`PCB keepout '${keepout.id}' requires at least three points.`);
            this.validatePoints(keepout.points, `PCB keepout '${keepout.id}'`);
        }
        for (const zone of pcb.zones ?? []) {
            if (!zone.id || !zone.net)
                throw new Error('PCB copper zones require non-empty id and net values.');
            if (zone.points && zone.boardInset !== undefined)
                throw new Error(`PCB zone '${zone.id}' cannot declare both points and boardInset.`);
            if (!zone.points && zone.boardInset === undefined)
                throw new Error(`PCB zone '${zone.id}' requires points or boardInset.`);
            if (zone.points) {
                if (zone.points.length < 3)
                    throw new Error(`PCB zone '${zone.id}' requires at least three points.`);
                this.validatePoints(zone.points, `PCB zone '${zone.id}'`);
            }
            if (zone.boardInset !== undefined && zone.boardInset < 0)
                throw new Error(`PCB zone '${zone.id}' boardInset must be non-negative.`);
        }
        const knownNets = new Set(this.snapshot.nets.map((net) => net.name));
        for (const hint of pcb.routeHints ?? []) {
            if (!hint.id || !hint.nets.length)
                throw new Error('PCB route hints require non-empty id and nets.');
            for (const net of hint.nets)
                if (!knownNets.has(net))
                    throw new Error(`PCB route hint '${hint.id}' references unknown net '${net}'.`);
            if (hint.maxVias !== undefined && (!Number.isInteger(hint.maxVias) || hint.maxVias < 0))
                throw new Error(
                    `PCB route hint '${hint.id}' maxVias must be a non-negative integer.`,
                );
            for (const polygon of [...(hint.corridors ?? []), ...(hint.forbiddenRegions ?? [])]) {
                if (polygon.length < 3)
                    throw new Error(
                        `PCB route hint '${hint.id}' corridor/forbidden polygons require at least three points.`,
                    );
                this.validatePoints(polygon, `PCB route hint '${hint.id}'`);
            }
            this.validatePoints(hint.waypoints ?? [], `PCB route hint '${hint.id}'`);
        }
        const handoffIds = new Set<string>();
        for (const handoff of pcb.handoffs ?? []) {
            const id = `${handoff.module}/${handoff.port}`;
            if (handoffIds.has(id)) throw new Error(`Duplicate PCB handoff '${id}'.`);
            handoffIds.add(id);
            if (!knownNets.has(handoff.net))
                throw new Error(`Handoff '${id}' references unknown net '${handoff.net}'.`);
            if (handoff.layer !== 'F.Cu' && handoff.layer !== 'B.Cu')
                throw new Error(`Handoff '${id}' uses invalid copper layer.`);
            this.validatePoints([handoff.at], `Handoff '${id}'`);
        }
        const routeIds = new Set<string>();
        const copperIds = new Set<string>();
        for (const route of pcb.exactRoutes ?? []) {
            if (!route.id || routeIds.has(route.id))
                throw new Error(`Exact route IDs must be non-empty and unique: '${route.id}'.`);
            routeIds.add(route.id);
            for (const kind of ['segments', 'arcs', 'vias'] as const) {
                const ids = new Set<string>();
                for (const [index, item] of (route[kind] ?? []).entries()) {
                    const id = item.id ?? String(index);
                    if (ids.has(id))
                        throw new Error(
                            `Duplicate ${kind} identity '${id}' in route '${route.id}'.`,
                        );
                    ids.add(id);
                    if (item.uuid) {
                        if (copperIds.has(item.uuid))
                            throw new Error(`Duplicate copper UUID '${item.uuid}'.`);
                        copperIds.add(item.uuid);
                    }
                    if (
                        item.uuid &&
                        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                            item.uuid,
                        )
                    )
                        throw new Error(`Invalid copper UUID in route '${route.id}'.`);
                }
            }
            if (!knownNets.has(route.net))
                throw new Error(`Exact route '${route.id}' references unknown net '${route.net}'.`);
            if (!(route.segments?.length || route.arcs?.length || route.vias?.length))
                throw new Error(`Exact route '${route.id}' contains no copper primitives.`);
            for (const primitive of [...(route.segments ?? []), ...(route.arcs ?? [])]) {
                if (primitive.layer !== 'F.Cu' && primitive.layer !== 'B.Cu')
                    throw new Error(
                        `Exact route '${route.id}' uses invalid layer '${primitive.layer}'.`,
                    );
            }
        }
    }

    private validatePoints(points: PcbPoint[], context: string): void {
        if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
            throw new Error(`${context} contains non-finite coordinates.`);
        }
    }

    private generateGeometry(pcb: PcbOptions): string[] {
        const width = pcb.outlineLineWidth ?? 0.05;
        const geometry: string[] = [];
        if (pcb.outline)
            geometry.push(
                ...this.generateContour({ id: 'legacy-outline', points: pcb.outline }, width),
            );
        for (const contour of pcb.contours ?? [])
            geometry.push(...this.generateContour(contour, width));
        for (const cutout of pcb.cutouts ?? [])
            geometry.push(...this.generateContour(cutout, width));
        for (const slot of pcb.slots ?? []) geometry.push(...this.generateSlot(slot, width));
        return geometry;
    }

    private generateContour(contour: PcbContour, width: number): string[] {
        if (contour.points) {
            return contour.points.map((start, index) =>
                this.grLine(
                    start,
                    contour.points![(index + 1) % contour.points!.length],
                    width,
                    `contour:${contour.id}:line:${index}`,
                ),
            );
        }
        return contour.edges!.map((edge, index) => {
            const id = `contour:${contour.id}:${edge.id ?? `${edge.kind}:${index}`}`;
            return edge.kind === 'arc'
                ? this.grArc(edge.start, edge.mid, edge.end, width, id)
                : this.grLine(edge.start, edge.end, width, id);
        });
    }

    private generateSlot(slot: PcbRoutedSlot, lineWidth: number): string[] {
        const dx = slot.end.x - slot.start.x;
        const dy = slot.end.y - slot.start.y;
        const length = Math.hypot(dx, dy);
        const nx = ((-dy / length) * slot.width) / 2;
        const ny = ((dx / length) * slot.width) / 2;
        const a: PcbPoint = { x: slot.start.x + nx, y: slot.start.y + ny };
        const b: PcbPoint = { x: slot.end.x + nx, y: slot.end.y + ny };
        const c: PcbPoint = { x: slot.end.x - nx, y: slot.end.y - ny };
        const d: PcbPoint = { x: slot.start.x - nx, y: slot.start.y - ny };
        const endMid: PcbPoint = {
            x: slot.end.x + ((dy / length) * slot.width) / 2,
            y: slot.end.y - ((dx / length) * slot.width) / 2,
        };
        const startMid: PcbPoint = {
            x: slot.start.x - ((dy / length) * slot.width) / 2,
            y: slot.start.y + ((dx / length) * slot.width) / 2,
        };
        return [
            this.grLine(a, b, lineWidth, `slot:${slot.id}:side:0`),
            this.grArc(b, endMid, c, lineWidth, `slot:${slot.id}:end`),
            this.grLine(c, d, lineWidth, `slot:${slot.id}:side:1`),
            this.grArc(d, startMid, a, lineWidth, `slot:${slot.id}:start`),
        ];
    }

    private grLine(start: PcbPoint, end: PcbPoint, width: number, id: string): string {
        return `\t(gr_line\n\t\t(start ${start.x} ${start.y})\n\t\t(end ${end.x} ${end.y})\n\t\t(stroke (width ${width}) (type solid))\n\t\t(layer "Edge.Cuts")\n\t\t(uuid "${this.uuids.getOrGenerate(`pcb:geometry:${id}`)}")\n\t)`;
    }

    private grArc(
        start: PcbPoint,
        mid: PcbPoint,
        end: PcbPoint,
        width: number,
        id: string,
    ): string {
        return `\t(gr_arc\n\t\t(start ${start.x} ${start.y})\n\t\t(mid ${mid.x} ${mid.y})\n\t\t(end ${end.x} ${end.y})\n\t\t(stroke (width ${width}) (type solid))\n\t\t(layer "Edge.Cuts")\n\t\t(uuid "${this.uuids.getOrGenerate(`pcb:geometry:${id}`)}")\n\t)`;
    }

    private generateFiducial(mark: PcbFiducial): string {
        const diameter = mark.diameter ?? 1,
            mask = mark.maskDiameter ?? diameter + 1;
        if (
            !/^[\w.-]+$/.test(mark.id) ||
            ![mark.at.x, mark.at.y, diameter, mask].every(Number.isFinite) ||
            diameter <= 0 ||
            mask <= diameter ||
            (mark.side !== undefined && mark.side !== 'front' && mark.side !== 'back')
        )
            throw new Error('Invalid PCB fiducial');
        const side = mark.side === 'back' ? 'B' : 'F';
        return `(footprint "TSPCB:Fiducial" (layer "${side}.Cu") (at ${mark.at.x} ${mark.at.y})
            (uuid "${this.uuids.getOrGenerate(`pcb:fiducial:${mark.id}`)}")
            (property "Reference" "FID_${mark.id}" (at 0 0) (layer "${side}.Fab") (hide yes) (effects (font (size 1 1) (thickness 0.15))))
            (property "TSPCB.ManagedId" "fiducial:${mark.id}" (at 0 0) (layer "${side}.Fab") (hide yes) (effects (font (size 1 1) (thickness 0.15))))
            (attr board_only exclude_from_pos_files exclude_from_bom)
            (pad "1" smd circle (at 0 0) (size ${diameter} ${diameter}) (layers "${side}.Cu" "${side}.Mask") (solder_mask_margin ${(mask - diameter) / 2})
                (uuid "${this.uuids.getOrGenerate(`pcb:fiducial:${mark.id}:pad`)}")))`;
    }

    private generateMountingHole(hole: PcbMountingHole): string {
        const managedId = `mounting-hole:${hole.id}`;
        const diameter = hole.diameter ?? hole.drill;
        const padType = hole.plated ? 'thru_hole' : 'np_thru_hole';
        const layers = hole.plated ? '"*.Cu" "*.Mask"' : '"*.Cu" "*.Mask"';
        const reference = `MH_${hole.id.replace(/[^A-Za-z0-9_]/g, '_')}`;
        return (
            `\t(footprint "TSPCB:MountingHole"\n` +
            `\t\t(layer "F.Cu")\n\t\t(uuid "${this.uuids.getOrGenerate(`pcb:${managedId}`)}")\n\t\t(at ${hole.at.x} ${hole.at.y})\n` +
            `\t\t(property "Reference" "${this.escapeQuoted(reference)}" (at 0 ${-(diameter / 2 + 1.5)} 0) (layer "F.SilkS") ${hole.hideReference ? '(hide yes) ' : ''}(uuid "${this.uuids.getOrGenerate(`pcb:${managedId}:reference`)}") (effects (font (size 1 1) (thickness 0.15))))\n` +
            `\t\t(property "Value" "MountingHole_${hole.drill}mm" (at 0 ${diameter / 2 + 1.5} 0) (layer "F.Fab") (hide yes) (uuid "${this.uuids.getOrGenerate(`pcb:${managedId}:value`)}") (effects (font (size 1 1) (thickness 0.15))))\n` +
            `\t\t(property "TSPCB.ManagedId" "${managedId}" (at 0 0 0) (layer "F.Fab") (hide yes) (uuid "${this.uuids.getOrGenerate(`pcb:${managedId}:property`)}") (effects (font (size 1 1) (thickness 0.15))))\n` +
            `\t\t(attr exclude_from_pos_files exclude_from_bom)\n` +
            `\t\t(pad "${hole.plated ? '1' : ''}" ${padType} circle (at 0 0) (size ${diameter} ${diameter}) (drill ${hole.drill}) (layers ${layers}) (uuid "${this.uuids.getOrGenerate(`pcb:${managedId}:pad`)}"))\n\t)`
        );
    }

    private generateKeepout(keepout: PcbMechanicalKeepout): string {
        const layers = keepout.layers?.length ? keepout.layers : ['F.Cu', 'B.Cu'];
        const restriction = (enabled: boolean | undefined) =>
            enabled === false ? 'allowed' : 'not_allowed';
        const points = keepout.points.map((point) => `(xy ${point.x} ${point.y})`).join(' ');
        return (
            `\t(zone\n\t\t(net 0)\n\t\t(net_name "")\n\t\t(layers ${layers.map((layer) => `"${layer}"`).join(' ')})\n` +
            `\t\t(uuid "${this.uuids.getOrGenerate(`pcb:keepout:${keepout.id}`)}")\n\t\t(hatch edge 0.5)\n` +
            `\t\t(keepout (tracks ${restriction(keepout.tracks)}) (vias ${restriction(keepout.vias)}) (pads ${restriction(keepout.pads)}) (copperpour ${restriction(keepout.copperPour)}) (footprints ${restriction(keepout.footprints)}))\n` +
            `\t\t(polygon (pts ${points}))\n\t)`
        );
    }

    private generateCopperZone(
        zone: PcbCopperZone,
        pcb: PcbOptions,
        netCodes: ReadonlyMap<string, number>,
    ): string {
        const points = zone.points ?? this.boardInsetPolygon(pcb, zone.boardInset ?? 0);
        const netCode = netCodes.get(zone.net);
        if (netCode === undefined)
            throw new Error(`PCB zone '${zone.id}' references unknown net '${zone.net}'.`);
        const priority = zone.priority !== undefined ? `\n\t\t(priority ${zone.priority})` : '';
        const islandMode = zone.removeIslands === 'never' ? 2 : 0;
        return (
            `\t(zone\n\t\t(net ${netCode})\n\t\t(net_name "${this.escapeQuoted(zone.net)}")\n\t\t(layer "${zone.layer}")\n` +
            `\t\t(uuid "${this.uuids.getOrGenerate(`pcb:zone:${zone.id}`)}")\n\t\t(hatch edge 0.5)${priority}\n` +
            `\t\t(connect_pads ${zone.padConnection === 'solid' ? 'yes ' : ''}(clearance ${zone.clearance ?? 0.3}))\n\t\t(min_thickness ${zone.minThickness ?? 0.25})\n` +
            `\t\t(fill yes (thermal_gap ${zone.thermalGap ?? 0.3}) (thermal_bridge_width ${zone.thermalBridgeWidth ?? 0.3}) (island_removal_mode ${islandMode}))\n` +
            `\t\t(polygon (pts ${points.map((point) => `(xy ${point.x} ${point.y})`).join(' ')}))\n\t)`
        );
    }

    private boardInsetPolygon(pcb: PcbOptions, inset: number): PcbPoint[] {
        const points: PcbPoint[] = [
            ...(pcb.outline ?? []),
            ...(pcb.contours ?? []).flatMap(
                (contour) =>
                    contour.points ??
                    contour.edges!.flatMap((edge) =>
                        edge.kind === 'arc'
                            ? [edge.start, edge.mid, edge.end]
                            : [edge.start, edge.end],
                    ),
            ),
        ];
        const minX = Math.min(...points.map((point) => point.x)) + inset;
        const minY = Math.min(...points.map((point) => point.y)) + inset;
        const maxX = Math.max(...points.map((point) => point.x)) - inset;
        const maxY = Math.max(...points.map((point) => point.y)) - inset;
        if (!(minX < maxX && minY < maxY))
            throw new Error(`PCB zone boardInset ${inset} leaves no fillable board area.`);
        return [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY },
        ];
    }

    private generateExactRoute(
        route: PcbExactRoute,
        netCodes: ReadonlyMap<string, number>,
        warnings: string[],
    ): string[] {
        const netCode = netCodes.get(route.net);
        if (netCode === undefined)
            throw new Error(`Exact route '${route.id}' references unresolved net '${route.net}'.`);
        const classWidth = this.snapshot.pcb?.netClasses?.find(
            (netClass) =>
                netClass.name === this.snapshot.nets.find((net) => net.name === route.net)?.class ||
                netClass.nets?.includes(route.net),
        )?.width;
        const defaultWidth = route.width ?? classWidth ?? 0.25;
        const copper: string[] = [];
        if (!Number.isFinite(defaultWidth) || defaultWidth <= 0)
            throw new Error(`Exact route '${route.id}' requires a positive finite width.`);
        for (const primitive of [...(route.segments ?? []), ...(route.arcs ?? [])]) {
            if (
                primitive.width !== undefined &&
                (!Number.isFinite(primitive.width) || primitive.width <= 0)
            )
                throw new Error(`Exact route '${route.id}' requires a positive finite width.`);
        }
        (route.segments ?? []).forEach((segment, index) => {
            const start = this.resolveRoutePoint(segment.start, route, segment.layer);
            const end = this.resolveRoutePoint(segment.end, route, segment.layer);
            if (start.x === end.x && start.y === end.y)
                throw new Error(`Exact route '${route.id}' segment ${index} has zero length.`);
            copper.push(
                `\t(segment\n\t\t(start ${start.x} ${start.y})\n\t\t(end ${end.x} ${end.y})\n\t\t(width ${segment.width ?? defaultWidth})\n\t\t(layer "${segment.layer}")\n\t\t(net ${netCode})\n\t\t(uuid "${segment.uuid ?? this.uuids.getOrGenerate(`pcb:route:${route.id}:segment:${segment.id ?? index}`)}")\n\t)`,
            );
        });
        (route.arcs ?? []).forEach((arc, index) => {
            const start = this.resolveRoutePoint(arc.start, route, arc.layer);
            const end = this.resolveRoutePoint(arc.end, route, arc.layer);
            this.validatePoints([arc.mid], `Exact route '${route.id}' arc ${index}`);
            const area =
                (arc.mid.x - start.x) * (end.y - start.y) -
                (arc.mid.y - start.y) * (end.x - start.x);
            if (Math.abs(area) < 1e-9)
                throw new Error(`Exact route '${route.id}' arc ${index} is collinear/illegal.`);
            copper.push(
                `\t(arc\n\t\t(start ${start.x} ${start.y})\n\t\t(mid ${arc.mid.x} ${arc.mid.y})\n\t\t(end ${end.x} ${end.y})\n\t\t(width ${arc.width ?? defaultWidth})\n\t\t(layer "${arc.layer}")\n\t\t(net ${netCode})\n\t\t(uuid "${arc.uuid ?? this.uuids.getOrGenerate(`pcb:route:${route.id}:arc:${arc.id ?? index}`)}")\n\t)`,
            );
        });
        (route.vias ?? []).forEach((via, index) => {
            const at = this.resolveRoutePoint(via.at, route);
            const diameter = via.diameter ?? 0.6;
            const drill = via.drill ?? 0.3;
            if (
                !Number.isFinite(diameter) ||
                !Number.isFinite(drill) ||
                !(diameter > drill && drill > 0)
            )
                throw new Error(
                    `Exact route '${route.id}' via ${index} has invalid diameter/drill.`,
                );
            const from = via.fromLayer ?? 'F.Cu';
            const to = via.toLayer ?? 'B.Cu';
            if (!['F.Cu', 'B.Cu'].includes(from) || !['F.Cu', 'B.Cu'].includes(to))
                throw new Error(
                    `Exact route '${route.id}' via ${index} uses invalid copper layers.`,
                );
            if (from === to)
                throw new Error(`Exact route '${route.id}' via ${index} must change layers.`);
            copper.push(
                `\t(via\n\t\t(at ${at.x} ${at.y})\n\t\t(size ${diameter})\n\t\t(drill ${drill})\n\t\t(layers "${from}" "${to}")\n\t\t(net ${netCode})\n\t\t(uuid "${via.uuid ?? this.uuids.getOrGenerate(`pcb:route:${route.id}:via:${via.id ?? index}`)}")\n\t)`,
            );
        });
        this.validateRouteConstraints(route, warnings);
        return copper;
    }

    private resolveRoutePoint(
        point: PcbRoutePoint,
        route: PcbExactRoute,
        layer?: 'F.Cu' | 'B.Cu',
    ): PcbPoint {
        if ('x' in point) {
            this.validatePoints([point], `Exact route '${route.id}'`);
            return point;
        }
        if ('module' in point) {
            const handoff = this.snapshot.pcb?.handoffs?.find(
                (item) => item.module === point.module && item.port === point.port,
            );
            if (!handoff)
                throw new Error(
                    `Exact route '${route.id}' cannot resolve handoff '${point.module}.${point.port}'.`,
                );
            if (handoff.net !== route.net)
                throw new Error(
                    `Exact route '${route.id}' handoff '${point.module}.${point.port}' is not on net '${route.net}'.`,
                );
            if (layer && layer !== handoff.layer)
                throw new Error(
                    `Exact route '${route.id}' handoff '${point.module}.${point.port}' requires layer '${handoff.layer}'.`,
                );
            this.validatePoints([handoff.at], `Handoff '${point.module}.${point.port}'`);
            return handoff.at;
        }
        return this.resolvePadReference(point, route);
    }

    private resolvePadReference(reference: PcbPadReference, route: PcbExactRoute): PcbPoint {
        const component = this.snapshot.components.find(
            (candidate) => candidate.ref === reference.ref,
        );
        const source = this.footprintSources.get(reference.ref);
        if (!component || !source)
            throw new Error(
                `Exact route '${route.id}' cannot resolve positioned footprint '${reference.ref}'.`,
            );
        const pin = [...new Set(component.allPins.values())].find(
            (candidate) => candidate.name === reference.pad,
        );
        if (!pin)
            throw new Error(
                `Exact route '${route.id}' cannot resolve pad ${reference.ref}.${reference.pad}.`,
            );
        if (!pin.net || pin.net.name !== route.net)
            throw new Error(
                `Exact route '${route.id}' pad ${reference.ref}.${reference.pad} is not on net '${route.net}'.`,
            );
        const root = SExpressionParser.parse(source).find(
            (entry): entry is SExpr[] => Array.isArray(entry) && entry[0] === 'footprint',
        );
        const pad = root?.find(
            (entry): entry is SExpr[] =>
                Array.isArray(entry) &&
                entry[0] === 'pad' &&
                typeof entry[1] === 'string' &&
                SExpressionParser.unquote(entry[1]) === reference.pad,
        );
        const at = pad?.find(
            (entry): entry is SExpr[] => Array.isArray(entry) && entry[0] === 'at',
        );
        if (!at || typeof at[1] !== 'string' || typeof at[2] !== 'string')
            throw new Error(
                `Exact route '${route.id}' footprint data has no coordinate for pad ${reference.ref}.${reference.pad}.`,
            );
        let localX = Number(at[1]);
        const localY = Number(at[2]);
        const position = component.absolutePcbPosition;
        if (position.side === 'back') localX = -localX;
        const radians = (-(position.rotation ?? 0) * Math.PI) / 180;
        return {
            x: position.x + localX * Math.cos(radians) - localY * Math.sin(radians),
            y: position.y + localX * Math.sin(radians) + localY * Math.cos(radians),
        };
    }

    private validateRouteConstraints(route: PcbExactRoute, warnings: string[]): void {
        for (const hint of this.snapshot.pcb?.routeHints?.filter((candidate) =>
            candidate.nets.includes(route.net),
        ) ?? []) {
            const violations: string[] = [];
            if (hint.maxVias !== undefined && (route.vias?.length ?? 0) > hint.maxVias)
                violations.push(`via count ${route.vias?.length ?? 0} exceeds ${hint.maxVias}`);
            const layers = [
                ...(route.segments ?? []).map((segment) => segment.layer),
                ...(route.arcs ?? []).map((arc) => arc.layer),
            ];
            if (
                hint.preferredLayers?.length &&
                layers.some((layer) => !hint.preferredLayers!.includes(layer))
            )
                violations.push('uses a non-preferred layer');
            const points = this.routePoints(route);
            if (
                hint.corridors?.length &&
                points.some(
                    (point) =>
                        !hint.corridors!.some((polygon) => this.pointInPolygon(point, polygon)),
                )
            )
                violations.push('leaves every permitted corridor');
            if (
                hint.forbiddenRegions?.some((polygon) =>
                    points.some((point) => this.pointInPolygon(point, polygon)),
                )
            )
                violations.push('enters a forbidden region');
            if (
                hint.waypoints?.some(
                    (waypoint) =>
                        !points.some(
                            (point) =>
                                Math.hypot(point.x - waypoint.x, point.y - waypoint.y) < 1e-6,
                        ),
                )
            )
                violations.push('misses a required waypoint');
            const length = this.routeLength(route);
            const min =
                hint.length?.min ??
                (hint.length?.target !== undefined
                    ? hint.length.target - (hint.length.tolerance ?? 0)
                    : undefined);
            const max =
                hint.length?.max ??
                (hint.length?.target !== undefined
                    ? hint.length.target + (hint.length.tolerance ?? 0)
                    : undefined);
            if (min !== undefined && length < min)
                violations.push(`length ${length.toFixed(3)} is below ${min}`);
            if (max !== undefined && length > max)
                violations.push(`length ${length.toFixed(3)} exceeds ${max}`);
            for (const violation of violations)
                warnings.push(
                    `PCB_ROUTE_CONSTRAINT_VIOLATION ${JSON.stringify({ hint: hint.id, route: route.id, net: route.net, violation })}`,
                );
        }
    }

    private validateDifferentialConstraints(pcb: PcbOptions, warnings: string[]): void {
        for (const hint of pcb.routeHints ?? []) {
            if (hint.differential?.maxSkew === undefined) continue;
            const positive = pcb.exactRoutes?.find(
                (route) => route.net === hint.differential!.positive,
            );
            const negative = pcb.exactRoutes?.find(
                (route) => route.net === hint.differential!.negative,
            );
            if (!positive || !negative) {
                warnings.push(
                    `PCB_ROUTE_CONSTRAINT_VIOLATION ${JSON.stringify({ hint: hint.id, violation: 'differential pair exact routes are incomplete' })}`,
                );
                continue;
            }
            const skew = Math.abs(this.routeLength(positive) - this.routeLength(negative));
            if (skew > hint.differential.maxSkew) {
                warnings.push(
                    `PCB_ROUTE_CONSTRAINT_VIOLATION ${JSON.stringify({ hint: hint.id, violation: `differential skew ${skew.toFixed(3)} exceeds ${hint.differential.maxSkew}` })}`,
                );
            }
        }
    }

    private routePoints(route: PcbExactRoute): PcbPoint[] {
        return [
            ...(route.segments ?? []).flatMap((segment) => [
                this.resolveRoutePoint(segment.start, route),
                this.resolveRoutePoint(segment.end, route),
            ]),
            ...(route.arcs ?? []).flatMap((arc) => [
                this.resolveRoutePoint(arc.start, route),
                arc.mid,
                this.resolveRoutePoint(arc.end, route),
            ]),
            ...(route.vias ?? []).map((via) => this.resolveRoutePoint(via.at, route)),
        ];
    }

    private routeLength(route: PcbExactRoute): number {
        const segmentLength = (route.segments ?? []).reduce((sum, segment) => {
            const a = this.resolveRoutePoint(segment.start, route, segment.layer);
            const b = this.resolveRoutePoint(segment.end, route, segment.layer);
            return sum + Math.hypot(b.x - a.x, b.y - a.y);
        }, 0);
        const arcLength = (route.arcs ?? []).reduce((sum, arc) => {
            const a = this.resolveRoutePoint(arc.start, route, arc.layer);
            const b = this.resolveRoutePoint(arc.end, route, arc.layer);
            return (
                sum +
                Math.hypot(arc.mid.x - a.x, arc.mid.y - a.y) +
                Math.hypot(b.x - arc.mid.x, b.y - arc.mid.y)
            );
        }, 0);
        return segmentLength + arcLength;
    }

    private pointInPolygon(point: PcbPoint, polygon: PcbPoint[]): boolean {
        let inside = false;
        for (
            let index = 0, previous = polygon.length - 1;
            index < polygon.length;
            previous = index++
        ) {
            const a = polygon[index];
            const b = polygon[previous];
            if (
                a.y > point.y !== b.y > point.y &&
                point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
            )
                inside = !inside;
        }
        return inside;
    }

    private isIncluded(reference: string): boolean {
        const patterns = this.snapshot.pcb?.place;
        if (!patterns?.length) return true;
        return patterns.some((pattern) => {
            const expression = pattern
                .split('*')
                .map((part) => this.escapeRegex(part))
                .join('.*');
            return new RegExp(`^${expression}$`).test(reference);
        });
    }

    private hasExplicitPcbPosition(component: Component<any>): boolean {
        // A child coordinate is relative layout metadata, not permission to place
        // an otherwise unplaced subcircuit at the board origin. A positioned
        // parent, however, deliberately places its complete subtree.
        if (!component.parent) return Boolean(component.pcbPosition);
        let parent: any = component.parent;
        while (parent) {
            if (parent.pcbPosition) return true;
            parent = parent.parent;
        }
        return false;
    }

    private resolveFootprint(footprint: string): string | undefined {
        const separator = footprint.indexOf(':');
        if (separator < 1) return undefined;
        const library = footprint.slice(0, separator);
        const name = footprint.slice(separator + 1);
        const candidates: string[] = [];

        for (const tablePath of [
            path.join(this.outputDir, 'fp-lib-table'),
            path.join(this.footprintDirectory, 'fp-lib-table'),
            path.join(process.cwd(), 'fp-lib-table'),
        ]) {
            if (!fs.existsSync(tablePath)) continue;
            const table = fs.readFileSync(tablePath, 'utf-8');
            const libPattern = new RegExp(
                `\\(lib\\s+\\(name\\s+"?${this.escapeRegex(library)}"?\\).*?\\(uri\\s+"([^"]+)"\\)`,
                's',
            );
            const match = table.match(libPattern);
            if (match) {
                const root = path.resolve(
                    path.dirname(tablePath),
                    match[1].replace(/\$\{KIPRJMOD\}/g, path.dirname(tablePath)),
                );
                candidates.push(path.join(root, `${name}.kicad_mod`));
            }
        }

        const envRoots = process.env.KICAD_FOOTPRINT_DIR
            ? process.env.KICAD_FOOTPRINT_DIR.split(path.delimiter)
            : [];
        const systemRoots = [
            ...envRoots,
            '/usr/share/kicad/footprints',
            '/Applications/KiCad/KiCad.app/Contents/SharedSupport/footprints',
            'C:\\Program Files\\KiCad\\share\\kicad\\footprints',
        ];
        for (const root of systemRoots)
            candidates.push(path.join(root, `${library}.pretty`, `${name}.kicad_mod`));
        return candidates.find((candidate) => fs.existsSync(candidate));
    }

    private instantiateFootprint(
        component: Component<any>,
        source: string,
        netCodes: ReadonlyMap<string, number>,
        warnings: string[],
    ): string {
        const pos = component.absolutePcbPosition;
        let localFrame = component.parent;
        while (localFrame && !localFrame.pcbLocalCoordinates) localFrame = localFrame.parent;
        // Module positions and pad anchors share KiCad's clockwise board convention.
        const rotation = pos.rotation ?? 0;
        const footprintUuid = this.uuids.getOrGenerate(component.ref);
        const quotedRef = this.escapeQuoted(component.ref);
        const quotedValue = this.escapeQuoted(
            component.value || component.footprint.split(':').pop() || component.ref,
        );
        const root = SExpressionParser.parse(source).find(
            (item): item is SExpr[] => Array.isArray(item) && item[0] === 'footprint',
        );
        if (!root) throw new Error(`Invalid footprint source for '${component.ref}'.`);
        // Normalize compact and multiline library files before inserting placement metadata.
        let result = /\n\s*\(layer\s+"[FB]\.Cu"\)/.test(source)
            ? source.trim()
            : SExpressionParser.serialize(root).trim();

        result = result.replace(
            /^\(footprint\s+"[^"]+"/,
            `(footprint "${this.escapeQuoted(component.footprint)}"`,
        );
        result = result.replace(
            /^\s*\((?:version|generator|generator_version)\b[^\n]*\)\s*$/gm,
            '',
        );
        let generatedUuidIndex = 0;
        result = result.replace(
            /\(uuid\s+"([0-9a-f-]+)"\)/gi,
            (_match, sourceUuid: string) =>
                `(uuid "${this.uuids.getOrGenerate(`pcb:footprint:${component.ref}:item:${sourceUuid || generatedUuidIndex++}`)}")`,
        );
        result = result.replace(
            /\(property\s+"Reference"\s+"[^"]*"/,
            `(property "Reference" "${quotedRef}"`,
        );
        result = result.replace(
            /\(property\s+"Value"\s+"[^"]*"/,
            `(property "Value" "${quotedValue}"`,
        );

        // Standard KiCad templates often hide Value and show ${REFERENCE} on Fab.
        // Show the real circuit value on the fabrication side instead. Back-side
        // placement subsequently flips F.Fab to B.Fab with all other side layers.
        const valueStart = result.indexOf('(property "Value"');
        if (valueStart >= 0) {
            const valueEnd = this.findSExpressionEnd(result, valueStart);
            const valueProperty = result
                .slice(valueStart, valueEnd + 1)
                .replace(/\(layer\s+"[^"]+"\)/, '(layer "F.Fab")')
                .replace(/\(hide\s+yes\)/g, '')
                .replace(/\)\s+hide(?=\s*\()/g, ')');
            result = result.slice(0, valueStart) + valueProperty + result.slice(valueEnd + 1);
        }
        const fabTextPattern = /\(fp_text\s+user\s+"\$\{REFERENCE\}"/g;
        result = result.replace(fabTextPattern, (match: string, offset: number) => {
            const end = this.findSExpressionEnd(result, offset);
            return /\(layer\s+"[FB]\.Fab"\)/.test(result.slice(offset, end + 1))
                ? match.replace('${REFERENCE}', '${VALUE}')
                : match;
        });

        const pinNets = new Map<string, string>();
        for (const pin of new Set(component.allPins.values())) {
            if (pin.net && !pin.isDNC) pinNets.set(pin.name, pin.net.name);
        }
        const assignedPads = new Set<string>();
        result = this.assignPadNets(result, pinNets, netCodes, assignedPads);
        if (component.pcbLabel) {
            result = result.replace(
                /\n\)$/,
                `\n\t(fp_text user "${this.escapeQuoted(component.pcbLabel)}" (at -3.5 1.27 ${rotation}) (layer "F.SilkS") (effects (font (size 0.8 0.8) (thickness 0.12))))\n)`,
            );
        }
        if (component.frontPanelLabel || component.keycapBottomBars) {
            const surfaceProperty = root.find(
                (item) =>
                    Array.isArray(item) &&
                    item[0] === 'property' &&
                    SExpressionParser.unquote(String(item[1])) === 'KeycapLegendSurface',
            ) as SExpr[] | undefined;
            if (surfaceProperty) {
                const surface = JSON.parse(SExpressionParser.unquote(String(surfaceProperty[2])));
                const legend = writeKeycapLegend(
                    component.frontPanelLabel ?? '',
                    surface,
                    path.join(this.outputDir, '3d', 'key-legends'),
                    component.frontPanelSecondaryLabel,
                    component.keycapBottomBars,
                );
                result = result.replace(
                    /\n\)$/,
                    `\n\t(model ${JSON.stringify(legend)} (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))\n)`,
                );
            }
        }
        if (pos.side === 'back') result = this.mirrorBackGeometry(result);
        result = this.rotatePadAngles(result, rotation);
        if (localFrame?.pcbHideReferences) {
            const tree = SExpressionParser.parse(result)[0] as SExpr[];
            for (const item of tree) {
                if (!Array.isArray(item)) continue;
                const isReference = item[0] === 'property' && item[1] === '"Reference"';
                const isSilkText =
                    item[0] === 'fp_text' &&
                    item[2] === '"${REFERENCE}"' &&
                    item.some(
                        (node) =>
                            Array.isArray(node) && node[0] === 'layer' && node[1] === '"F.SilkS"',
                    );
                if (!isReference && !isSilkText) continue;
                const effects = item.find((node) => Array.isArray(node) && node[0] === 'effects') as
                    | SExpr[]
                    | undefined;
                if (effects && !effects.some((node) => Array.isArray(node) && node[0] === 'hide'))
                    effects.push(['hide', 'yes']);
            }
            result = SExpressionParser.serialize(tree);
        }
        for (const pad of pinNets.keys()) {
            if (!assignedPads.has(pad))
                warnings.push(
                    `Connected pin ${component.ref}.${pad} has no matching pad in '${component.footprint}'.`,
                );
        }

        if (component.verticalFrontPanelInterface) {
            const tree = SExpressionParser.parse(result)[0] as SExpr[];
            result = SExpressionParser.serialize(
                tree.filter(
                    (item) =>
                        !(
                            Array.isArray(item) &&
                            item[0] === 'property' &&
                            SExpressionParser.unquote(String(item[1])) ===
                                'VerticalFrontPanelInterface'
                        ),
                ),
            );
            const property = this.hiddenProperty(
                'VerticalFrontPanelInterface',
                JSON.stringify(component.verticalFrontPanelInterface),
                `pcb:footprint:${component.ref}:vertical-front-panel`,
            );
            result = result.replace(/\n\)$/, `\n${property}\n)`);
        }

        if (component.frontPanelLabel) {
            const property = this.hiddenProperty(
                'FrontPanelText',
                component.frontPanelLabel,
                `pcb:footprint:${component.ref}:front-panel-text`,
            );
            const attrIndex = result.search(/\n\s*\(attr\b/);
            result =
                attrIndex >= 0
                    ? result.slice(0, attrIndex) + `\n${property}` + result.slice(attrIndex)
                    : result.replace(/\n\)$/, `\n${property}\n)`);
        }

        const managedProperty = this.hiddenProperty(
            'TSPCB.ManagedId',
            `footprint:${component.ref}`,
            `pcb:footprint:${component.ref}:managed-property`,
        );
        const managedAttrIndex = result.search(/\n\s*\(attr\b/);
        result =
            managedAttrIndex >= 0
                ? result.slice(0, managedAttrIndex) +
                  `\n${managedProperty}` +
                  result.slice(managedAttrIndex)
                : result.replace(/\n\)$/, `\n${managedProperty}\n)`);

        if (pos.side === 'back') result = this.flipLayers(result);
        const rootLayer = pos.side === 'back' ? 'B.Cu' : 'F.Cu';
        result = result.replace(
            /\n\s*\(layer\s+"[FB]\.Cu"\)/,
            `\n\t(layer "${rootLayer}")\n\t(uuid "${this.uuids.getOrGenerate(`pcb:footprint:${component.ref}`)}")\n\t(at ${pos.x} ${pos.y} ${rotation})`,
        );

        const association = `\n\t(path "/${footprintUuid}")\n\t(sheetname "/")\n\t(sheetfile "${this.escapeQuoted(this.snapshot.name)}.kicad_sch")`;
        const attrIndex = result.search(/\n\s*\(attr\b/);
        if (attrIndex >= 0)
            result = result.slice(0, attrIndex) + association + result.slice(attrIndex);
        else result = result.replace(/\n\)$/, `${association}\n)`);
        return result;
    }

    private assignPadNets(
        source: string,
        pinNets: ReadonlyMap<string, string>,
        netCodes: ReadonlyMap<string, number>,
        assignedPads: Set<string>,
    ): string {
        const pattern = /\(pad\s+"([^"]*)"/g;
        let output = '';
        let cursor = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(source)) !== null) {
            const start = match.index;
            const end = this.findSExpressionEnd(source, start);
            if (end < 0) break;
            output += source.slice(cursor, start);
            let pad = source.slice(start, end + 1);
            const padNumber = match[1];
            const netName = pinNets.get(padNumber);
            const netCode = netName ? netCodes.get(netName) : undefined;
            if (netName && netCode !== undefined) {
                pad = pad.replace(/\n?\s*\(net\s+\d+\s+"(?:[^"\\]|\\.)*"\)/g, '');
                pad = `${pad.slice(0, -1)}\n\t\t(net ${netCode} "${this.escapeQuoted(netName)}")\n\t)`;
                assignedPads.add(padNumber);
            }
            output += pad;
            cursor = end + 1;
            pattern.lastIndex = cursor;
        }
        return output + source.slice(cursor);
    }

    /** KiCad stores pad angles in board coordinates, independently of the footprint angle. */
    private rotatePadAngles(source: string, footprintRotation: number): string {
        const pattern = /\(pad\s+"[^"]*"/g;
        let output = '';
        let cursor = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(source)) !== null) {
            const start = match.index;
            const end = this.findSExpressionEnd(source, start);
            if (end < 0) break;
            output += source.slice(cursor, start);
            const pad = source
                .slice(start, end + 1)
                .replace(
                    /\(at\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)(?:\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?))?\)/,
                    (_at, x: string, y: string, localAngle: string | undefined) => {
                        const absoluteAngle = this.normalizeAngle(
                            Number(localAngle ?? 0) + footprintRotation,
                        );
                        return `(at ${x} ${y} ${absoluteAngle})`;
                    },
                );
            output += pad;
            cursor = end + 1;
            pattern.lastIndex = cursor;
        }
        return output + source.slice(cursor);
    }

    private normalizeAngle(angle: number): number {
        const normalized = ((angle % 360) + 360) % 360;
        return Number(normalized.toFixed(9));
    }

    private findSExpressionEnd(source: string, start: number): number {
        let depth = 0;
        let quoted = false;
        let escaped = false;
        for (let index = start; index < source.length; index++) {
            const char = source[index];
            if (quoted) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') quoted = false;
                continue;
            }
            if (char === '"') quoted = true;
            else if (char === '(') depth++;
            else if (char === ')' && --depth === 0) return index;
        }
        return -1;
    }

    /** Flip local geometry across X before applying the board rotation. Flipping
     * layer names alone leaves asymmetric packages and mating connectors backwards. */
    private mirrorBackGeometry(source: string): string {
        const mirrored = source.replace(
            /\((at|start|mid|end|center|xy)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)(?:\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?))?\)/g,
            (_match, kind: string, x: string, y: string, angle: string | undefined) =>
                `(${kind} ${Number((-Number(x)).toFixed(9))} ${y}${angle === undefined ? '' : ` ${this.normalizeAngle(-Number(angle))}`})`,
        );
        // KiCad flips 3D models across Y on B.Cu, whereas our placement convention
        // mirrors footprint geometry across X. A model-only half turn reconciles
        // these conventions; rotating the physical connector again does not.
        let modelCorrected = mirrored.replace(
            /(\(model[\s\S]*?\(rotate\s*\(xyz\s+[^\s]+\s+[^\s]+\s+)([-+\d.eE]+)(\)\s*\))/g,
            (_match, before, z, after) =>
                `${before}${this.normalizeAngle(Number(z) + 180)}${after}`,
        );
        modelCorrected = modelCorrected.replace(
            /(\(model[\s\S]*?\(offset\s*\(xyz\s+)([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)(\)\s*\))/g,
            (_match, before, x, y, z, after) => `${before}${-Number(x)} ${-Number(y)} ${z}${after}`,
        );
        const tree = SExpressionParser.parse(modelCorrected)[0] as SExpr[];
        for (const item of tree) {
            if (!Array.isArray(item) || !['property', 'fp_text'].includes(String(item[0])))
                continue;
            const effects = item.find((node) => Array.isArray(node) && node[0] === 'effects') as
                | SExpr[]
                | undefined;
            if (!effects) continue;
            const justify = effects.find((node) => Array.isArray(node) && node[0] === 'justify') as
                | SExpr[]
                | undefined;
            if (justify) {
                if (!justify.includes('mirror')) justify.push('mirror');
            } else effects.push(['justify', 'mirror']);
        }
        return SExpressionParser.serialize(tree);
    }

    private flipLayers(source: string): string {
        return source
            .replace(/"F\./g, '"__FRONT__.')
            .replace(/"B\./g, '"F.')
            .replace(/"__FRONT__\./g, '"B.');
    }

    private escapeQuoted(value: string): string {
        // KiCad quoted strings must escape line breaks as well as quotes.
        return JSON.stringify(value).slice(1, -1);
    }

    private escapeRegex(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private hiddenProperty(
        key: string,
        value: string,
        uuidKey = `pcb:property:${key}:${value}`,
    ): string {
        return (
            `\t(property "${this.escapeQuoted(key)}" "${this.escapeQuoted(value)}"\n` +
            `\t\t(at 0 0 0)\n\t\t(layer "F.Fab")\n\t\t(hide yes)\n` +
            `\t\t(uuid "${this.uuids.getOrGenerate(uuidKey)}")\n` +
            `\t\t(effects (font (size 1 1) (thickness 0.15)))\n\t)`
        );
    }

    private setup(thickness: number, pcb: PcbOptions): string {
        if (!pcb.stackup)
            return `(setup (pad_to_mask_clearance 0) (allow_soldermask_bridges_in_footprints no))`;
        const copper = pcb.stackup.copperThickness ?? 0.035;
        const mask = pcb.stackup.solderMaskThickness ?? 0.01;
        const dielectric = Math.max(0.05, thickness - copper * 2 - mask * 2);
        const material = this.escapeQuoted(pcb.stackup.dielectricMaterial ?? 'FR4');
        const maskColor = this.escapeQuoted(pcb.stackup.solderMaskColor ?? 'Green');
        const finish = this.escapeQuoted(pcb.stackup.copperFinish ?? 'None');
        return (
            `(setup\n` +
            `\t\t(stackup\n` +
            `\t\t\t(layer "F.SilkS" (type "Top Silk Screen"))\n` +
            `\t\t\t(layer "F.Paste" (type "Top Solder Paste"))\n` +
            `\t\t\t(layer "F.Mask" (type "Top Solder Mask") (color "${maskColor}") (thickness ${mask}))\n` +
            `\t\t\t(layer "F.Cu" (type "copper") (thickness ${copper}))\n` +
            `\t\t\t(layer "dielectric 1" (type "core") (thickness ${dielectric}) (material "${material}") (epsilon_r ${pcb.stackup.dielectricEpsilonR ?? 4.5}) (loss_tangent ${pcb.stackup.dielectricLossTangent ?? 0.02}))\n` +
            `\t\t\t(layer "B.Cu" (type "copper") (thickness ${copper}))\n` +
            `\t\t\t(layer "B.Mask" (type "Bottom Solder Mask") (color "${maskColor}") (thickness ${mask}))\n` +
            `\t\t\t(layer "B.Paste" (type "Bottom Solder Paste"))\n` +
            `\t\t\t(layer "B.SilkS" (type "Bottom Silk Screen"))\n` +
            `\t\t\t(copper_finish "${finish}")\n` +
            `\t\t\t(dielectric_constraints no)\n\t\t)\n` +
            `\t\t(pad_to_mask_clearance 0)\n\t\t(allow_soldermask_bridges_in_footprints no)\n\t)`
        );
    }

    private header(
        thickness: number,
        netCodes: ReadonlyMap<string, number>,
        pcb: PcbOptions,
    ): string {
        const nets = [...netCodes.entries()]
            .map(([name, code]) => `\t(net ${code} "${this.escapeQuoted(name)}")`)
            .join('\n');
        return `(kicad_pcb
\t(version ${KICAD_PCB_FILE_VERSION})
\t(generator "pcb_framework")
\t(generator_version "${KICAD_TARGET_VERSION}")
\t(general (thickness ${thickness}) (legacy_teardrops no))
\t(paper "A4")
\t(layers
\t\t(0 "F.Cu" signal)
\t\t(2 "B.Cu" signal)
\t\t(9 "F.Adhes" user "F.Adhesive")
\t\t(11 "B.Adhes" user "B.Adhesive")
\t\t(13 "F.Paste" user)
\t\t(15 "B.Paste" user)
\t\t(5 "F.SilkS" user "F.Silkscreen")
\t\t(7 "B.SilkS" user "B.Silkscreen")
\t\t(1 "F.Mask" user)
\t\t(3 "B.Mask" user)
\t\t(17 "Dwgs.User" user "UserInteractionArea")
\t\t(19 "Cmts.User" user "User.Comments")
\t\t(21 "Eco1.User" user "FrontpanelCutout")
\t\t(23 "Eco2.User" user "MountingLayerCutout")
\t\t(25 "Edge.Cuts" user)
\t\t(27 "Margin" user)
\t\t(31 "F.CrtYd" user "F.Courtyard")
\t\t(29 "B.CrtYd" user "B.Courtyard")
\t\t(35 "F.Fab" user)
\t\t(33 "B.Fab" user)
\t)
\t${this.setup(thickness, pcb)}
\t(net 0 "")${nets ? `\n${nets}` : ''}`;
    }
}
