import { it, expect } from 'vitest';
import { stitchFilledZones } from '../router/ZoneStitching';
import { boardRoutingGeometry } from '../router/BoardRoutingGeometry';
import { captureRouting } from '../kicad/RoutingFile';
it('captures KiCad 10 name-only nets without losing pad anchors', () => {
    const s =
        '(kicad_pcb (footprint "X" (at 5 6) (property "Reference" "R1") (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net "SIGNAL"))) (segment (start 5 6) (end 8 6) (width .15) (layer "F.Cu") (net "SIGNAL") (uuid "seg")) (gr_rect (start 0 0) (end 20 20) (layer "Edge.Cuts")))';
    expect(captureRouting(s, 'B').routes[0]).toMatchObject({
        net: 'SIGNAL',
        segments: [{ start: { ref: 'R1', pad: '1' } }],
    });
    expect(boardRoutingGeometry(s, new Set()).terminals[0].net).toBe('SIGNAL');
});
it('adds stitching only inside both filled copper envelopes and away from drills', () => {
    const p = (layer: string) =>
        `(filled_polygon (layer "${layer}") (pts (xy 1 1) (xy 9 1) (xy 9 9) (xy 1 9)))`;
    const s = `(kicad_pcb (zone (net "GND") ${p('F.Cu')} ${p('B.Cu')}))`;
    const r = stitchFilledZones(s, 'B', 'GND');
    expect(r.added).toBe(1);
    expect(r.routing.routes[0].vias![0].at).toEqual({ x: 1.25, y: 1.25 });
    expect(() => stitchFilledZones('(kicad_pcb)', 'B', 'GND')).toThrow(/refill/);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cmdRouteJoin } from '../cli/commands/route-join';
it('saves a targeted ground join without changing the PCB or unrelated copper', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-join-'));
    try {
        const board = path.join(d, 'Join.kicad_pcb'),
            output = path.join(d, 'routing.json');
        const pad = (ref: string, x: number) =>
            `(footprint "P" (layer "F.Cu") (at ${x} 5) (property "Reference" "${ref}") (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "GND")))`;
        const source = `(kicad_pcb (net 1 "GND") (net 2 "OTHER") ${pad('A', 3)} ${pad('B', 17)} (segment (start 2 10) (end 18 10) (width .15) (layer "F.Cu") (net 2) (uuid "manual")) (gr_rect (start 0 0) (end 20 15) (layer "Edge.Cuts")))`;
        fs.writeFileSync(board, source);
        await cmdRouteJoin([
            board,
            '--net',
            'GND',
            '--from',
            'A.1',
            '--to',
            'B.1',
            '--output',
            output,
        ]);
        expect(fs.readFileSync(board, 'utf8')).toBe(source);
        const r = JSON.parse(fs.readFileSync(output, 'utf8'));
        expect(r.routes.find((n: any) => n.net === 'OTHER').segments[0].uuid).toBe('manual');
        expect(r.routes.find((n: any) => n.net === 'GND').segments).toHaveLength(1);
        await expect(
            cmdRouteJoin([
                board,
                '--net',
                'OTHER',
                '--from',
                'A.1',
                '--to',
                'B.1',
                '--output',
                output,
            ]),
        ).rejects.toThrow(/not on OTHER/);
    } finally {
        fs.rmSync(d, { recursive: true, force: true });
    }
});
