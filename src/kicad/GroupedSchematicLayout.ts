import { groupClusters } from './GroupRelationships';
import type { SchematicPosition, SchematicRoutingOptions, SchematicNote } from '../synth/types';

export interface LayoutPin {
    number: string;
    x: number;
    y: number;
    rotation: number;
    net?: string;
    power?: boolean;
}
export interface LayoutPart {
    id: string;
    symbol: string;
    value: string;
    pins: LayoutPin[];
    body: { x: number; y: number; width: number; height: number };
}
export interface GroupFrame {
    id: string;
    title: string;
    members: string[];
    notes: SchematicNote[];
    titleBold?: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface GroupLayoutResult {
    positions: Map<string, SchematicPosition>;
    frames: GroupFrame[];
    paper: string;
    algorithm: 'circuit' | 'grid';
    estimatedWireLength: number;
    /** Parallel pull resistors sharing one rail, ordered by their device rows. */
    powerBanks?: string[][];
    refinement?: {
        passes: number;
        initialCost: number;
        finalCost: number;
        accepted: number;
        trials: Array<{
            pass: number;
            accepted: boolean;
            cost?: number;
            warnings?: string[];
            error?: string;
        }>;
        initial: { length: number; crossings: number; area: number; conventions: number };
        final: { length: number; crossings: number; area: number; conventions: number };
    };
}
type Box = { x: number; y: number; width: number; height: number };
// Native passive terminals commonly lie on the 50 mil grid (3.81 mm lead).
const grid = 1.27;
const snap = (x: number) => Math.round(x / grid) * grid;
const rotate = (p: { x: number; y: number }, rotation: number) => {
    const rad = (rotation * Math.PI) / 180;
    return {
        x: p.x * Math.cos(rad) - p.y * Math.sin(rad),
        y: -p.x * Math.sin(rad) - p.y * Math.cos(rad),
    };
};
const overlaps = (a: Box, b: Box) =>
    a.x < b.x + b.width - 0.001 &&
    b.x < a.x + a.width - 0.001 &&
    a.y < b.y + b.height - 0.001 &&
    b.y < a.y + a.height - 0.001;
const union = (boxes: Box[]): Box => {
    const x = Math.min(...boxes.map((b) => b.x)),
        y = Math.min(...boxes.map((b) => b.y));
    return {
        x,
        y,
        width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
        height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
    };
};
function envelope(
    part: LayoutPart,
    position: SchematicPosition,
    compact = false,
    probeHost = false,
    dense = false,
    compactSupply = false,
): Box {
    const r = position.rotation ?? 0;
    const corners = [
        { x: part.body.x, y: -part.body.y },
        { x: part.body.x + part.body.width, y: -part.body.y },
        { x: part.body.x, y: -part.body.y - part.body.height },
        { x: part.body.x + part.body.width, y: -part.body.y - part.body.height },
        ...part.pins,
    ].map((p) => rotate(p, r));
    const box = union(corners.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })));
    // Compact envelopes reserve real fields and escape lanes, rather than an empty
    // 25 mm band around every passive and probe.
    const label = Math.max(
        12.7,
        part.value.length * 0.7 + 5.08,
        ...part.pins.map((p) => (p.net?.length ?? 0) * 0.7 + 6.35),
    );
    const side =
        (dense || compactSupply) && part.pins.length === 2
            ? Math.max(7.62, part.value.length * 0.7 + 3.81)
            : probeHost
              ? 3.81
              : part.pins.length > 2
                ? label
                : part.pins.length === 1
                  ? 7.62
                  : Math.max(10.16, part.value.length * 0.7 + 5.08);
    const vertical =
        compactSupply && part.pins.length === 2
            ? 7.62
            : dense && part.pins.length === 2
              ? 3.81
              : probeHost
                ? 7.62
                : compact && part.pins.every((p) => !p.power)
                  ? part.pins.length <= 2
                      ? 7.62
                      : 12.7
                  : 12.7;
    return {
        x: position.x + box.x - side,
        y: position.y + box.y - vertical,
        width: box.width + side * 2,
        height: box.height + vertical * 2,
    };
}
const ground = (net: string | undefined) => /gnd|vss/i.test(net ?? '');
function absolute(pin: LayoutPin, position: SchematicPosition) {
    const p = rotate(pin, position.rotation ?? 0);
    return {
        x: position.x + p.x,
        y: position.y + p.y,
        rotation: (pin.rotation + (position.rotation ?? 0)) % 360,
    };
}

/** Deterministic group placement from symbol geometry and electrical nets; no board-reference templates. */
export function arrangeSchematicGroups(
    parts: LayoutPart[],
    options: NonNullable<SchematicRoutingOptions['autoLayout']>,
    paper = 'A4',
    feedback?: { wireLengths: Map<string, number>; pass: number },
): GroupLayoutResult {
    const byId = new Map(parts.map((p) => [p.id, p]));
    const seen = new Set<string>(),
        ids = new Set<string>();
    for (const group of options.groups) {
        if (!group.id || ids.has(group.id) || !group.components.length)
            throw new Error(`Invalid or duplicate schematic group '${group.id}'.`);
        ids.add(group.id);
        for (const id of group.components) {
            if (!byId.has(id) || seen.has(id))
                throw new Error(`Unknown or duplicate schematic group member '${id}'.`);
            seen.add(id);
        }
    }
    if (parts.some((p) => !seen.has(p.id)))
        throw new Error(
            `Automatic schematic groups must include every drawing: ${parts
                .filter((p) => !seen.has(p.id))
                .map((p) => p.id)
                .join(', ')}`,
        );
    const positions = new Map<string, SchematicPosition>(),
        frames: GroupFrame[] = [];
    const algorithm = options.algorithm ?? 'circuit';
    let estimatedWireLength = 0;
    const powerBanks: string[][] = [];
    for (const group of options.groups) {
        const members = group.components.map((id) => byId.get(id)!);
        const occupied: Box[] = [],
            placed: LayoutPart[] = [];
        const signalSides = new Map<string, number>();
        const connectivity = (a: LayoutPart, b: LayoutPart) =>
            a.pins.filter((p) => p.net && !p.power && b.pins.some((q) => q.net === p.net)).length;
        const root = [...members].sort(
            (a, b) => b.pins.length - a.pins.length || a.id.localeCompare(b.id),
        )[0];
        const remaining = members.filter((p) => p !== root);
        const bankCandidates = new Map<string, LayoutPart[]>();
        if ((feedback?.pass ?? 0) >= 4)
            for (const part of remaining) {
                const signal = part.pins.find((p) => !p.power && p.net),
                    rail = part.pins.find((p) => p.power);
                const host = root.pins.find(
                    (p) => p.net === signal?.net && !p.power && [0, 180].includes(p.rotation),
                );
                if (
                    !/^Device:R(?:_Small)?$/.test(part.symbol) ||
                    part.pins.length !== 2 ||
                    !signal ||
                    !rail ||
                    !host
                )
                    continue;
                const key = `${rail.net}/${host.rotation}`;
                bankCandidates.set(key, [...(bankCandidates.get(key) ?? []), part]);
            }
        const bankMembers = new Set<string>();
        for (const candidates of bankCandidates.values()) {
            const row = (part: LayoutPart) =>
                root.pins.find((p) => p.net === part.pins.find((q) => !q.power)?.net)!.y;
            const clusters: LayoutPart[][] = [];
            for (const part of [...candidates].sort(
                (a, b) => row(b) - row(a) || a.id.localeCompare(b.id),
            )) {
                const cluster = clusters[clusters.length - 1];
                if (!cluster || Math.abs(row(cluster[cluster.length - 1]) - row(part)) > 15.24)
                    clusters.push([part]);
                else cluster.push(part);
            }
            for (const bank of clusters)
                if (bank.length >= 3) {
                    bank.forEach((p) => bankMembers.add(p.id));
                    powerBanks.push(bank.map((p) => p.id));
                }
        }

        const partEnvelope = (part: LayoutPart, position: SchematicPosition) =>
            envelope(
                part,
                position,
                (feedback?.pass ?? 0) > 1,
                false,
                (feedback?.pass ?? 0) >= 4 && root.pins.length > 8,
                (feedback?.pass ?? 0) >= 4 && root.pins.length <= 8,
            );
        const put = (part: LayoutPart, wanted: SchematicPosition, row = false) => {
            const motif = (feedback?.pass ?? 0) >= 3;
            const shunt = part.pins.length === 2 && part.pins.filter((p) => p.power).length === 1;
            let best: SchematicPosition | undefined,
                cost = Infinity;
            const rotations =
                feedback && !row && part.pins.length === 2 && !(motif && shunt)
                    ? [...new Set([wanted.rotation ?? 0, 0, 90, 180, 270])]
                    : [wanted.rotation ?? 0];
            const step = 5.08;
            for (const rotation of rotations)
                for (let dx = -24; dx <= 24; dx++)
                    for (let dy = row ? 0 : -16; dy <= (row ? 0 : 16); dy++) {
                        const candidate = {
                            x: snap(wanted.x + dx * step),
                            y: snap(wanted.y + dy * step),
                            rotation,
                        };
                        const side = signalSides.get(part.id);
                        if (
                            (feedback?.pass ?? 0) >= 4 &&
                            side &&
                            part.pins.length <= 2 &&
                            side * (candidate.x - positions.get(root.id)!.x) <
                                root.body.width / 2 + 10.16
                        )
                            continue;
                        if (
                            occupied.some((b, index) =>
                                overlaps(
                                    partEnvelope(part, candidate),
                                    (feedback?.pass ?? 0) > 1 &&
                                        (part.pins.length === 1 ||
                                            ((feedback?.pass ?? 0) >= 4 && shunt)) &&
                                        placed[index].pins.length > 2
                                        ? envelope(
                                              placed[index],
                                              positions.get(placed[index].id)!,
                                              true,
                                              true,
                                          )
                                        : b,
                                ),
                            )
                        )
                            continue;
                        let score =
                            (Math.abs(candidate.x - wanted.x) +
                                Math.abs(candidate.y - wanted.y) * 1.2) *
                            (feedback ? 0.15 : 1);
                        if (feedback) {
                            for (const pin of part.pins.filter((p) => p.net && !p.power)) {
                                const target = absolute(pin, candidate);
                                const anchors = placed.flatMap((owner) =>
                                    owner.pins
                                        .filter((p) => p.net === pin.net)
                                        .map((p) => absolute(p, positions.get(owner.id)!)),
                                );
                                if (anchors.length) {
                                    const weight =
                                        1 +
                                        Math.min(3, (feedback.wireLengths.get(pin.net!) ?? 0) / 40);
                                    score +=
                                        weight *
                                        Math.min(
                                            ...anchors.map(
                                                (a) =>
                                                    Math.abs(target.x - a.x) +
                                                    Math.abs(target.y - a.y),
                                            ),
                                        );
                                }
                            }
                            score += rotation === (wanted.rotation ?? 0) ? 0 : 2.54;
                        }
                        if (score < cost) {
                            cost = score;
                            best = candidate;
                        }
                    }
            if (!best)
                throw new Error(
                    `Unable to arrange ${part.id} in group '${group.id}'. Split a very dense group.`,
                );
            positions.set(part.id, best);
            occupied.push(partEnvelope(part, best));
            placed.push(part);
        };
        put(root, { x: 0, y: 0 });
        let powerX: number | undefined, powerY: number | undefined;
        while (remaining.length) {
            remaining.sort(
                (a, b) =>
                    Math.max(...placed.map((p) => connectivity(b, p))) -
                        Math.max(...placed.map((p) => connectivity(a, p))) ||
                    ((feedback?.pass ?? 0) > 1
                        ? Number(b.pins.length === 1) - Number(a.pins.length === 1)
                        : 0) ||
                    b.pins.length - a.pins.length ||
                    a.id.localeCompare(b.id),
            );
            const part = remaining.shift()!;
            if (algorithm === 'grid') {
                const index = placed.length,
                    columns = Math.ceil(Math.sqrt(members.length));
                const rail =
                    part.pins.find((pin) => pin.power && ground(pin.net)) ??
                    part.pins.find((pin) => pin.power);
                const rotation =
                    part.pins.length === 2 && rail
                        ? ((ground(rail.net) ? 90 : 270) - rail.rotation + 360) % 360
                        : 0;
                put(part, {
                    x: (index % columns) * 76.2,
                    y: Math.floor(index / columns) * 76.2,
                    rotation,
                });
                continue;
            }
            const links = placed.flatMap((owner) =>
                owner.pins
                    .filter((p) => p.net && !p.power)
                    .flatMap((anchor) =>
                        part.pins
                            .filter((pin) => pin.net === anchor.net)
                            .map((pin) => ({ owner, anchor, pin })),
                    ),
            );
            const link = links.sort(
                (a, b) =>
                    b.owner.pins.length - a.owner.pins.length ||
                    a.anchor.number.localeCompare(b.anchor.number),
            )[0];
            if (link) {
                const host = absolute(link.anchor, positions.get(link.owner.id)!);
                const side =
                    link.owner.pins.length > 2 && [0, 180].includes(host.rotation)
                        ? host.rotation === 0
                            ? -1
                            : 1
                        : signalSides.get(link.owner.id);
                if (side) signalSides.set(part.id, side);
            }
            if (link && bankMembers.has(part.id)) {
                // A bank reads as parallel horizontal resistors ending on one
                // shared supply column, rather than crossing adjacent GPIO rows.
                const host = absolute(link.anchor, positions.get(link.owner.id)!);
                const out = host.rotation === 0 ? -1 : 1;
                const rotation = (host.rotation + 180 - link.pin.rotation + 360) % 360;
                const local = rotate(link.pin, rotation);
                const position = {
                    x: snap(host.x + out * 35.56 - local.x),
                    y: snap(host.y - local.y),
                    rotation,
                };
                positions.set(part.id, position);
                occupied.push(partEnvelope(part, position));
                placed.push(part);
                continue;
            }
            if ((feedback?.pass ?? 0) >= 3 && part.pins.length === 1 && link) {
                // Zero-length probe pins are junction ornaments, not separate branches.
                const host = absolute(link.anchor, positions.get(link.owner.id)!);
                const angle = (host.rotation + 180) % 360,
                    rad = (angle * Math.PI) / 180;
                const local = rotate(link.pin, 0);
                positions.set(part.id, {
                    x: snap(host.x + Math.cos(rad) * 5.08 - local.x),
                    y: snap(host.y - Math.sin(rad) * 5.08 - local.y),
                    rotation: 0,
                });
                occupied.push(partEnvelope(part, positions.get(part.id)!));
                placed.push(part);
                continue;
            }
            if (
                !link &&
                (feedback?.pass ?? 0) >= 4 &&
                members.every((p) => /^Connector/.test(p.symbol))
            ) {
                // Independent interface connectors form an upright column; a power-only
                // connector is not a decoupling capacitor to scatter across the supply row.
                const rootBox = partEnvelope(root, positions.get(root.id)!);
                const localBox = partEnvelope(part, { x: 0, y: 0, rotation: 0 });
                put(
                    part,
                    {
                        x: positions.get(root.id)!.x,
                        y: rootBox.y - 15.24 - localBox.y - localBox.height,
                        rotation: 0,
                    },
                    true,
                );
                continue;
            }
            if (!link) {
                // Power-only decoupling belongs near the dominant device, in a supply row.
                const rootBox = partEnvelope(root, positions.get(root.id)!);
                powerX ??= rootBox.x;
                powerY ??= rootBox.y - 17.78;
                const lowPin = part.pins.find((p) => ground(p.net));
                const orientation =
                    lowPin && part.pins.length === 2 ? (90 - lowPin.rotation + 360) % 360 : 0;
                put(part, { x: powerX, y: powerY, rotation: orientation }, true);
                const placedBox = partEnvelope(part, positions.get(part.id)!);
                powerX = placedBox.x + placedBox.width + 10.16;

                continue;
            }
            const anchor = absolute(link.anchor, positions.get(link.owner.id)!);
            const angle = (anchor.rotation + 180) % 360,
                rad = (angle * Math.PI) / 180;
            const out = { x: Math.cos(rad), y: -Math.sin(rad) };
            let rotation = (angle - link.pin.rotation + 360) % 360;
            let terminal = {
                x: anchor.x + out.x * (part.pins.length === 1 ? 12.7 : 15.24),
                y: anchor.y + out.y * (part.pins.length === 1 ? 12.7 : 15.24),
            };
            const supply = part.pins.find((p) => p.power && p !== link.pin);
            if (part.pins.length === 2 && supply && Math.abs(out.x) > 0.5) {
                // Shunt capacitors and pull resistors read vertically: supply above, ground below.
                const down = ground(supply.net);
                rotation = ((down ? 270 : 90) - link.pin.rotation + 360) % 360;
                terminal = {
                    x: anchor.x + out.x * 20.32,
                    y:
                        anchor.y +
                        out.y * 20.32 +
                        (Math.abs(out.x) > 0.5 ? (down ? 12.7 : -12.7) : 0),
                };
            }
            if (
                part.pins.length > 2 ||
                !/^(Device:|Jumper:|TestPoint:|Connector:TestPoint)/.test(part.symbol)
            )
                rotation = 0;
            if (part.pins.length === 1) rotation = 0;
            const aligned =
                (feedback?.pass ?? 0) >= 3 &&
                part.pins.length === 2 &&
                !!supply &&
                Math.abs(out.x) > 0.5;
            if (aligned) terminal.y = anchor.y;
            const local = rotate(link.pin, rotation);
            put(part, { x: terminal.x - local.x, y: terminal.y - local.y, rotation }, aligned);
        }
        const bounds = union(members.map((p) => partEnvelope(p, positions.get(p.id)!)));
        const padding = algorithm === 'grid' ? 10.16 : 5.08,
            titleHeight = algorithm === 'grid' ? 10.16 : 7.62;
        const notes = (group.notes ?? []).flatMap((note) => {
            const value = typeof note === 'string' ? { text: note } : note;
            return value.text.split('\n').map((text) => ({ ...value, text }));
        });
        const noteWidth = Math.max(0, ...notes.map((n) => n.text.length * (n.bold ? 0.88 : 0.8)));
        const width = Math.max(
            bounds.width + padding * 2,
            noteWidth + padding * 2,
            group.title.length * 1.2 + padding * 2,
        );
        const height =
            bounds.height +
            padding * 2 +
            titleHeight +
            (notes.length ? notes.length * 3.175 + 7.62 : 0);
        for (const part of members) {
            const p = positions.get(part.id)!;
            positions.set(part.id, {
                ...p,
                x: snap(p.x - bounds.x + padding),
                y: snap(p.y - bounds.y + padding + titleHeight),
            });
        }
        frames.push({
            id: group.id,
            title: group.title,
            members: group.components,
            notes,
            titleBold: group.titleBold ?? true,
            x: 0,
            y: 0,
            width: Math.ceil(width / grid) * grid,
            height: Math.ceil(height / grid) * grid,
        });
        const nets = new Set(
            members.flatMap((p) =>
                p.pins
                    .filter((pin) => !pin.power)
                    .map((pin) => pin.net)
                    .filter(Boolean),
            ),
        );
        for (const net of nets) {
            const terminals = members.flatMap((p) =>
                p.pins
                    .filter((pin) => pin.net === net)
                    .map((pin) => absolute(pin, positions.get(p.id)!)),
            );
            if (terminals.length > 1)
                estimatedWireLength +=
                    Math.max(...terminals.map((p) => p.x)) -
                    Math.min(...terminals.map((p) => p.x)) +
                    Math.max(...terminals.map((p) => p.y)) -
                    Math.min(...terminals.map((p) => p.y));
        }
    }
    const sheets = [
        ['A4', 297, 210],
        ['A3', 420, 297],
        ['A2', 594, 420],
        ['A1', 841, 594],
        ['A0', 1189, 841],
    ] as const;
    const start = Math.max(
        0,
        sheets.findIndex((s) => s[0] === paper),
    );
    const clusters = groupClusters(frames, options.groups);
    let selected = sheets[start];
    let packed = false;
    for (const sheet of sheets.slice(start)) {
        const left = 15.24,
            top = options.topMargin ?? 15.24,
            gap = 5.08;
        const trial: Array<{ x: number; y: number }> = [];
        const packingOrder = [...clusters].sort((a, b) => b.height - a.height || b.width - a.width);
        const trialFrames = new Map<GroupFrame, { x: number; y: number }>();
        const occupied: Box[] = [];
        for (const cluster of packingOrder) {
            // Fill free columns as well as rows; a shelf would waste the space
            // below a short group beside a taller controller/notes block.
            const xs = [left, ...occupied.map((b) => b.x + b.width + gap)];
            const ys = [top, ...occupied.map((b) => b.y + b.height + gap)];
            const candidates = ys
                .flatMap((y) =>
                    xs.map((x) => ({ x, y, width: cluster.width, height: cluster.height })),
                )
                .filter(
                    (box) =>
                        box.x + box.width <= sheet[1] - 15.24 &&
                        box.y + box.height <= sheet[2] - 55.88 &&
                        occupied.every(
                            (b) =>
                                !overlaps(box, {
                                    x: b.x - gap,
                                    y: b.y - gap,
                                    width: b.width + gap * 2,
                                    height: b.height + gap * 2,
                                }),
                        ),
                )
                .sort((a, b) => a.y - b.y || a.x - b.x);
            const box = candidates[0];
            if (!box) break;
            for (const member of cluster.offsets)
                trialFrames.set(member.frame, { x: box.x + member.x, y: box.y + member.y });
            occupied.push(box);
        }
        if (trialFrames.size !== frames.length) continue;
        frames.forEach((frame) => trial.push(trialFrames.get(frame)!));
        if (
            frames.every(
                (f, i) =>
                    trial[i].x + f.width <= sheet[1] - 15.24 &&
                    trial[i].y + f.height <= sheet[2] - 55.88,
            )
        ) {
            frames.forEach((frame, i) => Object.assign(frame, trial[i]));
            selected = sheet;
            packed = true;
            break;
        }
    }
    if (!packed)
        throw new Error('Automatic schematic groups exceed A0. Split the circuit into sheets.');
    for (const frame of frames)
        for (const id of frame.members) {
            const p = positions.get(id)!;
            positions.set(id, { ...p, x: p.x + frame.x, y: p.y + frame.y });
        }
    return { positions, frames, paper: selected[0], algorithm, estimatedWireLength, powerBanks };
}
