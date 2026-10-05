import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { KicadGenerator } from '../kicad/KicadGenerator';
import type { CircuitSnapshot } from '../synth/types';

const temporaryDirectories: string[] = [];
afterEach(() => {
    for (const directory of temporaryDirectories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});

describe('PCB net rules and managed copper zones', () => {
    it('serializes rules, assignments and zones while preserving manual project and copper objects', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-rules-zones-'));
        temporaryDirectories.push(directory);
        fs.writeFileSync(
            path.join(directory, 'RulesBoard.kicad_pro'),
            JSON.stringify({
                meta: { filename: 'RulesBoard.kicad_pro', version: 3 },
                net_settings: {
                    classes: [{ name: 'Manual', track_width: 0.123, clearance: 0.123 }],
                    meta: { version: 4 },
                    net_colors: null,
                    netclass_assignments: { MANUAL_NET: 'Manual' },
                    netclass_patterns: [],
                },
            }),
        );
        fs.writeFileSync(
            path.join(directory, 'RulesBoard.kicad_dru'),
            `(version 1)\n(rule "Manual rule" (constraint clearance (min 0.5mm)) (condition "A.NetName == 'MANUAL_NET'"))\n`,
        );
        fs.writeFileSync(
            path.join(directory, 'RulesBoard.kicad_pcb'),
            `(kicad_pcb
      (version 20241229) (generator "pcbnew") (general (thickness 1.6))
      (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
      (setup (pad_to_mask_clearance 0))
      (net 0 "") (net 1 "GND")
      (segment (start 1 1) (end 2 1) (width 0.2) (layer "F.Cu") (net 1) (uuid "10000000-0000-0000-0000-000000000001"))
      (zone (net 1) (net_name "GND") (layer "B.Cu") (uuid "10000000-0000-0000-0000-000000000002")
        (hatch edge 0.5) (connect_pads (clearance 0.2)) (min_thickness 0.25)
        (fill yes (thermal_gap 0.3) (thermal_bridge_width 0.3))
        (polygon (pts (xy 2 2) (xy 3 2) (xy 3 3) (xy 2 3))))
    )\n`,
        );
        const snapshot: CircuitSnapshot = {
            name: 'RulesBoard',
            components: [],
            nets: [{ name: 'GND', class: 'Power' } as any, { name: 'USB_D+', class: 'USB' } as any],
            pcb: {
                outline: [
                    { x: 0, y: 0 },
                    { x: 40, y: 0 },
                    { x: 40, y: 20 },
                    { x: 0, y: 20 },
                ],
                netClasses: [
                    {
                        name: 'Power',
                        nets: ['GND'],
                        width: 0.8,
                        clearance: 0.3,
                        viaDiameter: 1,
                        viaDrill: 0.5,
                        preferredLayers: ['B.Cu'],
                    },
                    {
                        name: 'USB',
                        nets: ['USB_D+', 'USB_D-'],
                        width: 0.2,
                        clearance: 0.2,
                        diffPairWidth: 0.2,
                        diffPairGap: 0.18,
                        length: { target: 50, tolerance: 2 },
                    },
                ],
                zones: [
                    {
                        id: 'ground-plane',
                        net: 'GND',
                        layer: 'F.Cu',
                        boardInset: 0.5,
                        clearance: 0.4,
                        thermalGap: 0.5,
                        thermalBridgeWidth: 0.6,
                        priority: 2,
                    },
                ],
            },
        };

        const result = new KicadGenerator([]).generate(snapshot, directory, {
            pcbMode: 'sync',
            validateWithKicad: false,
        });
        const project = JSON.parse(
            fs.readFileSync(path.join(directory, 'RulesBoard.kicad_pro'), 'utf-8'),
        );
        const rules = fs.readFileSync(path.join(directory, 'RulesBoard.kicad_dru'), 'utf-8');
        const board = fs.readFileSync(path.join(directory, 'RulesBoard.kicad_pcb'), 'utf-8');
        const report = JSON.parse(
            fs.readFileSync(path.join(directory, 'RulesBoard.pcb-sync.json'), 'utf-8'),
        );

        expect(result.success).toBe(true);
        expect(project.net_settings.classes.map((entry: any) => entry.name)).toEqual([
            'Manual',
            'Power',
            'USB',
        ]);
        expect(project.net_settings.netclass_assignments).toMatchObject({
            MANUAL_NET: 'Manual',
            GND: 'Power',
            'USB_D+': 'USB',
            'USB_D-': 'USB',
        });
        expect(rules).toContain('(rule "Manual rule"');
        expect(rules).toContain('TSPCB Power preferred layers');
        expect(rules).toContain('(constraint length (min 48mm) (opt 50mm) (max 52mm))');
        expect(board.match(/\(segment/g) ?? []).toHaveLength(1);
        expect(board.match(/\(zone/g) ?? []).toHaveLength(2);
        expect(board).toContain('(priority 2)');
        expect(board).toContain('(thermal_bridge_width 0.6)');
        expect(report.zoneFill).toBe('requires-kicad-refill');
        expect(result.warnings).toContainEqual(expect.stringContaining('PCB_ZONES_REQUIRE_REFILL'));
    });
});
