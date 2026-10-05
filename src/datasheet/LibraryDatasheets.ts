import * as fs from 'fs';
import * as path from 'path';
import { exportDatasheet, DatasheetOptions } from './Datasheet';
import { renderFootprint } from './FootprintRenderer';
import type { KicadFootprint } from '../synth/KicadFootprint';

/** Optional component facts. Geometry and pad measurements are always automatic. */
export type ComponentDatasheetMetadata = Pick<
    DatasheetOptions,
    | 'title'
    | 'description'
    | 'technicalDetails'
    | 'electricalDetails'
    | 'sections'
    | 'notes'
    | 'illustrations'
    | 'modelViews'
> & {
    footprintNotes?: string;
    renderOptions?: DatasheetOptions['footprints'][number]['renderOptions'];
};
export interface LibraryDatasheetEntry {
    name: string;
    footprint: string | KicadFootprint;
    metadata?: Partial<ComponentDatasheetMetadata>;
    /** Already transformed into the footprint local frame. */
    modelWrl?: string;
}
export interface LibraryDatasheetResult {
    name: string;
    pdf: string;
}

/** One standard PDF per footprint, including mechanical-only parts and variants.
 * Attempts every entry and reports all failures rather than silently skipping parts.
 */
export async function exportLibraryDatasheets(
    entries: readonly LibraryDatasheetEntry[],
    outputDir: string,
): Promise<LibraryDatasheetResult[]> {
    fs.mkdirSync(outputDir, { recursive: true });
    const names = new Set<string>();
    for (const entry of entries) {
        if (!entry.name || /[\\/]/.test(entry.name) || entry.name === '.' || entry.name === '..')
            throw new Error(`Unsafe footprint name: ${entry.name}`);
        if (names.has(entry.name)) throw new Error(`Duplicate footprint datasheet: ${entry.name}`);
        names.add(entry.name);
    }
    const results: LibraryDatasheetResult[] = [],
        failures: string[] = [];
    for (const entry of entries) {
        try {
            const metadata =
                entry.metadata ??
                (typeof entry.footprint === 'string' ? undefined : entry.footprint.datasheet) ??
                {};
            const renderOptions = { labelPosition: 'right' as const, ...metadata.renderOptions };
            const rendered = renderFootprint(entry.footprint, renderOptions);
            const notes = [...(metadata.notes ?? [])];
            if (!metadata.electricalDetails?.length)
                notes.push(
                    'Electrical ratings have not been supplied by this component definition.',
                );
            if (!entry.modelWrl)
                notes.push(
                    'No compatible library-generated 3D model was supplied for this footprint.',
                );
            const pdf = await exportDatasheet({
                ...metadata,
                title: metadata.title ?? entry.name,
                output: path.join(outputDir, `${entry.name}.pdf`),
                technicalDetails: [
                    { parameter: 'Footprint', value: entry.name, source: 'Library' },
                    {
                        parameter: 'Pad count (including mechanical holes)',
                        value: String(rendered.pads.length),
                        source: 'Footprint',
                    },
                    {
                        parameter: 'Coordinate convention',
                        value: 'Local KiCad X/Y in mm; top view',
                        source: 'Footprint',
                    },
                    ...(metadata.technicalDetails ?? []),
                ],
                notes,
                modelWrl: entry.modelWrl,
                footprints: [
                    {
                        name: entry.name,
                        footprint: entry.footprint,
                        notes: metadata.footprintNotes,
                        renderOptions,
                    },
                ],
            });
            results.push({ name: entry.name, pdf });
            // Sidecar retains typed metadata for later export from serialized assets.
            fs.writeFileSync(
                path.join(outputDir, `${entry.name}.json`),
                JSON.stringify(
                    {
                        ...metadata,
                        illustrations: undefined,
                    },
                    null,
                    2,
                ) + '\n',
            );
        } catch (error) {
            failures.push(`${entry.name}: ${error instanceof Error ? error.message : error}`);
        }
    }
    fs.writeFileSync(
        path.join(outputDir, 'index.json'),
        JSON.stringify(
            {
                footprints: results.map((result) => ({
                    name: result.name,
                    pdf: path.basename(result.pdf),
                })),
                failures,
            },
            null,
            2,
        ) + '\n',
    );
    if (failures.length)
        throw new Error(
            `Datasheet generation failed for ${failures.length} footprint(s):\n${failures.join('\n')}`,
        );
    return results;
}
