import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    Component,
    Schematic,
    defineFrontPanel,
    exportSchematicFrontPanel,
    type FrontPanels,
    type FrontPanelInterface,
} from '../synth';

const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

class Connector extends Component {
    static frontPanelInterface: FrontPanelInterface = {
        facing: 'top',
        anchor: { x: 2, y: -4, z: 15 },
        cutouts: [{ type: 'circle', diameter: 10 }],
        labelAnchors: {
            above: { x: 0, y: 12, fontSize: 2 },
            below: { x: 0, y: -17, fontSize: 2 },
        },
    };
}
class Board extends Schematic {
    constructor() {
        super({ name: 'Board' });
    }
    generate() {
        new Connector({ symbol: 'Device:R', footprint: 'Test:Face', ref: 'J1' });
        new Connector({ symbol: 'Device:R', footprint: 'Test:Face', ref: 'J2' });
    }
}
const panels: FrontPanels<Board> = {
    ports: (schematic) =>
        defineFrontPanel({
            edge: 'top',
            extends: { left: 5, right: 7, top: 30, bottom: 4 },
            components: [
                {
                    component: schematic.getComponent('J1'),
                    name: 'INPUT',
                    namePlacement: 'above',
                },
            ],
        }),
    side: (schematic) =>
        defineFrontPanel({
            edge: 'right',
            extends: { left: 0, right: 0, top: 30, bottom: 4 },
            components: [
                {
                    component: schematic.getComponent('J2'),
                    name: 'OUTPUT',
                    namePlacement: 'below',
                },
            ],
        }),
};

function fixture(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-named-panel-'));
    dirs.push(dir);
    const file = path.join(dir, 'Board.kicad_pcb');
    fs.writeFileSync(
        file,
        `(kicad_pcb
    (gr_rect (start 100 200) (end 200 280) (layer "Edge.Cuts"))
    (footprint "Test:Face" (layer "F.Cu") (at 140 240) (property "Reference" "J1"))
    (footprint "Test:Face" (layer "F.Cu") (at 160 240 270) (property "Reference" "J2")))`,
    );
    return file;
}

describe('named schematic front panels', () => {
    it('uses component-defined 3D interfaces and independent named panels with four layers', () => {
        const pcbFile = fixture(),
            before = fs.readFileSync(pcbFile);
        const board = new Board();
        const ports = exportSchematicFrontPanel(board, panels, 'ports', {
            pcbFile,
        });
        const side = exportSchematicFrontPanel(board, panels, 'side', { pcbFile });
        expect(ports).toMatchObject({
            name: 'ports',
            components: ['J1'],
            annotations: 3,
            cutouts: 1,
            labels: 1,
        });
        expect(ports.dxfFile).not.toBe(side.dxfFile);
        const svg = fs.readFileSync(ports.svgFile, 'utf8');
        expect(svg).toContain('viewBox="-5 -30 112 34"');
        expect(svg).toContain('cx="42" cy="-15"');
        expect(svg).toContain('y="-27" font-size="2"');
        expect(fs.readFileSync(side.svgFile, 'utf8')).toContain('y="2" font-size="2"');
        expect(svg).not.toContain('OUTPUT');
        for (const layer of ['OUTLINE', 'ENGRAVING', 'CUTOUT', 'ANNOTATIONS']) {
            expect(svg).toContain(`id="${layer}"`);
            expect(fs.readFileSync(ports.dxfFile, 'utf8')).toContain(`2\n${layer}\n`);
        }
        expect(fs.readFileSync(ports.dxfFile, 'utf8')).toContain('%%c10');
        expect(fs.readFileSync(pcbFile)).toEqual(before);
    });

    it('aligns names to a panel height and supports explicit bold overrides in both formats', () => {
        const pcbFile = fixture(),
            board = new Board();
        const aligned: FrontPanels<Board> = {
            ports: (s) => ({
                ...panels.ports(s),
                nameHeight: -3,
                textStyle: { bold: true },
                components: [
                    {
                        component: s.getComponent('J1'),
                        name: 'INPUT',
                        namePlacement: 'above',
                        nameStyle: { bold: false },
                    },
                ],
            }),
        };
        const result = exportSchematicFrontPanel(board, aligned, 'ports', {
            pcbFile,
        });
        const svg = fs.readFileSync(result.svgFile, 'utf8'),
            dxf = fs.readFileSync(result.dxfFile, 'utf8');
        expect(svg).toContain('x="42" y="3" font-size="2" font-weight="normal"');
        expect(svg).toContain('font-size="1.5" font-weight="bold"');
        expect(dxf).toContain('1\nINPUT\n7\nSTANDARD\n');
        expect(dxf).toContain('7\nPCBS_BOLD\n');
        expect(() =>
            exportSchematicFrontPanel(
                board,
                { ports: (s) => ({ ...aligned.ports(s), nameHeight: NaN }) },
                'ports',
                { pcbFile },
            ),
        ).toThrow('Name height must be finite');
    });

    it('rejects unknown panels, foreign components, repeated selections, and invalid bounds', () => {
        const pcbFile = fixture(),
            board = new Board();
        expect(() => exportSchematicFrontPanel(board, panels, 'unknown', { pcbFile })).toThrow(
            'Available panels: ports, side',
        );
        expect(() => exportSchematicFrontPanel(board, panels, '../ports', { pcbFile })).toThrow(
            'Panel names',
        );
        const foreign = new Connector({
            symbol: 'Device:R',
            footprint: 'Test:Face',
            ref: 'J1',
        });
        expect(() =>
            exportSchematicFrontPanel(
                board,
                {
                    foreign: () => ({
                        ...panels.ports(board),
                        components: [{ component: foreign }],
                    }),
                },
                'foreign',
                { pcbFile },
            ),
        ).toThrow('supplied schematic');
        expect(() =>
            exportSchematicFrontPanel(
                board,
                {
                    repeated: (s) => {
                        const panel = panels.ports(s);
                        return {
                            ...panel,
                            components: [...panel.components, ...panel.components],
                        };
                    },
                },
                'repeated',
                { pcbFile },
            ),
        ).toThrow('duplicate component');
        expect(() =>
            exportSchematicFrontPanel(
                board,
                {
                    bad: (s) => ({
                        ...panels.ports(s),
                        extends: { left: -1, right: 0, top: 30, bottom: 4 },
                    }),
                },
                'bad',
                { pcbFile },
            ),
        ).toThrow('nonnegative');
    });

    it('requires the requested component label anchor and rejects stale saved footprints', () => {
        const pcbFile = fixture(),
            board = new Board();
        const missing: FrontPanels<Board> = {
            ports: (s) => {
                const panel = panels.ports(s),
                    component = s.getComponent('J1');
                Object.defineProperty(component, 'frontPanelInterface', {
                    value: { ...Connector.frontPanelInterface, labelAnchors: {} },
                });
                return panel;
            },
        };
        expect(() => exportSchematicFrontPanel(board, missing, 'ports', { pcbFile })).toThrow(
            'no above name placement',
        );
        fs.writeFileSync(
            pcbFile,
            fs.readFileSync(pcbFile, 'utf8').replace('"Test:Face"', '"Test:Changed"'),
        );
        expect(() => exportSchematicFrontPanel(board, panels, 'ports', { pcbFile })).toThrow(
            'does not match',
        );
    });
});
