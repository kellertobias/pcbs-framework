import { outputPaths, resolveGeneratedInput } from '../../project/OutputPaths';
import fs from 'node:fs';
import path from 'node:path';
import type { BoardRender, RenderSeries } from '../../synth/RenderSeries';
import { cmdRenderBoard } from './render-board';

interface RenderJob {
    name: string;
    kind: BoardRender['kind'];
    args: string[];
}
interface SeriesOptions {
    only?: readonly string[];
    outputDirectory?: string;
}
/** Validate the entire selected batch before starting native KiCad. */
export function planRenderSeries(
    series: RenderSeries,
    baseDirectory: string,
    options: SeriesOptions = {},
): RenderJob[] {
    if (!series || !Array.isArray(series.renders) || !series.renders.length)
        throw new Error('Render series must contain at least one render.');
    const names = new Set<string>();
    const outputs = new Set<string>();
    const inputs = new Set(
        series?.renders
            ?.map((render) => render.board ?? series.board)
            .filter((board): board is string => typeof board === 'string')
            .map((board) => path.resolve(baseDirectory, board)),
    );
    for (const render of series.renders) {
        if (!render.name || !/^[\w.-]+$/.test(render.name) || names.has(render.name))
            throw new Error(`Invalid or duplicate render name: ${render.name}`);
        names.add(render.name);
    }
    for (const name of options.only ?? [])
        if (!names.has(name)) throw new Error(`Unknown render: ${name}`);
    const directory = path.resolve(
        baseDirectory,
        options.outputDirectory ?? series.outputDirectory ?? outputPaths(baseDirectory).renders,
    );
    return series.renders
        .filter((render) => !options.only || options.only.includes(render.name))
        .map((render) => {
            if (!['layers', '3d', 'model'].includes(render.kind))
                throw new Error(`Unknown render kind: ${render.kind}`);
            const input = render.board ?? series.board;
            if (!input) throw new Error(`No board specified for ${render.name}`);
            const board = resolveGeneratedInput(path.resolve(baseDirectory, input));
            if (!fs.existsSync(board)) throw new Error(`Board missing: ${board}`);
            const output = path.resolve(
                render.kind === 'model' && !options.outputDirectory && !series.outputDirectory
                    ? outputPaths(baseDirectory).export
                    : directory,
                options.outputDirectory && render.output
                    ? path.basename(render.output)
                    : (render.output ??
                          `${render.name}.${render.kind === 'model' ? 'wrl' : 'png'}`),
            );
            if (inputs.has(output) || outputs.has(output))
                throw new Error(`Conflicting render output: ${output}`);
            outputs.add(output);
            const args = [board, '--output', output];
            const add = (flag: string, value: unknown) => {
                if (value !== undefined)
                    args.push(flag, Array.isArray(value) ? value.join(',') : String(value));
            };
            if (render.kind === 'model') {
                if (render.origin) {
                    if (render.origin.length !== 2 || !render.origin.every(Number.isFinite))
                        throw new Error(`Invalid origin for ${render.name}`);
                    add('--origin', `${render.origin[0]}x${render.origin[1]}mm`);
                }
            } else {
                for (const key of ['width', ...(render.kind === '3d' ? ['height', 'zoom'] : [])]) {
                    const value = (render as unknown as Record<string, unknown>)[key];
                    if (
                        value !== undefined &&
                        (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
                    )
                        throw new Error(`Invalid ${key} for ${render.name}`);
                    add(`--${key}`, value);
                }
                if (
                    render.side &&
                    !(
                        render.kind === 'layers'
                            ? ['top', 'bottom']
                            : ['top', 'bottom', 'left', 'right', 'front', 'back']
                    ).includes(render.side)
                )
                    throw new Error(`Invalid side for ${render.name}`);
                add('--side', render.side);
                if (render.kind === 'layers') {
                    if (
                        render.layers &&
                        (!render.layers.length ||
                            render.layers.some(
                                (layer: unknown) => typeof layer !== 'string' || !layer,
                            ))
                    )
                        throw new Error(`Invalid layers for ${render.name}`);
                    add('--layers', render.layers);
                    if (render.mirror) args.push('--mirror');
                } else {
                    for (const key of ['rotate', 'pan', 'pivot'] as const) {
                        const vector = render[key];
                        if (vector && (vector.length !== 3 || !vector.every(Number.isFinite)))
                            throw new Error(`Invalid ${key} for ${render.name}`);
                        add(`--${key}`, vector);
                    }
                }
            }
            return { name: render.name, kind: render.kind, args };
        });
}
export async function executeRenderSeries(
    jobs: readonly RenderJob[],
    render = cmdRenderBoard,
): Promise<void> {
    for (const [index, job] of jobs.entries()) {
        console.log(`[${index + 1}/${jobs.length}] Rendering ${job.name}`);
        try {
            await render(job.args, job.kind);
        } catch (error) {
            throw new Error(
                `Render '${job.name}' failed: ${error instanceof Error ? error.message : error}`,
            );
        }
    }
}
export async function cmdRenderSeries(args: string[]): Promise<void> {
    const entry = args[0];
    if (!entry || entry.startsWith('--'))
        throw new Error('Usage: renders series.ts [--only name,name] [--output-dir directory]');
    const options: SeriesOptions = {};
    for (let i = 1; i < args.length; i++) {
        const flag = args[i];
        if (!['--only', '--output-dir'].includes(flag))
            throw new Error(`Unknown renders option: ${flag}`);
        const value = args[++i];
        if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
        if (flag === '--only') options.only = value.split(',');
        else options.outputDirectory = path.resolve(value);
    }
    const file = path.resolve(entry);
    const exported = require(file);
    const series = (exported.default ?? exported) as RenderSeries;
    await executeRenderSeries(planRenderSeries(series, path.dirname(file), options));
}
