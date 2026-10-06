import { SExpressionParser as Parser, type SExpr } from './SExpressionParser';

type Node = SExpr[];
type Point = { x: number; y: number };
type Box = Point & { width: number; height: number; owner: string; wireCheck?: boolean };
const children = (node: Node, key: string): Node[] =>
    node.filter((item): item is Node => Array.isArray(item) && item[0] === key);
const child = (node: Node, key: string) => children(node, key)[0];
const atom = (node: Node | undefined, index: number): string => {
    const value = String(node?.[index] ?? '');
    if (value.startsWith('"')) {
        try {
            return JSON.parse(value);
        } catch {
            /* KiCad string fallback. */
        }
    }
    return Parser.unquote(value);
};
const xy = (node: Node): Point => ({ x: Number(node[1]), y: Number(node[2]) });
const overlaps = (a: Box, b: Box) =>
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.15 &&
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.15;
function bounds(points: Point[], owner: string): Box {
    const x = Math.min(...points.map((p) => p.x)),
        y = Math.min(...points.map((p) => p.y));
    return {
        x,
        y,
        width: Math.max(...points.map((p) => p.x)) - x,
        height: Math.max(...points.map((p) => p.y)) - y,
        owner,
    };
}
function hits(a: Point, b: Point, box: Box) {
    const margin = 0.15;
    if (Math.abs(a.x - b.x) < 1e-4)
        return (
            a.x > box.x + margin &&
            a.x < box.x + box.width - margin &&
            Math.max(a.y, b.y) > box.y + margin &&
            Math.min(a.y, b.y) < box.y + box.height - margin
        );
    if (Math.abs(a.y - b.y) < 1e-4)
        return (
            a.y > box.y + margin &&
            a.y < box.y + box.height - margin &&
            Math.max(a.x, b.x) > box.x + margin &&
            Math.min(a.x, b.x) < box.x + box.width - margin
        );
    return false;
}
function textBox(node: Node, owner: string, rotation = 0): Box | undefined {
    const effects = child(node, 'effects') ?? [],
        font = child(effects, 'font') ?? [];
    if (effects.some((item) => item === 'hide') || child(effects, 'hide')?.[1] === 'yes') return;
    const text = atom(node, node[0] === 'property' ? 2 : 1);
    if (!text) return;
    const at = child(node, 'at');
    if (!at) return;
    const size = Number(child(font, 'size')?.[1] ?? 1.27),
        lines = text.split('\n');
    // Conservative stroke-font estimate, not a substitute for native visual review.
    let width = Math.max(...lines.map((line) => line.length)) * size * 0.6,
        height = size * (1 + (lines.length - 1) * 1.5);
    const angle = (Number(at[3] ?? 0) + rotation) % 180;
    if (Math.abs(angle) === 90) [width, height] = [height, width];
    const justify = child(effects, 'justify') ?? [];
    let left = justify.includes('left'),
        right = justify.includes('right');
    if ((Number(at[3] ?? 0) + rotation) % 360 === 180) [left, right] = [right, left];
    return {
        x: Number(at[1]) - (left ? 0 : right ? width : width / 2),
        y: Number(at[2]) - (justify.includes('top') ? 0 : height / 2),
        width,
        height,
        owner,
    };
}

/** Heuristic diagnostics for visible drawing collisions. Does not change circuit
 * connectivity, reject legitimate wire crossings, or claim publication quality. */
export function schematicReadabilityWarnings(
    root: Node,
    options: { embeddedValues?: ReadonlySet<string> } = {},
): string[] {
    const texts: Box[] = [],
        bodies: Box[] = [],
        legs: Array<{ a: Point; b: Point; owner: string }> = [];
    const libraries = new Map(
        children(child(root, 'lib_symbols') ?? [], 'symbol').map((node) => [atom(node, 1), node]),
    );
    for (const instance of children(root, 'symbol')) {
        const properties = children(instance, 'property');
        const ref = atom(
            properties.find((p) => atom(p, 1) === 'Reference'),
            2,
        );
        const owner = ref.startsWith('#PWR')
            ? `${ref} (${atom(
                  properties.find((p) => atom(p, 1) === 'Value'),
                  2,
              )})`
            : `${ref}/${atom(child(instance, 'unit'), 1)}`;
        const at = child(instance, 'at');
        if (!at) continue;
        const rotation = Number(at[3] ?? 0),
            radians = (rotation * Math.PI) / 180;
        const transform = (p: Point): Point => ({
            x: Number(at[1]) + p.x * Math.cos(radians) - p.y * Math.sin(radians),
            y: Number(at[2]) - p.x * Math.sin(radians) - p.y * Math.cos(radians),
        });
        for (const property of properties) {
            const box = textBox(property, `${owner}.${atom(property, 1)}`, rotation);
            if (box) texts.push(box);
        }
        const definition = libraries.get(atom(child(instance, 'lib_id'), 1));
        if (!definition) continue;
        const unit = Number(atom(child(instance, 'unit'), 1) || 1),
            points: Point[] = [];
        const collect = (node: SExpr): void => {
            if (!Array.isArray(node)) return;
            if (node[0] === 'symbol') {
                const match = atom(node, 1).match(/_(\d+)_\d+$/);
                if (match && Number(match[1]) !== 0 && Number(match[1]) !== unit) return;
            }
            if (node[0] === 'rectangle' || node[0] === 'polyline') {
                const vertices =
                    node[0] === 'rectangle'
                        ? [child(node, 'start'), child(node, 'end')]
                        : children(child(node, 'pts') ?? [], 'xy');
                for (const p of vertices) if (p) points.push(transform(xy(p)));
            } else if (node[0] === 'circle') {
                const center = child(node, 'center'),
                    radius = Number(child(node, 'radius')?.[1]);
                if (center) {
                    const p = transform(xy(center));
                    points.push(
                        { x: p.x - radius, y: p.y - radius },
                        { x: p.x + radius, y: p.y + radius },
                    );
                }
            } else if (node[0] === 'pin') {
                const p = child(node, 'at');
                if (!p) return;
                const angle = (Number(p[3]) * Math.PI) / 180,
                    length = Number(child(node, 'length')?.[1] ?? 0);
                const a = xy(p),
                    b = { x: a.x + Math.cos(angle) * length, y: a.y + Math.sin(angle) * length };
                if (length > 0)
                    legs.push({
                        a: transform(a),
                        b: transform(b),
                        owner: `${owner}.pin${atom(child(node, 'number'), 1)}`,
                    });
            } else node.forEach(collect);
        };
        collect(definition);
        if (points.length) bodies.push(bounds(points, owner));
    }
    children(root, 'text').forEach((node, index) => {
        const box = textBox(node, `note${index + 1}`);
        if (box) texts.push(box);
    });
    // Global-label text lies beyond its connection anchor. The labelled wire is
    // intentionally attached there, so test text/symbol collisions but not its own wire.
    for (const label of children(root, 'global_label')) {
        const at = child(label, 'at');
        if (!at) continue;
        const effects = child(label, 'effects') ?? [],
            font = child(effects, 'font') ?? [];
        const size = Number(child(font, 'size')?.[1] ?? 1.27),
            length = atom(label, 1).length * size * 0.6 + 1.27;
        const point = xy(at),
            angle = Number(at[3] ?? 0),
            horizontal = angle % 180 === 0;
        texts.push({
            x: horizontal
                ? angle === 180
                    ? point.x - length - 1.27
                    : point.x + 1.27
                : point.x - size / 2,
            y: horizontal
                ? point.y - size / 2
                : angle === 90
                  ? point.y - length - 1.27
                  : point.y + 1.27,
            width: horizontal ? length : size,
            height: horizontal ? size : length,
            owner: `label:${atom(label, 1)}@${point.x},${point.y}`,
            wireCheck: false,
        });
    }
    const warnings = new Set<string>();
    const location = (box: Point) => `near (${box.x.toFixed(2)}, ${box.y.toFixed(2)}) mm`;
    for (let i = 0; i < texts.length; i++) {
        const text = texts[i];
        for (const body of bodies)
            if (
                overlaps(text, body) &&
                !(
                    text.owner === `${body.owner}.Value` &&
                    options.embeddedValues?.has(body.owner.split('/')[0])
                )
            )
                warnings.add(
                    `SCHEMATIC_TEXT_SYMBOL_OVERLAP ${text.owner} intersects ${body.owner} ${location(text)}; move its field or symbol.`,
                );
        for (const other of texts.slice(i + 1))
            if (overlaps(text, other))
                warnings.add(
                    `SCHEMATIC_TEXT_OVERLAP ${text.owner} intersects ${other.owner} ${location(text)}; separate visible fields.`,
                );
    }
    for (const wire of children(root, 'wire')) {
        const pts = children(child(wire, 'pts') ?? [], 'xy');
        if (pts.length !== 2) continue;
        const [a, b] = pts.map(xy);
        for (const text of texts)
            if (text.wireCheck !== false && hits(a, b, text))
                warnings.add(
                    `SCHEMATIC_WIRE_TEXT_OVERLAP wire crosses ${text.owner} ${location(text)}; move the field or wire.`,
                );
        for (const leg of legs) {
            const horizontal = Math.abs(leg.a.y - leg.b.y) < 1e-4;
            if (
                (horizontal &&
                    Math.abs(a.x - b.x) < 1e-4 &&
                    a.x > Math.min(leg.a.x, leg.b.x) + 0.15 &&
                    a.x < Math.max(leg.a.x, leg.b.x) - 0.15 &&
                    leg.a.y > Math.min(a.y, b.y) + 0.15 &&
                    leg.a.y < Math.max(a.y, b.y) - 0.15) ||
                (!horizontal &&
                    Math.abs(a.y - b.y) < 1e-4 &&
                    a.y > Math.min(leg.a.y, leg.b.y) + 0.15 &&
                    a.y < Math.max(leg.a.y, leg.b.y) - 0.15 &&
                    leg.a.x > Math.min(a.x, b.x) + 0.15 &&
                    leg.a.x < Math.max(a.x, b.x) - 0.15)
            )
                warnings.add(
                    `SCHEMATIC_PIN_WIRE_CROSSING wire crosses the interior of ${leg.owner} ${location(leg.a)}; separate the pin fanout.`,
                );
        }
    }
    return [...warnings];
}
