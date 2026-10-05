import { assemblyWorldMatrix, validateAssemblyHierarchy } from './transforms';
import { buildPanelModel, projectPanelCutouts, panelSVG, panelDXF } from './front-panel';
import { threeMFMillimetreScale } from './model-units';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Assembly, type AssemblyVector, type AssemblyPart, AssemblyView } from '../synth/Assembly';

export interface PreparedPart {
    id: string;
    name: string;
    kind: AssemblyPart['kind'];
    url: string;
    format: string;
    unitScale: number;
    upAxis: 'y' | 'z';
    position: AssemblyVector;
    rotation: AssemblyVector;
    visible: boolean;
    group?: string;
}
export interface PreparedAssembly {
    revision?: number;
    name: string;
    unit: 'mm';
    views?: AssemblyView[];
    parts: PreparedPart[];
}
export const MODEL_FORMATS = ['wrl', 'stl', 'obj', 'glb', 'gltf', '3mf'];
export function resolveAssemblyBoard(
    part: Extract<AssemblyPart, { kind: 'board' }>,
    base: string,
): string {
    let file: string;
    if (part.schematic)
        file = path.resolve(base, part.sourceDirectory!, `${part.schematic.name}.kicad_pcb`);
    else {
        file = path.resolve(base, part.file!);
        const ext = path.extname(file).toLowerCase();
        if (ext === '.kicad_sch') file = file.replace(/\.kicad_sch$/i, '.kicad_pcb');
        else if (['.ts', '.js'].includes(ext)) {
            const exported = require(file);
            const schematic = exported.default ?? exported;
            if (
                typeof schematic.name !== 'string' ||
                typeof schematic._generateWithCapture !== 'function'
            )
                throw new Error(`Not a schematic entry: ${file}`);
            file = path.join(path.dirname(file), `${schematic.name}.kicad_pcb`);
        } else if (ext !== '.kicad_pcb') throw new Error(`Unsupported board source: ${file}`);
    }
    if (!fs.existsSync(file))
        throw new Error(`PCB missing: ${file}. Synthesize the board before viewing.`);
    return file;
}
export async function exportBoardModel(
    board: string,
    output: string,
    origin: [number, number],
): Promise<void> {
    const binary =
        process.env.KICAD_CLI ??
        (fs.existsSync('/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli')
            ? '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli'
            : 'kicad-cli');
    const before = fs.readFileSync(board);
    await promisify(execFile)(
        binary,
        [
            'pcb',
            'export',
            'vrml',
            '--force',
            '--units',
            'mm',
            '--user-origin',
            `${origin[0]}x${origin[1]}mm`,
            '--output',
            output,
            board,
        ],
        { timeout: 180000, maxBuffer: 16 * 1024 * 1024 },
    );
    if (!before.equals(fs.readFileSync(board)))
        throw new Error(`Native export changed PCB: ${board}`);
}
/** Preflight all file sources before any native exports. Outputs are session assets. */
export async function prepareAssembly(
    assembly: Assembly,
    base: string,
    output: string,
    boardExporter = exportBoardModel,
): Promise<PreparedAssembly> {
    if (!(assembly instanceof Assembly) || !assembly.parts.length)
        throw new Error('Expected a nonempty Assembly');
    validateAssemblyHierarchy(assembly.parts);
    const sources = assembly.parts.map((part) => {
        if (part.kind === 'generated' || part.kind === 'front-panel' || part.kind === 'group')
            return undefined;
        if (part.kind === 'board') return resolveAssemblyBoard(part, base);
        const file = path.resolve(base, part.file);
        if (!fs.existsSync(file)) throw new Error(`Model missing: ${file}`);
        if (!MODEL_FORMATS.includes(path.extname(file).slice(1).toLowerCase()))
            throw new Error(
                `Unsupported model format: ${file}. Supported: ${MODEL_FORMATS.join(', ')}`,
            );
        return file;
    });
    const manifest: PreparedAssembly = {
        name: assembly.name,
        unit: 'mm',
        views: assembly.views,
        parts: [],
    };
    for (const view of assembly.views)
        if (view.visibleParts?.some((id) => !assembly.parts.some((p) => p.id === id)))
            throw new Error(`Unknown visible part in view ${view.id}`);
    for (const panel of assembly.parts)
        if (panel.kind === 'front-panel')
            for (const source of panel.sources) {
                const id = typeof source === 'string' ? source : source.part;
                if (!assembly.parts.some((p) => p.id === id && p.kind === 'board'))
                    throw new Error(`Panel source must be a board: ${id}`);
            }
    // Prepare every board before projecting panels, regardless of part ordering.
    for (const [i, part] of assembly.parts.entries())
        if (part.kind === 'board') {
            const { prepareBoardPreview } = await import('./board-preview');
            sources[i] = await prepareBoardPreview(
                part,
                base,
                sources[i]!,
                path.join(output, 'assets', part.id, 'pcb'),
            );
        }
    for (const [i, part] of assembly.parts.entries()) {
        if (part.kind === 'group') {
            manifest.parts.push({
                id: part.id,
                name: part.name ?? part.id,
                kind: 'group',
                format: 'group',
                url: '',
                unitScale: 1,
                upAxis: 'z',
                position: part.position ?? [0, 0, 0],
                rotation: part.rotation ?? [0, 0, 0],
                visible: part.visible ?? true,
                group: part.group,
            });
            continue;
        }
        const directory = path.join(output, 'assets', part.id);
        fs.mkdirSync(directory, { recursive: true });
        let format = 'wrl',
            unitScale = 2.54,
            upAxis: 'y' | 'z' = 'z';
        let target = path.join(directory, 'model.wrl');
        if (part.kind === 'board') {
            await boardExporter(sources[i]!, target, part.origin ?? [0, 0]);
            unitScale = 1;
        } else if (part.kind === 'generated' || part.kind === 'front-panel') {
            let model;
            if (part.kind === 'front-panel') {
                const panelSources = part.sources.map((source) => {
                    const id = typeof source === 'string' ? source : source.part;
                    const index = assembly.parts.findIndex((p) => p.id === id);
                    return {
                        part: assembly.parts[index] as Extract<AssemblyPart, { kind: 'board' }>,
                        file: sources[index]!,
                        worldMatrix: assemblyWorldMatrix(assembly.parts[index], assembly.parts),
                        references: typeof source === 'string' ? undefined : source.references,
                    };
                });
                const cuts = projectPanelCutouts(
                    part,
                    panelSources,
                    assemblyWorldMatrix(part, assembly.parts),
                );
                const result = buildPanelModel(part, cuts);
                model = result.model;
                fs.writeFileSync(path.join(directory, 'panel.dxf'), panelDXF(result.polygons));
                fs.writeFileSync(path.join(directory, 'panel.svg'), panelSVG(result.polygons));
                fs.writeFileSync(
                    path.join(directory, 'cutouts.json'),
                    JSON.stringify(
                        {
                            unit: 'mm',
                            outline: part.outline,
                            cutouts: [...cuts, ...(part.cutouts ?? [])],
                            meshChordTolerance: 0.01,
                            folds: part.folds,
                            reliefs: part.reliefs,
                        },
                        null,
                        2,
                    ),
                );
            } else model = typeof part.model === 'function' ? await part.model() : part.model;
            const result = await model.export({
                outDir: directory,
                baseName: 'model',
                formats: ['wrl'],
            });
            if (!result.wrlPath || !fs.existsSync(result.wrlPath))
                throw new Error(`Generator produced no WRL: ${part.id}`);
        } else {
            format = path.extname(sources[i]!).slice(1).toLowerCase();
            target = path.join(directory, `model.${format}`);
            fs.copyFileSync(sources[i]!, target);
            const unit =
                part.unit ??
                (format === 'wrl' ? 'tenths' : ['gltf', 'glb'].includes(format) ? 'm' : 'mm');
            unitScale =
                format === '3mf' && !part.unit
                    ? threeMFMillimetreScale(fs.readFileSync(target))
                    : { mm: 1, m: 1000, tenths: 2.54 }[unit];
            upAxis = part.upAxis ?? (['gltf', 'glb'].includes(format) ? 'y' : 'z');
            if (format === 'gltf') {
                const gltf = JSON.parse(fs.readFileSync(target, 'utf8'));
                for (const resource of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
                    if (!resource.uri || resource.uri.startsWith('data:')) continue;
                    const uri = decodeURIComponent(resource.uri);
                    if (/^[a-z]+:/i.test(uri) || path.isAbsolute(uri))
                        throw new Error('GLTF resources must be local relative files');
                    const resourceTarget = path.resolve(directory, uri);
                    if (!resourceTarget.startsWith(directory + path.sep))
                        throw new Error('GLTF resource escapes its model directory');
                    fs.mkdirSync(path.dirname(resourceTarget), { recursive: true });
                    fs.copyFileSync(path.resolve(path.dirname(sources[i]!), uri), resourceTarget);
                }
            }
        }
        manifest.parts.push({
            id: part.id,
            name: part.name ?? part.id,
            kind: part.kind,
            url: `/assets/${part.id}/${path.basename(target)}`,
            format,
            unitScale,
            upAxis,
            position: part.position ?? [0, 0, 0],
            rotation: part.rotation ?? [0, 0, 0],
            visible: part.visible ?? true,
            group: part.group,
        });
    }
    fs.writeFileSync(path.join(output, 'assembly.json'), JSON.stringify(manifest, null, 2));
    return manifest;
}
