import { normalizeBoardNets } from './KicadNetFormat';
import { SExpr, SExpressionParser } from './SExpressionParser';

export type PcbMode = 'preserve' | 'sync' | 'rebuild';

export interface RoutedFootprintMove {
    reference: string;
    nets: string[];
    from: { x: number; y: number; rotation: number; side: string };
    to: { x: number; y: number; rotation: number; side: string };
}

export interface PcbSyncReport {
    mode: PcbMode;
    addedFootprints: string[];
    updatedFootprints: string[];
    addedGeometry: string[];
    updatedGeometry: string[];
    zoneFill: 'not-applicable' | 'requires-kicad-refill';
    routedFootprintMoves: RoutedFootprintMove[];
    preservedCopper: { segments: number; arcs: number; vias: number; zones: number };
}

type Node = SExpr[];

const isNode = (value: SExpr, keyword?: string): value is Node =>
    Array.isArray(value) && (!keyword || value[0] === keyword);

const atom = (node: Node | undefined, index: number): string | undefined => {
    const value = node?.[index];
    return typeof value === 'string' ? SExpressionParser.unquote(value) : undefined;
};

const child = (node: Node, keyword: string): Node | undefined =>
    node.find((value): value is Node => isNode(value, keyword));

const children = (node: Node, keyword: string): Node[] =>
    node.filter((value): value is Node => isNode(value, keyword));

const referenceOf = (footprint: Node): string | undefined => {
    for (const property of children(footprint, 'property')) {
        if (atom(property, 1) === 'Reference') return atom(property, 2);
    }
    return undefined;
};

const managedIdOf = (footprint: Node): string | undefined => {
    for (const property of children(footprint, 'property')) {
        if (atom(property, 1) === 'TSPCB.ManagedId') return atom(property, 2);
    }
    return undefined;
};

const uuidOf = (node: Node): string | undefined => atom(child(node, 'uuid'), 1);

const placementOf = (footprint: Node) => {
    const at = child(footprint, 'at');
    const layer = child(footprint, 'layer');
    return {
        x: Number(atom(at, 1) ?? 0),
        y: Number(atom(at, 2) ?? 0),
        rotation: Number(atom(at, 3) ?? 0),
        side: atom(layer, 1) ?? 'F.Cu',
    };
};

const quoted = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Merge framework-declared footprint state into an existing KiCad board AST. */
export function synchronizePcb(
    existingSource: string,
    generatedSource: string,
    options: { refreshFootprints?: boolean; ownedCopperUuids?: string[] } = {},
): { content: string; report: PcbSyncReport } {
    const existingAst = SExpressionParser.parse(existingSource);
    const generatedAst = SExpressionParser.parse(generatedSource);
    const existing = existingAst.find((value): value is Node => isNode(value, 'kicad_pcb'));
    const generated = generatedAst.find((value): value is Node => isNode(value, 'kicad_pcb'));
    if (!existing || !generated)
        throw new Error('Cannot synchronize an invalid KiCad PCB document.');
    normalizeBoardNets(existing);
    normalizeBoardNets(generated);

    const report: PcbSyncReport = {
        mode: 'sync',
        addedFootprints: [],
        updatedFootprints: [],
        addedGeometry: [],
        updatedGeometry: [],
        zoneFill: children(generated, 'zone').some(
            (zone) => child(zone, 'fill') && !child(zone, 'keepout'),
        )
            ? 'requires-kicad-refill'
            : 'not-applicable',
        routedFootprintMoves: [],
        preservedCopper: {
            segments: children(existing, 'segment').length,
            arcs: children(existing, 'arc').length,
            vias: children(existing, 'via').length,
            zones: children(existing, 'zone').length,
        },
    };

    const existingNets = new Map<string, number>();
    let nextNetCode = 1;
    for (const net of children(existing, 'net')) {
        const code = Number(atom(net, 1));
        const name = atom(net, 2);
        if (name !== undefined && Number.isFinite(code)) existingNets.set(name, code);
        if (Number.isFinite(code)) nextNetCode = Math.max(nextNetCode, code + 1);
    }
    for (const net of children(generated, 'net')) {
        const name = atom(net, 2);
        if (!name || existingNets.has(name)) continue;
        existingNets.set(name, nextNetCode);
        existing.push(['net', String(nextNetCode), quoted(name)]);
        nextNetCode++;
    }

    const existingByReference = new Map<string, Node>();
    const existingByManagedId = new Map<string, Node>();
    for (const footprint of children(existing, 'footprint')) {
        const reference = referenceOf(footprint);
        if (reference) existingByReference.set(reference, footprint);
        const managedId = managedIdOf(footprint);
        if (managedId) existingByManagedId.set(managedId, footprint);
    }

    const copperNetCodes = new Set<number>();
    for (const keyword of ['segment', 'arc', 'via', 'zone']) {
        for (const copper of children(existing, keyword)) {
            const net = child(copper, 'net');
            const code = Number(atom(net, 1));
            if (Number.isFinite(code)) copperNetCodes.add(code);
        }
    }

    for (const declared of children(generated, 'footprint')) {
        const reference = referenceOf(declared);
        if (!reference) continue;
        const managedId = managedIdOf(declared);
        remapPadNets(declared, existingNets);
        const current =
            (managedId ? existingByManagedId.get(managedId) : undefined) ??
            existingByReference.get(reference);
        if (!current) {
            existing.push(declared);
            report.addedFootprints.push(reference);
            continue;
        }

        const from = placementOf(current);
        const to = placementOf(declared);
        if (options.refreshFootprints) {
            existing[existing.indexOf(current)] = declared;
        } else {
            if (from.side !== to.side) flipFootprintLayers(current);
            replaceChild(current, 'at', child(declared, 'at'));
            replaceChild(current, 'layer', child(declared, 'layer'));
            replaceChild(current, 'uuid', child(declared, 'uuid'));
            syncManagedProperty(current, declared);
            syncKeycapLegend(current, declared);
            syncPadNets(current, declared, existingNets);
            syncPadAngles(current, declared);
        }
        report.updatedFootprints.push(reference);

        if (!samePlacement(from, to)) {
            const routedNets = padNetNames(options.refreshFootprints ? declared : current).filter(
                (name) => copperNetCodes.has(existingNets.get(name) ?? -1),
            );
            if (routedNets.length)
                report.routedFootprintMoves.push({
                    reference,
                    nets: [...new Set(routedNets)].sort(),
                    from,
                    to,
                });
        }
    }

    // Generated net numbers are local to this generation. Existing copper uses the board's persistent numbers.
    const generatedNetNames = new Map(
        children(generated, 'net').map((net) => [atom(net, 1), atom(net, 2)]),
    );
    for (const keyword of ['segment', 'arc', 'via', 'zone']) {
        for (const copper of children(generated, keyword)) {
            const net = child(copper, 'net');
            const name = generatedNetNames.get(atom(net, 1));
            if (net && name && existingNets.has(name)) net[1] = String(existingNets.get(name));
        }
    }

    const frameworkManagedBoard = atom(child(existing, 'generator'), 1) === 'pcb_framework';
    syncBoardMetadata(existing, generated, frameworkManagedBoard);
    const oldOwned = new Set(options.ownedCopperUuids);
    const newOwned = new Set(
        ['segment', 'arc', 'via'].flatMap((kind) => children(generated, kind).map(uuidOf)),
    );
    for (let index = existing.length - 1; index >= 0; index--) {
        const item = existing[index];
        if (!Array.isArray(item) || !['segment', 'arc', 'via'].includes(String(item[0]))) continue;
        const uuid = uuidOf(item);
        if (uuid && oldOwned.has(uuid) && !newOwned.has(uuid)) existing.splice(index, 1);
    }
    syncOwnedGeometry(existing, generated, report);

    return { content: `${SExpressionParser.serialize(existing)}\n`, report };
}

/** Refresh generated legend meshes without replacing footprint geometry or copper. */
function syncKeycapLegend(existing: Node, declared: Node): void {
    if (!children(declared, 'property').some((item) => atom(item, 1) === 'KeycapLegendSurface'))
        return;
    for (let index = existing.length - 1; index >= 0; index--) {
        const item = existing[index];
        if (isNode(item, 'model') && /[/\\]key-legends[/\\]legend-/.test(atom(item, 1) ?? ''))
            existing.splice(index, 1);
    }
    for (const model of children(declared, 'model')) {
        if (/[/\\]key-legends[/\\]legend-/.test(atom(model, 1) ?? '')) existing.push(model);
    }
    for (const name of ['KeycapLegendSurface', 'FrontPanelText']) {
        const replacement = children(declared, 'property').find((item) => atom(item, 1) === name);
        const index = existing.findIndex(
            (item) => isNode(item, 'property') && atom(item, 1) === name,
        );
        if (index >= 0) existing.splice(index, 1);
        if (replacement) existing.push(replacement);
    }
}

function syncManagedProperty(existing: Node, declared: Node): void {
    const declaredProperty = children(declared, 'property').find(
        (property) => atom(property, 1) === 'TSPCB.ManagedId',
    );
    if (!declaredProperty) return;
    const index = existing.findIndex(
        (value) => isNode(value, 'property') && atom(value, 1) === 'TSPCB.ManagedId',
    );
    if (index >= 0) existing[index] = declaredProperty;
    else existing.push(declaredProperty);
}

function syncBoardMetadata(existing: Node, generated: Node, frameworkManagedBoard: boolean): void {
    if (frameworkManagedBoard) {
        replaceChild(existing, 'version', child(generated, 'version'));
        replaceChild(existing, 'generator', child(generated, 'generator'));
        replaceChild(existing, 'generator_version', child(generated, 'generator_version'));
    }

    const generatedGeneral = child(generated, 'general');
    const existingGeneral = child(existing, 'general');
    const generatedThickness = generatedGeneral && child(generatedGeneral, 'thickness');
    if (existingGeneral && generatedThickness)
        replaceChild(existingGeneral, 'thickness', generatedThickness);

    const generatedSetup = child(generated, 'setup');
    const generatedStackup = generatedSetup && child(generatedSetup, 'stackup');
    if (!generatedStackup) return;
    const existingSetup = child(existing, 'setup');
    if (existingSetup) replaceChild(existingSetup, 'stackup', generatedStackup);
    else existing.push(['setup', generatedStackup]);
}

function syncOwnedGeometry(existing: Node, generated: Node, report: PcbSyncReport): void {
    const keywords = new Set(['gr_line', 'gr_arc', 'zone', 'segment', 'arc', 'via']);
    const legacyFrameworkBoard = atom(child(existing, 'generator'), 1) === 'pcb_framework';
    const byUuid = new Map<string, { node: Node; index: number }>();
    const legacyByShape = new Map<string, { node: Node; index: number }[]>();
    existing.forEach((value, index) => {
        if (!Array.isArray(value) || !keywords.has(String(value[0]))) return;
        const uuid = uuidOf(value);
        if (uuid) byUuid.set(uuid, { node: value, index });
        const signature = geometrySignature(value);
        const matches = legacyByShape.get(signature) ?? [];
        matches.push({ node: value, index });
        legacyByShape.set(signature, matches);
    });
    const migratedIndexes = new Set<number>();
    for (const value of generated) {
        if (!Array.isArray(value) || !keywords.has(String(value[0]))) continue;
        const uuid = uuidOf(value);
        if (!uuid) continue;
        const current = byUuid.get(uuid);
        if (current) {
            existing[current.index] = value;
            report.updatedGeometry.push(uuid);
        } else if (legacyFrameworkBoard) {
            const legacy = legacyByShape
                .get(geometrySignature(value))
                ?.find((candidate) => !migratedIndexes.has(candidate.index));
            if (legacy) {
                existing[legacy.index] = value;
                migratedIndexes.add(legacy.index);
                report.updatedGeometry.push(uuid);
            } else {
                existing.push(value);
                report.addedGeometry.push(uuid);
            }
        } else {
            existing.push(value);
            report.addedGeometry.push(uuid);
        }
    }
}

function geometrySignature(node: Node): string {
    const stripUuid = (value: SExpr): SExpr | undefined => {
        if (!Array.isArray(value)) return value;
        if (value[0] === 'uuid') return undefined;
        return value.map(stripUuid).filter((entry): entry is SExpr => entry !== undefined);
    };
    return JSON.stringify(stripUuid(node));
}

function flipFootprintLayers(node: Node): void {
    for (let index = 0; index < node.length; index++) {
        const value = node[index];
        if (Array.isArray(value)) {
            flipFootprintLayers(value);
            continue;
        }
        const match = value.match(/^("?)([FB])(\.[^"\s]+)("?)$/);
        if (match) node[index] = `${match[1]}${match[2] === 'F' ? 'B' : 'F'}${match[3]}${match[4]}`;
    }
}

function samePlacement(
    a: ReturnType<typeof placementOf>,
    b: ReturnType<typeof placementOf>,
): boolean {
    return a.x === b.x && a.y === b.y && a.rotation === b.rotation && a.side === b.side;
}

function replaceChild(target: Node, keyword: string, replacement: Node | undefined): void {
    if (!replacement) return;
    const index = target.findIndex((value) => isNode(value, keyword));
    if (index >= 0) target[index] = replacement;
    else target.push(replacement);
}

function padNumber(pad: Node): string | undefined {
    return atom(pad, 1);
}

function padNetNames(footprint: Node): string[] {
    return children(footprint, 'pad')
        .map((pad) => atom(child(pad, 'net'), 2))
        .filter((name): name is string => Boolean(name));
}

function remapPadNets(footprint: Node, netCodes: ReadonlyMap<string, number>): void {
    for (const pad of children(footprint, 'pad')) {
        const net = child(pad, 'net');
        const name = atom(net, 2);
        if (net && name && netCodes.has(name)) net[1] = String(netCodes.get(name));
    }
}

function syncPadNets(existing: Node, declared: Node, netCodes: ReadonlyMap<string, number>): void {
    const desired = new Map<string, string>();
    for (const pad of children(declared, 'pad')) {
        const number = padNumber(pad);
        const name = atom(child(pad, 'net'), 2);
        if (number && name) desired.set(number, name);
    }
    for (const pad of children(existing, 'pad')) {
        const number = padNumber(pad);
        if (!number) continue;
        const currentNet = pad.findIndex((value) => isNode(value, 'net'));
        const name = desired.get(number);
        if (!name) {
            if (currentNet >= 0) pad.splice(currentNet, 1);
            continue;
        }
        const replacement: Node = ['net', String(netCodes.get(name)), quoted(name)];
        if (currentNet >= 0) pad[currentNet] = replacement;
        else pad.push(replacement);
    }
}

/** Pad centers are footprint-local, but KiCad stores each pad's shape angle absolutely. */
function syncPadAngles(existing: Node, declared: Node): void {
    const declaredByNumber = new Map<string, Node[]>();
    for (const pad of children(declared, 'pad')) {
        const number = padNumber(pad) ?? '';
        const matches = declaredByNumber.get(number) ?? [];
        matches.push(pad);
        declaredByNumber.set(number, matches);
    }

    const occurrence = new Map<string, number>();
    for (const pad of children(existing, 'pad')) {
        const number = padNumber(pad) ?? '';
        const index = occurrence.get(number) ?? 0;
        occurrence.set(number, index + 1);
        const declaredPad = declaredByNumber.get(number)?.[index];
        const existingAt = child(pad, 'at');
        const declaredAt = declaredPad && child(declaredPad, 'at');
        if (!existingAt || !declaredAt) continue;
        const angle = atom(declaredAt, 3);
        if (angle === undefined) {
            if (existingAt.length >= 4) existingAt.splice(3, 1);
        } else if (existingAt.length >= 4) existingAt[3] = angle;
        else existingAt.push(angle);
    }
}

/** Visual-only regeneration from a framework snapshot. Keeps all native board
 * placement, pads, nets, copper, zones and mechanical contours intact. */
export function refreshBoardKeycapLegends(existingSource: string, generatedSource: string): string {
    const existing = SExpressionParser.parse(existingSource)[0] as Node;
    const generated = SExpressionParser.parse(generatedSource)[0] as Node;
    const byReference = new Map(
        children(generated, 'footprint').map((fp) => [referenceOf(fp), fp]),
    );
    for (const footprint of children(existing, 'footprint')) {
        const declared = byReference.get(referenceOf(footprint));
        if (declared) syncKeycapLegend(footprint, declared);
    }
    return `${SExpressionParser.serialize(existing)}\n`;
}
