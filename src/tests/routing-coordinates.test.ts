import { describe, it, expect } from 'vitest';
import { boardRoutingGeometry } from '../router/BoardRoutingGeometry';
import { CapacityRoutingBackend } from '../router/CapacityRoutingBackend';
import { runIncrementalRouting } from '../router/IncrementalRouter';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
describe('KiCad routing coordinates', () => {
    it('rotates pads clockwise in board coordinates, including rear footprints', () => {
        const g = boardRoutingGeometry(
            '(kicad_pcb (net 1 "V") (footprint "P" (layer "B.Cu") (at 20 10 270) (property "Reference" "C1") (pad "1" smd rect (at 0.775 0 270) (size 1 1) (layers "B.Cu") (net 1 "V"))) (gr_rect (start 0 0) (end 30 20) (layer "Edge.Cuts")))',
            new Set(),
        );
        expect(g.terminals[0].at.x).toBeCloseTo(20);
        expect(g.terminals[0].at.y).toBeCloseTo(10.775);
    });
    it('routes rounded library endpoints back to the exact off-grid pad centers', () => {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'route-rounding-'));
        try {
            const file = path.join(d, 'Round.kicad_pcb');
            const p = (r: string, x: number, y: number) =>
                `(footprint "P" (layer "F.Cu") (at ${x} ${y}) (property "Reference" "${r}") (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "S")))`;
            fs.writeFileSync(
                file,
                `(kicad_pcb (net 1 "S") ${p('A', 3.1375, 5.7625)} ${p('B', 17.8625, 5.7625)} (gr_rect (start 0 0) (end 22 12) (layer "Edge.Cuts")))`,
            );
            const report = runIncrementalRouting(
                {
                    name: 'Round',
                    components: [],
                    nets: [],
                    pcb: {
                        netClasses: [{ name: 'Signal', nets: ['S'], width: 0.18, clearance: 0.15 }],
                    },
                },
                file,
                { backend: new CapacityRoutingBackend(), runDrc: false },
            );
            expect(report.failed).toEqual([]);
            expect(fs.readFileSync(file, 'utf8')).toContain('3.1375 5.7625');
        } finally {
            fs.rmSync(d, { recursive: true, force: true });
        }
    });
});
