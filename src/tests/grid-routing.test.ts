import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runIncrementalRouting } from '../router/IncrementalRouter';
import { GridRoutingBackend } from '../router/GridRoutingBackend';
it('routes through an off-grid 0.55 mm terminal corridor with actual clearance', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-grid-gap-'));
    try {
        const p = (ref: string, x: number, y: number, w: number, h: number, n: number) =>
            `(footprint "P" (layer "F.Cu") (at ${x} ${y}) (property "Reference" "${ref}") (pad "1" smd rect (at 0 0) (size ${w} ${h}) (layers "F.Cu") (net ${n} "${n === 1 ? 'S' : 'OTHER'}")))`;
        const f = path.join(d, 'Gap.kicad_pcb');
        fs.writeFileSync(
            f,
            `(kicad_pcb (net 1 "S") (net 2 "OTHER") ${p('A', 3.1375, 6.0375, 1, 1, 1)} ${p('B', 18.8625, 6.0375, 1, 1, 1)} ${p('W1', 11, 2.2375, 2, 4.475, 2)} ${p('W2', 11, 11.0125, 2, 11.975, 2)} (gr_rect (start 0 0) (end 22 17) (layer "Edge.Cuts")))`,
        );
        const report = runIncrementalRouting(
            {
                name: 'Gap',
                components: [],
                nets: [],
                pcb: {
                    netClasses: [{ name: 'Signal', nets: ['S'], width: 0.15, clearance: 0.15 }],
                    routeHints: [{ id: 'gap', nets: ['S'], preferredLayers: ['F.Cu'] }],
                },
            },
            f,
            { backend: new GridRoutingBackend(), runDrc: false },
        );
        expect(report.failed).toEqual([]);
        expect(report.completed.map((n) => n.net)).toEqual(['S']);
        const s = fs.readFileSync(f, 'utf8');
        expect(s).toContain('4.75');
        expect(s).not.toContain('(via');
    } finally {
        fs.rmSync(d, { recursive: true, force: true });
    }
}, 15000);
