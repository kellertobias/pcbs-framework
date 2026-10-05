import { bentSheetMesh } from '../synth/3d/bentSheet';
import fs from 'node:fs';
import * as THREE from 'three';
import polygonClipping, { type Polygon, type MultiPolygon } from 'polygon-clipping';
import { SExpressionParser, type SExpr } from '../kicad/SExpressionParser';
import type { FrontPanelCutout } from '../frontpanel/types';
import type { AssemblyBoard, AssemblyFrontPanel, AssemblyPlacement } from '../synth/Assembly';
import { Kicad3DModel } from '../synth/3d/Kicad3DModel';
import { parseHexColor } from '../synth/3d/types';

const child = (n: SExpr[], key: string) =>
    n.find((v): v is SExpr[] => Array.isArray(v) && v[0] === key);
const atom = (v: SExpr | undefined) => (typeof v === 'string' ? SExpressionParser.unquote(v) : '');
export { placementMatrix } from './transforms';
import { placementMatrix } from './transforms';
/** Curves are sampled to a maximum 0.01 mm chord error for the visualization mesh. */
function arc(
    cx: number,
    cy: number,
    radius: number,
    start: number,
    sweep: number,
): [number, number][] {
    const count = Math.max(
        2,
        Math.ceil(
            Math.abs(sweep) / (2 * Math.acos(1 - Math.min(0.01 / Math.max(radius, 0.01), 1))),
        ),
    );
    return Array.from({ length: count + 1 }, (_, i) => [
        cx + radius * Math.cos(start + (sweep * i) / count),
        cy + radius * Math.sin(start + (sweep * i) / count),
    ]);
}
function contour(c: FrontPanelCutout): [number, number][] {
    if (c.type === 'circle') return arc(c.x ?? 0, c.y ?? 0, c.diameter / 2, 0, Math.PI * 2);
    let points: [number, number][];
    if (c.type === 'polygon') points = c.points.map((p) => [p.x, p.y]);
    else {
        const r = Math.max(0, Math.min(c.radius ?? 0, c.width / 2, c.height / 2));
        const x = c.width / 2 - r,
            y = c.height / 2 - r;
        points = [
            [x, y, 0],
            [-x, y, Math.PI / 2],
            [-x, -y, Math.PI],
            [x, -y, Math.PI * 1.5],
        ].flatMap(([cx, cy, start]) => arc(cx, cy, r, start, Math.PI / 2));
    }
    const a = -THREE.MathUtils.degToRad(c.rotation ?? 0);
    return points.map(([x, y]) => [
        x * Math.cos(a) - y * Math.sin(a) + ('x' in c ? (c.x ?? 0) : 0),
        x * Math.sin(a) + y * Math.cos(a) + ('y' in c ? (c.y ?? 0) : 0),
    ]);
}
export interface PanelBoardSource {
    part: AssemblyBoard;
    file: string;
    references?: string[];
    worldMatrix?: THREE.Matrix4;
}
export function projectPanelCutouts(
    panel: AssemblyFrontPanel,
    sources: PanelBoardSource[],
    panelWorldMatrix = placementMatrix(panel),
): [number, number][][] {
    const inverse = panelWorldMatrix.clone().invert();
    const output: [number, number][][] = [];
    for (const source of sources) {
        const pcb = SExpressionParser.parse(fs.readFileSync(source.file, 'utf8')).find(
            (v): v is SExpr[] => Array.isArray(v) && v[0] === 'kicad_pcb',
        );
        if (!pcb) throw new Error('Invalid PCB for panel projection');
        const thickness = Number(atom(child(child(pcb, 'general') ?? [], 'thickness')?.[1]));
        if (!Number.isFinite(thickness) || thickness <= 0)
            throw new Error('PCB thickness missing for panel projection');
        const transform = inverse
            .clone()
            .multiply(source.worldMatrix ?? placementMatrix(source.part));
        const direction = new THREE.Vector3(0, 0, 1).transformDirection(transform);
        if (Math.abs(direction.z) < 1e-8)
            throw new Error(
                `Board ${source.part.id} is parallel to the panel projection direction`,
            );
        const found = new Set<string>();
        for (const footprint of pcb.filter(
            (v): v is SExpr[] => Array.isArray(v) && v[0] === 'footprint',
        )) {
            const properties = footprint.filter(
                (v): v is SExpr[] => Array.isArray(v) && v[0] === 'property',
            );
            const ref = atom(properties.find((p) => atom(p[1]) === 'Reference')?.[2]);
            if (source.references && !source.references.includes(ref)) continue;
            const metadata = atom(properties.find((p) => atom(p[1]) === 'FrontPanelCutouts')?.[2]);
            if (!metadata) continue;
            found.add(ref);
            const cuts = JSON.parse(metadata) as FrontPanelCutout[];
            const at = child(footprint, 'at');
            const angle = -THREE.MathUtils.degToRad(Number(atom(at?.[3])) || 0);
            const mirror = atom(child(footprint, 'layer')?.[1]) === 'B.Cu' ? -1 : 1;
            for (const cut of cuts) {
                const points = contour(cut).map(([cx, cy]) => {
                    const x = cx * mirror,
                        y = cy;
                    const p = new THREE.Vector3(
                        Number(atom(at?.[1])) +
                            x * Math.cos(angle) -
                            y * Math.sin(angle) -
                            (source.part.origin?.[0] ?? 0),
                        -(
                            Number(atom(at?.[2])) +
                            x * Math.sin(angle) +
                            y * Math.cos(angle) -
                            (source.part.origin?.[1] ?? 0)
                        ),
                        thickness / 2,
                    ).applyMatrix4(transform);
                    p.addScaledVector(direction, ((panel.offset ?? 0) - p.z) / direction.z);
                    return [p.x, p.y] as [number, number];
                });
                if (points.some((p) => !p.every(Number.isFinite)))
                    throw new Error(`Invalid cutout on ${ref}`);
                output.push(points);
            }
        }
        if (source.references?.some((ref) => !found.has(ref)))
            throw new Error(`Selected cutout references missing on ${source.part.id}`);
    }
    if (!output.length) throw new Error(`No front-panel cutouts found for ${panel.id}`);
    return output;
}
export function buildPanelModel(
    panel: AssemblyFrontPanel,
    cuts: [number, number][][],
): { model: Kicad3DModel; polygons: MultiPolygon } {
    // Stabilize coincident edges from rotations and repeated footprint corners.
    // The 0.000001 mm grid is far below the 0.01 mm curve sampling tolerance.
    const clean = (ring: [number, number][]) =>
        ring
            .map(
                ([x, y]) =>
                    [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6] as [number, number],
            )
            .filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]);
    // Boolean subtraction handles overlapping openings and openings crossing the plate edge.
    const polygons = polygonClipping.difference(
        [clean(panel.outline)] as Polygon,
        ...[...cuts, ...(panel.cutouts ?? [])].map((c) => [clean(c)] as Polygon),
    );
    if (!polygons.length) throw new Error('Front panel cutouts remove the entire plate');
    const model = new Kicad3DModel();
    const reliefs = panel.reliefs ?? [];
    const levels = [...new Set([0, ...reliefs.map((r) => r.depth), panel.thickness])].sort(
        (a, b) => a - b,
    );
    const layers = levels.slice(0, -1).map((z, i) => ({
        z,
        top: levels[i + 1],
        polygons: polygonClipping.difference(
            polygons,
            ...reliefs.filter((r) => r.depth > z).map((r) => [clean(r.outline)] as Polygon),
        ),
    }));
    // Keep only exposed caps: internal horizontal layer faces would overlap.
    const emit = (
        regions: MultiPolygon,
        z: number,
        depth: number,
        bottom: boolean,
        top: boolean,
        sides: boolean,
    ) => {
        for (const polygon of regions) {
            const shape = new THREE.Shape(polygon[0].map(([x, y]) => new THREE.Vector2(x, y)));
            shape.holes = polygon
                .slice(1)
                .map((ring) => new THREE.Path(ring.map(([x, y]) => new THREE.Vector2(x, y))));
            const geometry = new THREE.ExtrudeGeometry(shape, {
                depth,
                bevelEnabled: false,
                steps: 1,
            });
            const positions = geometry.getAttribute('position');
            const vertices: { x: number; y: number; z: number }[] = [],
                triangles: [number, number, number][] = [];
            for (let i = 0; i < positions.count; i += 3) {
                const zs = [0, 1, 2].map((j) => positions.getZ(i + j));
                const atBottom = zs.every((v) => Math.abs(v) < 1e-6),
                    atTop = zs.every((v) => Math.abs(v - depth) < 1e-6);
                if (atBottom ? !bottom : atTop ? !top : !sides) continue;
                const start = vertices.length;
                for (let j = 0; j < 3; j++)
                    vertices.push({
                        x: positions.getX(i + j),
                        y: positions.getY(i + j),
                        z: positions.getZ(i + j) + z + (panel.offset ?? 0),
                    });
                triangles.push([start, start + 1, start + 2]);
            }
            model.mesh({
                vertices,
                triangles,
                color: parseHexColor(panel.color ?? '#c6ced6'),
                name: panel.name ?? panel.id,
            });
            geometry.dispose();
        }
    };
    layers.forEach((layer, i) => {
        emit(layer.polygons, layer.z, layer.top - layer.z, i === 0, i === layers.length - 1, true);
        if (i > 0) {
            const seats = polygonClipping.difference(layer.polygons, layers[i - 1].polygons);
            emit(seats, layer.z, 1, true, false, false);
        }
    });
    const xs = panel.outline.map((p) => p[0]);
    for (const fold of panel.folds ?? [])
        model.mesh({
            ...bentSheetMesh({
                xMin: Math.min(...xs),
                xMax: Math.max(...xs),
                path: fold.path,
                thickness: panel.thickness,
                insideRadius: fold.insideRadius,
            }),
            color: parseHexColor(panel.color ?? '#c6ced6'),
            name: fold.name ?? 'fold',
        });
    return { model, polygons };
}
/** Dimensioned local XY contours retained alongside the visual model. */
export function panelSVG(polygons: MultiPolygon): string {
    const points = polygons.flat(2);
    const xs = points.map((p) => p[0]),
        ys = points.map((p) => p[1]);
    const x = Math.min(...xs),
        y = Math.min(...ys),
        w = Math.max(...xs) - x,
        h = Math.max(...ys) - y;
    const d = polygons
        .flatMap((p) => p.map((r) => `M${r.map(([px, py]) => `${px},${py}`).join('L')}Z`))
        .join(' ');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="${x} ${-y - h} ${w} ${h}"><path transform="scale(1,-1)" d="${d}" fill="#c6ced6" fill-rule="evenodd" stroke="black" stroke-width="0.1"/></svg>`;
}

export function panelDXF(polygons: MultiPolygon): string {
    const lines: (string | number)[] = [
        0,
        'SECTION',
        2,
        'HEADER',
        9,
        '$INSUNITS',
        70,
        4,
        0,
        'ENDSEC',
        0,
        'SECTION',
        2,
        'ENTITIES',
    ];
    for (const polygon of polygons)
        for (const [index, ring] of polygon.entries()) {
            const points = ring.slice(0, -1);
            lines.push(
                0,
                'LWPOLYLINE',
                100,
                'AcDbEntity',
                8,
                index === 0 ? 'OUTLINE' : 'CUTOUT',
                100,
                'AcDbPolyline',
                90,
                points.length,
                70,
                1,
            );
            for (const [x, y] of points) lines.push(10, x, 20, y);
        }
    lines.push(0, 'ENDSEC', 0, 'EOF');
    return lines.join('\n') + '\n';
}
