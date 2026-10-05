import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { PcbGenerator } from '../kicad/PcbGenerator';
import { synchronizePcb } from '../kicad/PcbSynchronizer';
import { UuidManager } from '../kicad/UuidManager';
import type { CircuitSnapshot } from '../synth/types';

const temporaryDirectories: string[] = [];
afterEach(() => {
    for (const directory of temporaryDirectories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});

const snapshot: CircuitSnapshot = {
    name: 'GeometryBoard',
    components: [],
    nets: [],
    pcb: {
        thickness: 1.2,
        contours: [
            {
                id: 'outer',
                edges: [
                    { kind: 'line', id: 'top', start: { x: 0, y: 0 }, end: { x: 40, y: 0 } },
                    {
                        kind: 'arc',
                        id: 'right-round',
                        start: { x: 40, y: 0 },
                        mid: { x: 45, y: 5 },
                        end: { x: 40, y: 10 },
                    },
                    { kind: 'line', id: 'bottom', start: { x: 40, y: 10 }, end: { x: 0, y: 10 } },
                    { kind: 'line', id: 'left', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
                ],
            },
        ],
        cutouts: [
            {
                id: 'window',
                points: [
                    { x: 5, y: 2 },
                    { x: 10, y: 2 },
                    { x: 10, y: 7 },
                    { x: 5, y: 7 },
                ],
            },
        ],
        slots: [{ id: 'fader', start: { x: 20, y: 2 }, end: { x: 20, y: 8 }, width: 2 }],
        mountingHoles: [
            { id: 'left', at: { x: 3, y: 5 }, drill: 3.2 },
            { id: 'earth', at: { x: 37, y: 5 }, drill: 3.2, diameter: 6, plated: true },
        ],
        keepouts: [
            {
                id: 'antenna',
                points: [
                    { x: 25, y: 2 },
                    { x: 35, y: 2 },
                    { x: 35, y: 8 },
                    { x: 25, y: 8 },
                ],
                footprints: true,
            },
        ],
        stackup: { copperFinish: 'ENIG', dielectricMaterial: 'FR4', solderMaskColor: 'Green' },
    },
};

function generator(directory: string): PcbGenerator {
    const uuids = new UuidManager();
    uuids.load(path.join(directory, 'uuids.json'));
    const generated = new PcbGenerator(snapshot, uuids, directory);
    const originalGenerate = generated.generate.bind(generated);
    generated.generate = () => {
        const result = originalGenerate();
        uuids.save();
        return result;
    };
    return generated;
}

describe('declarative PCB geometry', () => {
    it('emits stable arcs, contours, cutouts, routed slots, holes, keepouts and stack-up', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-geometry-'));
        temporaryDirectories.push(directory);
        const first = generator(directory).generate().content;
        const second = generator(directory).generate().content;

        expect(second).toBe(first);
        expect((first.match(/\(gr_arc/g) ?? []).length).toBeGreaterThanOrEqual(3);
        expect((first.match(/\(gr_line/g) ?? []).length).toBeGreaterThanOrEqual(9);
        expect(first).toContain('(property "TSPCB.ManagedId" "mounting-hole:left"');
        expect(first).toContain('(pad "" np_thru_hole circle');
        expect(first).toContain('(pad "1" thru_hole circle');
        expect(first).toContain('(keepout (tracks not_allowed)');
        expect(first).toContain('(copper_finish "ENIG")');
        expect(first).toContain('(general (thickness 1.2)');
    });

    it('syncs only stable generated geometry and preserves manual Edge.Cuts', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-geometry-sync-'));
        temporaryDirectories.push(directory);
        const generated = generator(directory).generate().content;
        const manual = `(kicad_pcb (version 20241229) (generator "pcbnew")
      (general (thickness 1.6))
      (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
      (setup (pad_to_mask_clearance 0))
      (net 0 "")
      (gr_line (start 100 100) (end 110 100) (stroke (width 0.05) (type solid)) (layer "Edge.Cuts") (uuid "00000000-0000-0000-0000-000000000099"))
    )\n`;

        const first = synchronizePcb(manual, generated);
        const second = synchronizePcb(first.content, generated);

        expect(first.content).toContain('(start 100 100)');
        expect(second.content).toBe(first.content);
        expect(first.report.addedGeometry.length).toBeGreaterThan(0);
        expect(second.report.addedGeometry).toHaveLength(0);
        expect(second.report.updatedGeometry.length).toBe(first.report.addedGeometry.length);
    });
});
