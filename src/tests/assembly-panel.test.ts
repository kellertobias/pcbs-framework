import fs from 'node:fs';
import { Vector3 } from 'three';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPanelModel, projectPanelCutouts, panelDXF, panelSVG } from '../assembly/front-panel';
import { assemblyWorldMatrix } from '../assembly/transforms';
import { Assembly, type AssemblyFrontPanel } from '../synth/Assembly';
const panel: AssemblyFrontPanel = {
    kind: 'front-panel',
    id: 'plate',
    sources: ['board'],
    outline: [
        [-20, -20],
        [20, -20],
        [20, 20],
        [-20, 20],
    ],
    thickness: 2,
};
function fixture(layer = 'F.Cu', angle = 0) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-projection-'));
    const file = path.join(dir, 'board.kicad_pcb');
    const metadata = JSON.stringify(JSON.stringify([{ type: 'circle', x: 3, y: 4, diameter: 4 }]));
    fs.writeFileSync(
        file,
        `(kicad_pcb (general (thickness 1.6)) (footprint "test" (layer "${layer}") (at 10 20 ${angle}) (property "Reference" "J1") (property "FrontPanelCutouts" ${metadata})))`,
    );
    return { dir, file };
}
describe('assembly projected front plates', () => {
    it('adds mechanical fixing holes to the same rendered and exported plate', () => {
        const hole: [number, number][] = [
            [-2, -2],
            [2, -2],
            [2, 2],
            [-2, 2],
        ];
        const result = buildPanelModel({ ...panel, cutouts: [hole] }, []);
        expect(result.polygons[0]).toHaveLength(2);
        expect(panelSVG(result.polygons)).toContain('M-2,-2');
        expect(panelDXF(result.polygons)).toContain('CUTOUT');
        expect(() =>
            new Assembly({ name: 'bad' }).addFrontPanel({ ...panel, cutouts: [[[0, 0]]] }),
        ).toThrow('mechanical cutout');
    });
    it('projects PCB origin, back-side reflection and KiCad rotation in assembly coordinates', () => {
        const { dir, file } = fixture('B.Cu', 90);
        try {
            const cuts = projectPanelCutouts({ ...panel, offset: 12 }, [
                {
                    file,
                    part: {
                        kind: 'board',
                        id: 'board',
                        file,
                        origin: [10, 20],
                        position: [1, 2, 3],
                    },
                },
            ]);
            const xs = cuts[0].map((p) => p[0]),
                ys = cuts[0].map((p) => p[1]);
            expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(5, 2);
            expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(-1, 2);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('keeps cutouts aligned when a board and panel share a tilted group', () => {
        const { dir, file } = fixture();
        try {
            const a = new Assembly({ name: 'shared transform' })
                .addGroup({ id: 'controls', position: [12, -25, 100], rotation: [8, 0, 0] })
                .addBoard({ id: 'board', group: 'controls', file, origin: [13, 24] })
                .addFrontPanel({ ...panel, group: 'controls', offset: 8 });
            const board = a.parts[1] as Extract<(typeof a.parts)[number], { kind: 'board' }>;
            const plate = a.parts[2] as AssemblyFrontPanel;
            const baseline = projectPanelCutouts({ ...panel, offset: 8 }, [
                { file, part: { ...board, group: undefined } },
            ]);
            const grouped = projectPanelCutouts(
                plate,
                [{ file, part: board, worldMatrix: assemblyWorldMatrix(board, a.parts) }],
                assemblyWorldMatrix(plate, a.parts),
            );
            expect(grouped.length).toBe(baseline.length);
            grouped.forEach((ring, i) =>
                ring.forEach((point, j) =>
                    point.forEach((v, k) => expect(v).toBeCloseTo(baseline[i][j][k], 9)),
                ),
            );
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('projects an angled plate at a normal offset and rejects parallel rays', () => {
        const { dir, file } = fixture();
        try {
            const source = {
                file,
                part: {
                    kind: 'board' as const,
                    id: 'board',
                    file,
                    origin: [13, 24] as [number, number],
                },
            };
            const cuts = projectPanelCutouts({ ...panel, rotation: [0, 60, 0], offset: 10 }, [
                source,
            ]);
            const xs = cuts[0].map((p) => p[0]);
            expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(8, 1);
            expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(
                -10 * Math.tan(Math.PI / 3),
                1,
            );
            expect(() => projectPanelCutouts({ ...panel, rotation: [0, 90, 0] }, [source])).toThrow(
                'parallel',
            );
            expect(() =>
                projectPanelCutouts(panel, [{ ...source, references: ['missing'] }]),
            ).toThrow('missing');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('subtracts overlapping holes once and clips edge openings into solid panel topology', () => {
        const result = buildPanelModel(panel, [
            [
                [-5, -5],
                [5, -5],
                [5, 5],
                [-5, 5],
            ],
            [
                [0, -5],
                [10, -5],
                [10, 5],
                [0, 5],
            ],
            [
                [18, -2],
                [25, -2],
                [25, 2],
                [18, 2],
            ],
        ]);
        expect(result.polygons).toHaveLength(1);
        expect(result.polygons[0]).toHaveLength(2);
        expect(result.model).toBeDefined();
        expect(panelDXF(result.polygons)).toContain('$INSUNITS\n70\n4');
        expect(panelDXF(result.polygons).match(/LWPOLYLINE/g)).toHaveLength(2);
        expect(panelSVG(result.polygons)).toContain('width="40mm"');
        expect(panelSVG(result.polygons)).toContain('fill-rule="evenodd"');
        const area = (ring: number[][]) =>
            Math.abs(
                ring.reduce(
                    (sum, p, i) =>
                        sum +
                        p[0] * ring[(i + 1) % ring.length][1] -
                        ring[(i + 1) % ring.length][0] * p[1],
                    0,
                ) / 2,
            );
        expect(area(result.polygons[0][0]) - area(result.polygons[0][1])).toBeCloseTo(
            1600 - 150 - 8,
            5,
        );
    });
    it('cuts underside seats to their specified depth without internal overlapping faces', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-relief-'));
        try {
            const plate = {
                ...panel,
                outline: [
                    [0, 0],
                    [10, 0],
                    [10, 10],
                    [0, 10],
                ] as [number, number][],
                reliefs: [
                    {
                        depth: 0.6,
                        outline: [
                            [2, 2],
                            [8, 2],
                            [8, 8],
                            [2, 8],
                        ] as [number, number][],
                    },
                ],
            };
            const { model } = buildPanelModel(plate, []);
            const result = await model.export({ outDir: dir, baseName: 'seat' });
            const source = fs.readFileSync(result.wrlPath!, 'utf8');
            let volume = 0,
                seatArea = 0;
            for (const shape of source.matchAll(
                /point \[([\s\S]*?)\][\s\S]*?coordIndex \[([\s\S]*?)\]/g,
            )) {
                const vertices = shape[1]
                    .trim()
                    .split(',')
                    .map(
                        (v) =>
                            new Vector3(
                                ...(v
                                    .trim()
                                    .split(/\s+/)
                                    .map((n) => Number(n) * 2.54) as [number, number, number]),
                            ),
                    );
                const indices = shape[2]
                    .split(',')
                    .map(Number)
                    .filter((v) => v !== -1);
                for (let i = 0; i < indices.length; i += 3) {
                    const [a, b, c] = indices.slice(i, i + 3).map((i) => vertices[i]);
                    volume += a.dot(b.clone().cross(c)) / 6;
                    if ([a, b, c].every((v) => Math.abs(v.z - 0.6) < 1e-5))
                        seatArea += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
                }
            }
            expect(volume).toBeCloseTo(200 - 36 * 0.6, 4);
            expect(seatArea).toBeCloseTo(36, 4);
            expect(() =>
                new Assembly({ name: 'bad' }).addFrontPanel({
                    ...plate,
                    reliefs: [{ ...plate.reliefs[0], depth: 2 }],
                }),
            ).toThrow('relief');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('validates view identity, camera direction and front-panel dimensions', () => {
        expect(
            () =>
                new Assembly({
                    name: 'bad',
                    views: [{ id: 'top', position: [0, 0, 0], target: [0, 0, 0] }],
                }),
        ).toThrow('direction');
        expect(() =>
            new Assembly({ name: 'bad' }).addFrontPanel({ ...panel, thickness: 0 }),
        ).toThrow();
    });
});
