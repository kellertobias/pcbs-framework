import { outputPaths } from '../../project/OutputPaths';
import { getConfig } from '../config';
import { exportLibraryDatasheets, LibraryDatasheetEntry } from '../../datasheet/LibraryDatasheets';
import { renderModel } from '../../datasheet/ModelRenderer';
import { SExpressionParser, SExpr } from '../../kicad/SExpressionParser';
import * as fs from 'fs';
import * as path from 'path';
import { exportDatasheet, DatasheetOptions } from '../../datasheet/Datasheet';
import { renderFootprint } from '../../datasheet/FootprintRenderer';
export async function cmdDatasheet(args: string[]) {
    if (args.includes('--all')) {
        const { projectRoot } = getConfig();
        const sourceDir = path.join(projectRoot, '.kicad', 'Project_Footprints.pretty');
        const outputDir = args.includes('--output')
            ? path.resolve(args[args.indexOf('--output') + 1])
            : path.join(outputPaths(projectRoot).export, 'datasheets');
        const metadataDir = path.join(projectRoot, '.kicad', 'datasheets', 'footprints');
        const files = fs
            .readdirSync(sourceDir)
            .filter((file) => file.endsWith('.kicad_mod'))
            .sort();
        if (!files.length) throw new Error(`No footprints in ${sourceDir}`);
        const entries: LibraryDatasheetEntry[] = files.map((file) => {
            const name = path.basename(file, '.kicad_mod'),
                footprint = fs.readFileSync(path.join(sourceDir, file), 'utf8');
            const metadataFile = path.join(metadataDir, `${name}.json`);
            const metadata = fs.existsSync(metadataFile)
                ? JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
                : {};
            let modelWrl: string | undefined;
            const root = SExpressionParser.parse(footprint).find(
                (n): n is SExpr[] =>
                    Array.isArray(n) && ['footprint', 'module'].includes(String(n[0])),
            );
            const models =
                root?.filter((n): n is SExpr[] => Array.isArray(n) && n[0] === 'model') ?? [];
            if (models.length) {
                try {
                    if (models.length !== 1)
                        throw new Error('Multiple model links require a composed library model');
                    const link = models[0];
                    for (const [field, expected] of [
                        ['offset', 0],
                        ['rotate', 0],
                        ['scale', 1],
                    ] as const) {
                        const setting = link.find((n) => Array.isArray(n) && n[0] === field) as
                            | SExpr[]
                            | undefined;
                        const xyz = setting?.find((n) => Array.isArray(n) && n[0] === 'xyz') as
                            | SExpr[]
                            | undefined;
                        if (xyz && xyz.slice(1).some((n) => Number(n) !== expected))
                            throw new Error(`Model ${field} requires a transformed library model`);
                    }
                    const declaredPath = SExpressionParser.unquote(String(link[1]));
                    let modelPath = path.resolve(
                        projectRoot,
                        declaredPath.replace(/\$\{KIPRJMOD\}/g, projectRoot),
                    );
                    // Library assets may be referenced relative to a nested board's
                    // KIPRJMOD. Resolve the same named generated library model.
                    if (!fs.existsSync(modelPath) && declaredPath.includes('/.kicad/3d/')) {
                        modelPath = path.join(
                            projectRoot,
                            '.kicad',
                            '3d',
                            path.basename(declaredPath),
                        );
                    }
                    if (!/\.wrl$/i.test(modelPath))
                        throw new Error('Linked model is not a framework WRL');
                    modelWrl = fs.readFileSync(modelPath, 'utf8');
                    renderModel(modelWrl, { view: 'top', width: 200, height: 200 });
                } catch (error) {
                    modelWrl = undefined;
                    metadata.notes = [
                        ...(metadata.notes ?? []),
                        `3D rendering unavailable: ${error instanceof Error ? error.message : error}`,
                    ];
                }
            }
            return { name, footprint, metadata, modelWrl };
        });
        const results = await exportLibraryDatasheets(entries, outputDir);
        console.log(`${results.length} footprint PDFs → ${outputDir}`);
        return;
    }
    if (!args[0]) throw new Error('Usage: pcb datasheet manifest.json [--output file.pdf]');
    const manifestPath = path.resolve(args[0]),
        base = path.dirname(manifestPath),
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const file = (p: string) => path.resolve(base, p);
    const options: DatasheetOptions = {
        ...manifest,
        output: args.includes('--output')
            ? path.resolve(args[args.indexOf('--output') + 1])
            : path.join(
                  outputPaths(base).export,
                  path.basename(manifest.output ?? 'datasheet.pdf'),
              ),
        footprints: manifest.footprints.map((f: any) => ({
            ...f,
            footprint: fs.readFileSync(file(f.path), 'utf8'),
        })),
        modelWrl: manifest.modelPath
            ? fs.readFileSync(file(manifest.modelPath), 'utf8')
            : undefined,
        illustrations: manifest.illustrations?.map((i: any) => ({ ...i, png: file(i.path) })),
    };
    console.log(await exportDatasheet(options));
}
export async function cmdFootprintPng(args: string[]) {
    if (!args[0])
        throw new Error('Usage: pcb footprint-png file.kicad_mod [--output file.png] [--bottom]');
    const result = renderFootprint(fs.readFileSync(args[0], 'utf8'), {
        side: args.includes('--bottom') ? 'bottom' : 'top',
    });
    const output = args.includes('--output')
        ? args[args.indexOf('--output') + 1]
        : path.join(
              outputPaths(path.dirname(path.resolve(args[0]))).renders,
              path.basename(args[0], '.kicad_mod') + '.png',
          );
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, result.png);
    console.log(path.resolve(output));
}
