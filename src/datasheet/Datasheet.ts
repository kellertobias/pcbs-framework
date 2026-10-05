import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { renderFootprint, cropPng, FootprintRenderOptions } from './FootprintRenderer';
import { renderModel, ModelView } from './ModelRenderer';
import type { KicadFootprint } from '../synth/KicadFootprint';
export interface DatasheetRow {
    parameter: string;
    value: string;
    source?: string;
}
export interface DatasheetOptions {
    title: string;
    description?: string;
    output: string;
    technicalDetails?: DatasheetRow[];
    electricalDetails?: DatasheetRow[];
    sections?: Array<{ title: string; rows: DatasheetRow[] }>;
    footprints: Array<{
        name: string;
        footprint: string | KicadFootprint;
        notes?: string;
        renderOptions?: FootprintRenderOptions;
    }>;
    /** Contents of a framework-generated coloured WRL, in KiCad units. */
    modelWrl?: string;
    modelViews?: ModelView[];
    illustrations?: Array<{
        title: string;
        png: Buffer | string;
        notes?: string;
        crop?: { x: number; y: number; width: number; height: number };
    }>;
    notes?: string[];
}
/** Flatten source metadata without inventing values or units. */
export function datasheetRows(data: unknown, prefix = ''): DatasheetRow[] {
    if (data === null || data === undefined) return [];
    if (typeof data !== 'object') return [{ parameter: prefix, value: String(data) }];
    if (Array.isArray(data) && data.every((v) => v === null || typeof v !== 'object'))
        return [{ parameter: prefix, value: data.join(', ') }];
    return Object.entries(data).flatMap(([key, v]) =>
        datasheetRows(v, prefix ? `${prefix}.${key}` : key),
    );
}
/** Generate a standalone component datasheet from the same footprint/model assets
 * used by the library. No KiCad installation or shell SVG converter is required.
 */
export async function exportDatasheet(options: DatasheetOptions): Promise<string> {
    if (!options.title || !options.footprints.length)
        throw new Error('A title and at least one footprint are required');
    fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
    const doc = new PDFDocument({
            size: 'A4',
            margin: 40,
            bufferPages: true,
            info: { Title: options.title, Creator: '@tobisk/pcbs datasheet generator' },
        }),
        out = fs.createWriteStream(options.output);
    const finished = new Promise<void>((resolve, reject) => {
        out.on('finish', resolve);
        out.on('error', reject);
        doc.on('error', reject);
    });
    doc.pipe(out);
    const available = doc.page.width - 80;
    const heading = (title: string) => {
        doc.fillColor('#243442')
            .font('Helvetica-Bold')
            .fontSize(18)
            .text(title, 40, doc.y, { width: available });
        doc.moveDown(0.6);
    };
    heading(options.title);
    doc.font('Helvetica').fontSize(10).fillColor('#333333');
    if (options.description) {
        doc.text(options.description);
        doc.moveDown();
    }
    const table = (title: string, rows: DatasheetRow[]) => {
        if (!rows.length) return;
        if (doc.y > 650) doc.addPage();
        heading(title);
        const widths = [available * 0.36, available * 0.48, available * 0.16];
        const header = () => {
            const y = doc.y;
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#243442');
            ['Parameter', 'Value / condition', 'Source'].forEach((s, i) =>
                doc.text(s, 40 + widths.slice(0, i).reduce((a, b) => a + b, 0), y, {
                    width: widths[i] - 8,
                }),
            );
            doc.y = y + 23;
        };
        header();
        for (const row of rows) {
            const cells = [row.parameter, row.value, row.source ?? ''];
            doc.font('Helvetica').fontSize(9);
            const height =
                Math.max(...cells.map((s, i) => doc.heightOfString(s, { width: widths[i] - 8 }))) +
                12;
            if (height > 650) throw new Error(`Datasheet row too long: ${row.parameter}`);
            if (doc.y + height > doc.page.height - 60) {
                doc.addPage();
                heading(`${title} (continued)`);
                header();
            }
            const y = doc.y;
            cells.forEach((s, i) =>
                doc
                    .fillColor(i === 2 ? '#66727f' : '#333333')
                    .text(s, 40 + widths.slice(0, i).reduce((a, b) => a + b, 0), y, {
                        width: widths[i] - 8,
                    }),
            );
            doc.moveTo(40, y + height - 5)
                .lineTo(doc.page.width - 40, y + height - 5)
                .strokeColor('#e3e7eb')
                .lineWidth(0.4)
                .stroke();
            doc.y = y + height;
        }
        doc.moveDown();
    };
    table('Technical details', options.technicalDetails ?? []);
    table('Electrical details', options.electricalDetails ?? []);
    for (const section of options.sections ?? []) table(section.title, section.rows);
    if (options.notes?.length) {
        if (doc.y > 600) doc.addPage();
        heading('Notes and provenance');
        doc.font('Helvetica').fontSize(10).fillColor('#333333');
        for (const note of options.notes) {
            doc.text(note);
            doc.moveDown(0.5);
        }
    }
    const figure = (title: string, png: Buffer | string, notes?: string) => {
        doc.addPage();
        heading(title);
        if (notes) {
            doc.font('Helvetica').fontSize(10).fillColor('#444444').text(notes);
            doc.moveDown();
        }
        const y = doc.y,
            bytes = typeof png === 'string' ? fs.readFileSync(png) : png,
            iw = bytes.readUInt32BE(16),
            ih = bytes.readUInt32BE(20),
            scale = Math.min(available / iw, (doc.page.height - y - 65) / ih);
        doc.image(bytes, 40, y, { fit: [available, doc.page.height - y - 65], align: 'center' });
        doc.y = y + ih * scale + 20;
    };
    for (const fp of options.footprints) {
        const rendered = renderFootprint(fp.footprint, { width: 2000, ...fp.renderOptions });
        figure(
            `Footprint - ${fp.name}`,
            rendered.png,
            `${fp.notes ?? ''} Top view; KiCad coordinates in mm. Pads shown in pink, drills in green. Bounds: ${(rendered.bounds.maxX - rendered.bounds.minX).toFixed(2)} x ${(rendered.bounds.maxY - rendered.bounds.minY).toFixed(2)} mm including render margin.`,
        );
        table(
            'Pad centres',
            rendered.pads.map((p) => ({
                parameter: `Pad ${p.number}`,
                value: `X ${p.x.toFixed(3)}, Y ${p.y.toFixed(3)} mm${p.drill ? `; drill ${typeof p.drill === 'number' ? p.drill.toFixed(2) : `${p.drill.x.toFixed(2)} x ${p.drill.y.toFixed(2)} oval`} mm` : ''}`,
            })),
        );
        if (options.modelWrl)
            figure(
                `Underside + footprint - ${fp.name}`,
                renderModel(options.modelWrl, {
                    view: 'bottom',
                    footprint: fp.footprint,
                    width: 2000,
                    height: 850,
                }).png,
                'Model and footprint share the same origin and mm scale. The underside reverses KiCad Y. The overlay checks projected pad positions; mounting clearance requires separate validation.',
            );
    }
    if (options.modelWrl)
        for (const view of options.modelViews ?? ['isometric', 'side', 'end'])
            figure(
                `Library-generated 3D model - ${view}`,
                renderModel(options.modelWrl, { view, width: 1800, height: 900 }).png,
                'Dimensions shown are measured model spans. Manufacturer dimensions and estimates are identified in the technical details.',
            );
    for (const illustration of options.illustrations ?? [])
        figure(
            illustration.title,
            illustration.crop
                ? cropPng(
                      typeof illustration.png === 'string'
                          ? fs.readFileSync(illustration.png)
                          : illustration.png,
                      illustration.crop,
                  )
                : illustration.png,
            illustration.notes,
        );
    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i++) {
        doc.switchToPage(i);
        doc.font('Helvetica')
            .fontSize(8)
            .fillColor('#66727f')
            .text(
                `${options.title} | Generated from library assets | ${i + 1}/${pages.count}`,
                40,
                doc.page.height - 55,
                { width: available, lineBreak: false },
            );
    }
    doc.end();
    await finished;
    return path.resolve(options.output);
}
