import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineRenderSeries } from '../synth/RenderSeries';
import { executeRenderSeries, planRenderSeries } from '../cli/commands/render-series';
const directories: string[] = [];
afterEach(() =>
    directories
        .splice(0)
        .forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })),
);
function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'render-series-test-'));
    directories.push(directory);
    fs.writeFileSync(path.join(directory, 'board.kicad_pcb'), '(kicad_pcb)');
    return directory;
}
describe('declarative render batches', () => {
    it('resolves relative paths, camera controls and model origin in declaration order', async () => {
        const directory = fixture();
        const jobs = planRenderSeries(
            defineRenderSeries({
                board: 'board.kicad_pcb',
                outputDirectory: 'views',
                renders: [
                    { name: 'assembly-model', kind: 'model', origin: [53, 8.5] },
                    {
                        name: 'underside',
                        kind: '3d',
                        side: 'bottom',
                        rotate: [-35, 0, 25],
                        zoom: 0.55,
                        pan: [1, 2, 0],
                        pivot: [-2, 0, 0],
                    },
                    {
                        name: 'copper',
                        kind: 'layers',
                        layers: ['B.Cu', 'Edge.Cuts'],
                        side: 'bottom',
                    },
                ],
            }),
            directory,
        );
        expect(jobs[0].args).toContain('53x8.5mm');
        expect(jobs[1].args).toContain(path.join(directory, 'views/underside.png'));
        expect(jobs[1].args).toEqual(
            expect.arrayContaining([
                '--rotate',
                '-35,0,25',
                '--zoom',
                '0.55',
                '--pan',
                '1,2,0',
                '--pivot',
                '-2,0,0',
            ]),
        );
        expect(jobs[2].args).toContain('B.Cu,Edge.Cuts');
        const seen: string[] = [];
        await executeRenderSeries(jobs, async (_args, kind) => {
            seen.push(kind);
        });
        expect(seen).toEqual(['model', '3d', 'layers']);
    });
    it('selects named views and supports an alternate board/output directory', () => {
        const directory = fixture();
        fs.writeFileSync(path.join(directory, 'stress.kicad_pcb'), '(kicad_pcb)');
        const jobs = planRenderSeries(
            {
                board: 'board.kicad_pcb',
                renders: [
                    { name: 'normal', kind: '3d' },
                    { name: 'stress', kind: '3d', board: 'stress.kicad_pcb' },
                ],
            },
            directory,
            { only: ['stress'], outputDirectory: 'selected' },
        );
        expect(jobs).toHaveLength(1);
        expect(jobs[0].args[0]).toBe(path.join(directory, 'stress.kicad_pcb'));
        expect(jobs[0].args).toContain(path.join(directory, 'selected/stress.png'));
        expect(() =>
            planRenderSeries({ renders: [{ name: 'normal', kind: '3d' }] }, directory, {
                only: ['missing'],
            }),
        ).toThrow('Unknown render');
    });
    it('rejects conflicting outputs, duplicate names, missing boards and invalid camera values before rendering', () => {
        const directory = fixture();
        const series = {
            board: 'board.kicad_pcb',
            renders: [
                { name: 'first', kind: '3d' as const },
                { name: 'second', kind: '3d' as const },
            ],
        };
        expect(() =>
            planRenderSeries(
                { ...series, renders: [series.renders[0], series.renders[0]] },
                directory,
            ),
        ).toThrow('duplicate');
        expect(() =>
            planRenderSeries(
                { ...series, renders: series.renders.map((r) => ({ ...r, output: 'same.png' })) },
                directory,
            ),
        ).toThrow('Conflicting');
        expect(() => planRenderSeries({ ...series, board: 'absent.kicad_pcb' }, directory)).toThrow(
            'Board missing',
        );
        expect(() =>
            planRenderSeries(
                { ...series, renders: [{ ...series.renders[0], zoom: -1 }] },
                directory,
            ),
        ).toThrow('Invalid zoom');
        expect(() =>
            planRenderSeries(
                { ...series, renders: [{ ...series.renders[0], output: 'board.kicad_pcb' }] },
                directory,
            ),
        ).toThrow('Conflicting');
    });
    it('stops on failure and names the failed render', async () => {
        const directory = fixture();
        const jobs = planRenderSeries(
            {
                board: 'board.kicad_pcb',
                renders: [
                    { name: 'first', kind: '3d' },
                    { name: 'second', kind: '3d' },
                ],
            },
            directory,
        );
        const render = vi.fn().mockRejectedValue(new Error('native renderer failed'));
        await expect(executeRenderSeries(jobs, render)).rejects.toThrow("Render 'first' failed");
        expect(render).toHaveBeenCalledTimes(1);
    });
});
