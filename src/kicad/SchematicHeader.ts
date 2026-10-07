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
/** Header uses native KiCad text and an embedded PNG, so it survives native PDF export. */
export function schematicHeader(snapshot: CircuitSnapshot, uuids: UuidManager): SExpr[] {
    const result: SExpr[] = [];
    let x = 15.24;
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
        const mmWidth = ((width * 25.4) / dpi) * scale;
        result.push([
            'image',
            ['at', String(x + mmWidth / 2), '18'],
            ['scale', String(scale)],
            ['uuid', JSON.stringify(uuids.getOrGenerate('header/logo'))],
            ['data', ...png.toString('base64').match(/.{1,76}/g)!],
        ]);
        x += mmWidth + 5.08;
    }
    const text = (value: string, y: number, size: number, key: string, bold = false): SExpr => [
        'text',
        JSON.stringify(value),
        ['at', String(x), String(y), '0'],
        [
            'effects',
            ['font', ['size', String(size), String(size)], ...(bold ? ['bold'] : [])],
            ['justify', 'left', 'top'],
        ],
        ['uuid', JSON.stringify(uuids.getOrGenerate(`header/${key}`))],
    ];
    result.push(text(snapshot.projectName ?? snapshot.name, 11.43, 3, 'title', true));
    const description = snapshot.description ?? '';
    const words = description.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    for (const word of words) {
        if (!lines.length || lines[lines.length - 1].length + word.length + 1 > 100)
            lines.push(word);
        else lines[lines.length - 1] += ` ${word}`;
    }
    if (lines.length > 3)
        throw new Error(
            'Schematic description exceeds the three-line header; use group decision notes for detailed explanations.',
        );
    lines.forEach((line, i) =>
        result.push(text(line, 18.415 + i * 2.54, 1.27, `description/${i}`)),
    );
    return result;
}
