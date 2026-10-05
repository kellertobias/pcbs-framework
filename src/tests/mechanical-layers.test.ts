import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KicadFootprint, Component, Schematic, FootprintLayers } from '../synth';
import { PcbGenerator } from '../kicad/PcbGenerator';
import { UuidManager } from '../kicad/UuidManager';

describe('mechanical layer contract', () => {
    it('draws frontpanel, mounting and interaction contours on separate canonical layers', () => {
        const fp = new KicadFootprint({ name: 'Panel' });
        fp.addFrontPanelCutout({ type: 'circle', diameter: 7.2 });
        fp.addMountingLayerCutout({ type: 'roundedRect', width: 14, height: 14, radius: 0.3 });
        fp.addUserInteractionArea({ type: 'circle', diameter: 40 });
        fp.addLine({ x1: 0, y1: 0, x2: 1, y2: 0, layer: 'User.Eco1' });
        const source = fp.serialize();
        expect(source).toContain('(layer "Eco1.User")');
        expect(source).toContain('(layer "Eco2.User")');
        expect(source).toContain('(layer "Dwgs.User")');
        expect(source).not.toContain('Edge.Cuts');
        expect(source.match(/\(fp_arc/g)).toHaveLength(8);
        expect(FootprintLayers.MountingLayerCutout.layer).toBe('Eco2.User');
        expect(FootprintLayers.UserInteractionArea.aliases).toContain('User.Drawings');
    });
    it('places actual component values visibly on the correct front/back Fab layer', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-values-'));
        try {
            const pretty = path.join(dir, 'Test.pretty');
            fs.mkdirSync(pretty);
            const fp = new KicadFootprint({ name: 'Resistor' }).setValue('template');
            fp.addText({ text: '${REFERENCE}', x: 0, y: 0, layer: 'F.Fab' });
            let source = fp
                .serialize()
                .replace('(property "Value" "template"', '(property "Value" "template" (hide yes)');
            fs.writeFileSync(path.join(pretty, 'Resistor.kicad_mod'), source);
            fs.writeFileSync(
                path.join(dir, 'fp-lib-table'),
                `(fp_lib_table (lib (name "Test") (type "KiCad") (uri "${pretty}")))`,
            );
            class Board extends Schematic {
                generate() {
                    new Component({
                        symbol: 'Device:R',
                        ref: 'R1',
                        value: '10k',
                        footprint: 'Test:Resistor',
                        pcbPosition: { x: 10, y: 10 },
                    });
                    new Component({
                        symbol: 'Device:R',
                        ref: 'R2',
                        value: '22k',
                        footprint: 'Test:Resistor',
                        pcbPosition: { x: 20, y: 10, side: 'back' },
                    });
                }
            }
            const board = new Board({
                name: 'Values',
                pcb: {
                    outline: [
                        { x: 0, y: 0 },
                        { x: 40, y: 0 },
                        { x: 40, y: 30 },
                        { x: 0, y: 30 },
                    ],
                    place: ['*'],
                },
            });
            const uuids = new UuidManager();
            uuids.load(path.join(dir, 'uuids.json'));
            const text = new PcbGenerator(board._generateWithCapture(), uuids, dir).generate()
                .content;
            const front = text.slice(
                text.indexOf('(footprint'),
                text.indexOf('(footprint', text.indexOf('(footprint') + 1),
            );
            const back = text.slice(text.indexOf('(footprint', text.indexOf('(footprint') + 1));
            expect(front).toMatch(/property "Value" "10k"[\s\S]*?layer "F.Fab"/);
            expect(back).toMatch(/property "Value" "22k"[\s\S]*?layer "B.Fab"/);
            expect(
                front.slice(
                    front.indexOf('(property \"Value\"'),
                    front.indexOf('(property \"Datasheet\"'),
                ),
            ).not.toContain('(hide yes)');
            expect(
                back.slice(
                    back.indexOf('(property \"Value\"'),
                    back.indexOf('(property \"Datasheet\"'),
                ),
            ).not.toContain('(hide yes)');
            expect(text).not.toContain('(fp_text user "${REFERENCE}"');
            expect(text).toContain('(fp_text user "${VALUE}"');
            expect(text).toContain('user "FrontpanelCutout"');
            expect(text).toContain('user "MountingLayerCutout"');
            expect(text).toContain('user "UserInteractionArea"');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
