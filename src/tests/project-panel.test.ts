import { relocateBoardModels } from '../project/RelocateBoardModels';
import { boardRoot, child } from '../kicad/BoardComposition';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { PcbProject, discoverPcbProjects, findPcbProject } from '../project/PcbProject';
import { prepareProjectLibraries } from '../project/ProjectLibraries';
import { PcbPanel } from '../synth/PcbPanel';
import { Schematic } from '../synth/Schematic';
import { Component } from '../synth/Component';
import { Net } from '../synth/Net';
import { PcbGenerator } from '../kicad/PcbGenerator';
import { UuidManager } from '../kicad/UuidManager';
import { buildPcbPanel } from '../cli/panel';
import { exportComponents } from '../cli/utils/export-components';
import { convertPosToCpl } from '../cli/utils/cpl';

const nativeRequire = createRequire(path.join(os.tmpdir(), 'pcb-test-loader.cjs'));
const outline = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 15 },
    { x: 0, y: 15 },
];
async function temporary(run: (directory: string) => unknown) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-project-'));
    try {
        return await run(directory);
    } finally {
        for (const file of Object.keys(nativeRequire.cache))
            if (file.startsWith(directory + path.sep)) delete nativeRequire.cache[file];
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
function fixture(root: string) {
    const directory = path.join(root, 'family');
    fs.mkdirSync(path.join(directory, 'schematics/unit'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'panels/production'), { recursive: true });
    fs.writeFileSync(
        path.join(directory, 'pcb-project.json'),
        JSON.stringify({
            name: 'Family',
            schematics: { unit: 'schematics/unit/Unit.cjs' },
            panels: { batch: 'panels/production/Panel.ts' },
        }),
    );
    const entry = path.join(directory, 'schematics/unit/Unit.cjs');
    fs.writeFileSync(entry, '// fixture loaded from cache');
    fs.writeFileSync(path.join(directory, 'panels/production/Panel.ts'), '// fixture');
    class Unit extends Schematic {
        generate() {
            const net = new Net({ name: 'SIGNAL' });
            const connector = new Component({
                ref: 'J1',
                symbol: 'Connector_Generic:Conn_01x02',
                footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical',
                value: 'two-pin connector',
                partNo: 'C123',
                cpl: { x: 1, y: 0, r: 5 },
                pcbPosition: { x: 5, y: 5 },
            });
            connector.pins[1].tie(net);
            connector.pins[2].tie(net);
        }
    }
    const unit = new Unit({
        name: 'Unit',
        pcb: {
            outline,
            exactRoutes: [
                {
                    id: 'wire',
                    net: 'SIGNAL',
                    segments: [
                        {
                            start: { ref: 'J1', pad: '1' },
                            end: { ref: 'J1', pad: '2' },
                            layer: 'B.Cu',
                            width: 0.3,
                        },
                    ],
                },
            ],
        },
    });
    nativeRequire.cache[nativeRequire.resolve(entry)] = {
        exports: { default: unit },
    } as NodeModule;
    const native = path.join(path.dirname(entry), 'Unit.kicad_pcb');
    fs.writeFileSync(
        native,
        new PcbGenerator(
            unit._generateWithCapture(),
            new UuidManager(),
            path.dirname(entry),
        ).generate().content,
    );
    const project = new PcbProject(directory);
    const panel = new PcbPanel({
        name: 'Panel',
        project,
        pcb: {
            fiducials: [
                { id: 'top', at: { x: 1, y: 1 } },
                { id: 'bottom', at: { x: 2, y: 1 }, side: 'back' },
            ],
            outline: [
                { x: 0, y: 0 },
                { x: 80, y: 0 },
                { x: 80, y: 80 },
                { x: 0, y: 80 },
            ],
        },
        boards: [
            { schematic: 'unit', id: 'a', x: 5, y: 5, replaceOutline: outline },
            { schematic: 'unit', id: 'b', x: 50, y: 30, rotation: 90, replaceOutline: outline },
        ],
    });
    return { directory, project, panel, entry: project.entry('panels', 'batch'), native };
}

describe('PCB projects and manufacturing panels', () => {
    it('supports an empty project and discovers only marked project directories', () =>
        temporary((root) => {
            fs.mkdirSync(path.join(root, 'empty'));
            fs.writeFileSync(
                path.join(root, 'empty/pcb-project.json'),
                JSON.stringify({ name: 'Empty' }),
            );
            fs.mkdirSync(path.join(root, 'legacy'));
            expect(discoverPcbProjects(root).map((p) => p.name)).toEqual(['Empty']);
            expect(findPcbProject(path.join(root, 'empty/subdirectory'))?.name).toBe('Empty');
        }));
    it('requires a project for a panel and rejects unknown/missing entries', () =>
        temporary((root) => {
            expect(
                () =>
                    new PcbPanel({
                        name: 'P',
                        project: new PcbProject(root, { name: 'Transient' }),
                        pcb: {},
                    }),
            ).toThrow('persisted');
            const { project } = fixture(root);
            expect(() => project.entry('schematics', 'missing')).toThrow('Unknown');
            fs.unlinkSync(project.entry('schematics', 'unit'));
            expect(() => project.entry('schematics', 'unit')).toThrow('missing');
        }));
    it('builds PCB-only output, preserves native copper, and refreshes every copied source', () =>
        temporary(async (root) => {
            const { panel, entry, native } = fixture(root);
            expect(panel).not.toBeInstanceOf(Schematic);
            const file = await buildPcbPanel(panel, entry, false);
            expect(fs.existsSync(file.replace('.kicad_pcb', '.kicad_sch'))).toBe(false);
            expect(fs.existsSync(file.replace('.kicad_pcb', '.net'))).toBe(false);
            expect(fs.readFileSync(file, 'utf8')).toContain('a/SIGNAL');
            const raw = fs.readFileSync(native, 'utf8');
            fs.writeFileSync(native, raw.replace('(width 0.3)', '(width 0.7)'));
            await buildPcbPanel(panel, entry, false);
            const latest = fs.readFileSync(file, 'utf8');
            expect(latest).toContain('(width 0.7)');
            expect(latest).toContain('b_J1');
            expect(latest).toContain('TSPCB:Fiducial');
            expect(latest).toContain('(layers \"B.Cu\" \"B.Mask\")');
            fs.unlinkSync(native);
            await expect(buildPcbPanel(panel, entry, false)).rejects.toThrow();
            expect(fs.readFileSync(file, 'utf8')).toBe(latest);
        }));
    it('rotates pick-and-place corrections for repeated front/back board instances', () =>
        temporary((root) => {
            const { panel } = fixture(root);
            const components = exportComponents(panel._generateWithCapture());
            const positions = path.join(root, 'positions.txt'),
                output = path.join(root, 'CPL.csv');
            fs.writeFileSync(
                positions,
                'Ref,Val,Package,PosX,PosY,Rot,Side\na_J1,"two-pin, connector",package,10,20,0,top\nb_J1,"two-pin ""connector""",package,30,40,90,bottom\n',
            );
            convertPosToCpl(positions, output, components, root);
            const csv = fs.readFileSync(output, 'utf8');
            expect(csv).toContain(
                'a_J1,"two-pin, connector",package,11.0000mm,20.0000mm,5.0000,Top',
            );
            expect(csv).toContain(
                'b_J1,"two-pin ""connector""",package,30.0000mm,41.0000mm,95.0000,Bottom',
            );
        }));
    it('merges local symbols/footprints over shared libraries and removes stale overlay entries', () =>
        temporary((root) => {
            const { directory } = fixture(root);
            const shared = path.join(root, '.kicad'),
                local = path.join(directory, '.kicad');
            for (const lib of [shared, local])
                fs.mkdirSync(path.join(lib, 'Custom.pretty'), { recursive: true });
            fs.writeFileSync(path.join(shared, 'Custom.pretty/shared.kicad_mod'), 'shared');
            fs.writeFileSync(path.join(shared, 'Custom.pretty/override.kicad_mod'), 'old');
            fs.writeFileSync(path.join(local, 'Custom.pretty/override.kicad_mod'), 'new');
            fs.writeFileSync(
                path.join(shared, 'Custom.kicad_sym'),
                '(kicad_symbol_lib (version 20231120) (symbol "shared") (symbol "override" (property "Value" "old")))',
            );
            fs.writeFileSync(
                path.join(local, 'Custom.kicad_sym'),
                '(kicad_symbol_lib (version 20231120) (symbol "override" (property "Value" "new")))',
            );
            const output = path.join(directory, 'schematics/unit');
            const [overlay] = prepareProjectLibraries(output, root);
            expect(
                fs.readFileSync(path.join(overlay, 'Custom.pretty/override.kicad_mod'), 'utf8'),
            ).toBe('new');
            expect(fs.existsSync(path.join(overlay, 'Custom.pretty/shared.kicad_mod'))).toBe(true);
            const symbols = fs.readFileSync(path.join(overlay, 'Custom.kicad_sym'), 'utf8');
            expect(symbols).toContain('"shared"');
            expect(symbols).toContain('"new"');
            expect(symbols).not.toContain('"old"');
            fs.unlinkSync(path.join(shared, 'Custom.pretty/shared.kicad_mod'));
            prepareProjectLibraries(output, root);
            expect(fs.existsSync(path.join(overlay, 'Custom.pretty/shared.kicad_mod'))).toBe(false);
        }));
    it('rebases moved model links without changing copper or nesting the board root', () =>
        temporary((root) => {
            const old = path.join(root, 'old'),
                next = path.join(root, 'new');
            fs.mkdirSync(next);
            const file = path.join(next, 'board.kicad_pcb');
            fs.writeFileSync(
                file,
                '(kicad_pcb (model "${KIPRJMOD}/3d/unit.wrl") (segment (start 1 2) (end 3 4) (width 0.3)))',
            );
            expect(relocateBoardModels(file, old, [{ from: old, to: next }])).toBe(1);
            const content = fs.readFileSync(file, 'utf8');
            expect(content).toContain(path.join(next, '3d/unit.wrl'));
            expect(child(boardRoot(content), 'segment')).toEqual([
                'segment',
                ['start', '1', '2'],
                ['end', '3', '4'],
                ['width', '0.3'],
            ]);
        }));
});
