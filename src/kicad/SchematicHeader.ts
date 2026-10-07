import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import type { CircuitSnapshot } from '../synth/types';
import type { UuidManager } from './UuidManager';
import type { SExpr } from './SExpressionParser';

export function schematicRevision(snapshot: CircuitSnapshot): string {
    const revision = snapshot.schematicRevision ?? 1;
    if (!Number.isInteger(revision) || revision < 1)
        throw new Error('schematicRevision must be a positive integer.');
    return `R${revision}`;
}
/** Logo uses an embedded native PNG in the worksheet logo block. */
export function schematicHeader(snapshot: CircuitSnapshot, uuids: UuidManager): SExpr[] {
    const result: SExpr[] = [];
    const sizes: Record<string, [number, number]> = {
        A4: [297, 210],
        A3: [420, 297],
        A2: [594, 420],
        A1: [841, 594],
        A0: [1189, 841],
    };
    const [widthMm, heightMm] = sizes[snapshot.size ?? 'A4'] ?? sizes.A4;
    const logo = snapshot.branding?.logo;
    if (logo) {
        const input = fs.readFileSync(logo);
        const png = /\.svg$/i.test(logo)
            ? new Resvg(input, { fitTo: { mode: 'width', value: 420 } }).render().asPng()
            : input;
        if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
            throw new Error('Schematic logo must be a PNG or SVG.');
        const width = png.readUInt32BE(16),
            height = png.readUInt32BE(20);
        let dpi = 300;
        for (let offset = 8; offset + 12 <= png.length; ) {
            const length = png.readUInt32BE(offset);
            if (
                png.subarray(offset + 4, offset + 8).toString() === 'pHYs' &&
                length === 9 &&
                png[offset + 16] === 1
            )
                dpi = png.readUInt32BE(offset + 8) * 0.0254;
            offset += length + 12;
        }
        const scale = Math.min(35.56 / ((width * 25.4) / dpi), 12.7 / ((height * 25.4) / dpi));

        result.push([
            'image',
            ['at', String(widthMm - 30), String(heightMm - 30)],
            ['scale', String(scale)],
            ['uuid', JSON.stringify(uuids.getOrGenerate('header/logo'))],
            ['data', ...png.toString('base64').match(/.{1,76}/g)!],
        ]);
    }
    return result;
}

/** Native worksheet keeps project metadata in the actual bottom-right project box. */
export function schematicWorksheet(): string {
    return `(kicad_wks (version 20220228) (generator "tobias-media-pcb-framework")
      (setup (textsize 1.1 1.1) (linewidth 0.15) (textlinewidth 0.15)
        (left_margin 10) (right_margin 10) (top_margin 10) (bottom_margin 10))
      (rect (start 0 0 ltcorner) (end 0 0 rbcorner))
      (rect (start 180 40 rbcorner) (end 0 0 rbcorner))
      (line (start 40 40 rbcorner) (end 40 0 rbcorner))
      (line (start 180 29 rbcorner) (end 40 29 rbcorner))
      (line (start 180 9 rbcorner) (end 40 9 rbcorner))
      (tbtext "%T" (pos 177 35 rbcorner) (font (size 2 2) bold) (justify left))
      (tbtext "%C1" (pos 177 25 rbcorner) (justify left))
      (tbtext "%Y" (pos 177 20 rbcorner) (font bold) (justify left))
      (tbtext "Date: %D     Revision: %R     Sheet: %S/%N" (pos 177 15 rbcorner) (justify left))
      (tbtext "File: %F" (pos 177 11 rbcorner) (font (size 0.9 0.9)) (justify left))
      (tbtext "%K / with support from Tobias Media PCB Framework" (pos 177 4 rbcorner) (font (size 0.9 0.9)) (justify left))
    )`;
}
