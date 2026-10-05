import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { KicadFootprint } from '../synth/KicadFootprint';
import { exportFrontPanel } from '../frontpanel/FrontPanelExporter';

describe('front panel export', () => {
    it('serializes footprint metadata and exports placed cutouts and labels', () => {
        const footprint = new KicadFootprint({ name: 'PanelControl' })
            .addFrontPanelCutout({ type: 'circle', diameter: 12 })
            .setFrontPanelLabelAnchor({ x: 0, y: 10, fontSize: 2.5 });
        expect(footprint.serialize()).toContain('FrontPanelCutouts');
        expect(footprint.serialize()).toContain('FrontPanelLabelAnchor');

        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-front-panel-'));
        const pcb = path.join(temp, 'test.kicad_pcb');
        fs.writeFileSync(
            pcb,
            `(kicad_pcb
      (gr_line (start 0 0) (end 100 0) (layer "Edge.Cuts"))
      (gr_line (start 100 0) (end 100 50) (layer "Edge.Cuts"))
      (gr_line (start 100 50) (end 0 50) (layer "Edge.Cuts"))
      (gr_line (start 0 50) (end 0 0) (layer "Edge.Cuts"))
      (footprint "Test:PanelControl" (layer "F.Cu") (at 20 30 90)
        (property "FrontPanelCutouts" "[{\\"type\\":\\"circle\\",\\"diameter\\":12},{\\"type\\":\\"roundedRect\\",\\"width\\":20,\\"height\\":4,\\"radius\\":0}]")
        (property "FrontPanelLabelAnchor" "{\\"x\\":0,\\"y\\":10,\\"fontSize\\":2.5}")
        (property "FrontPanelText" "GO")))`,
        );
        const result = exportFrontPanel(pcb);
        expect(result).toMatchObject({ outlineSegments: 4, cutouts: 2, labels: 1 });
        expect(fs.readFileSync(result.dxfFile, 'utf8')).toContain('CUTOUT');
        expect(fs.readFileSync(result.svgFile, 'utf8')).toContain('>GO</text>');
        // At 90 degrees in KiCad, the 20 mm local X span becomes Y=20..40,
        // proving that board-coordinate rotation is applied in the right direction.
        expect(fs.readFileSync(result.svgFile, 'utf8')).toContain('18,40 18,20 22,20 22,40');
    });
});
