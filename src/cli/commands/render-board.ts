import { outputPaths, resolveGeneratedInput } from '../../project/OutputPaths';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
/** Read-only KiCad-native board plots/renders. Never synthesize or replace source. */
export async function cmdRenderBoard(
    args: string[],
    kind: 'layers' | '3d' | 'model',
): Promise<void> {
    const input = args[0];
    if (!input || input.startsWith('--'))
        throw new Error(
            'Usage: pcb-png|pcb-3d|pcb-model board.kicad_pcb --output file [--layers list] [--origin XxYmm]',
        );
    function option(flag: string, fallback: string) {
        const i = args.indexOf(flag);
        return i < 0 ? fallback : args[i + 1];
    }
    const board = resolveGeneratedInput(input);
    if (!fs.existsSync(board)) throw new Error(`Board missing: ${board}`);
    const output = path.resolve(
        option(
            '--output',
            path.join(
                kind === 'model'
                    ? outputPaths(path.dirname(board)).export
                    : outputPaths(path.dirname(board)).renders,
                path.basename(board, '.kicad_pcb') +
                    (kind === 'model' ? '.wrl' : kind === 'layers' ? '-layers.png' : '-3d.png'),
            ),
        ),
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const binary =
        process.env.KICAD_CLI ??
        (fs.existsSync('/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli')
            ? '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli'
            : 'kicad-cli');
    function run(parameters: string[]) {
        const r = spawnSync(binary, parameters, {
            encoding: 'utf8',
            timeout: 180000,
            maxBuffer: 8 * 1024 * 1024,
        });
        if (r.error || r.status !== 0)
            throw new Error(r.error?.message ?? r.stderr ?? `KiCad exited ${r.status}`);
    }
    const before = fs.readFileSync(board);
    if (kind === 'layers') {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-png-'));
        try {
            const svg = path.join(tmp, 'board.svg');
            run([
                'pcb',
                'export',
                'svg',
                '--mode-single',
                '--output',
                svg,
                '--layers',
                option('--layers', 'F.Cu,B.Cu,F.SilkS,B.SilkS,Edge.Cuts'),
                '--page-size-mode',
                '2',
                '--exclude-drawing-sheet',
                ...(args.includes('--mirror') || option('--side', 'top') === 'bottom'
                    ? ['--mirror']
                    : []),
                board,
            ]);
            const render = new Resvg(fs.readFileSync(svg), {
                background: 'white',
                fitTo: { mode: 'width', value: Number(option('--width', '2400')) },
            });
            fs.writeFileSync(output, render.render().asPng());
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    } else if (kind === '3d')
        run([
            'pcb',
            'render',
            '--output',
            output,
            '--width',
            option('--width', '2200'),
            '--height',
            option('--height', '1200'),
            '--background',
            'opaque',
            '--quality',
            'high',
            '--side',
            option('--side', 'top'),
            '--rotate',
            option('--rotate', '-35,0,25'),
            '--zoom',
            option('--zoom', '1'),
            ...(args.includes('--pan') ? ['--pan', option('--pan', '0,0,0')] : []),
            ...(args.includes('--pivot') ? ['--pivot', option('--pivot', '0,0,0')] : []),
            board,
        ]);
    else
        run([
            'pcb',
            'export',
            'vrml',
            '--output',
            output,
            '--force',
            '--units',
            'tenths',
            '--user-origin',
            option('--origin', '0x0mm'),
            board,
        ]);
    if (!before.equals(fs.readFileSync(board)))
        throw new Error('KiCad renderer modified source board unexpectedly');
    console.log(`KiCad ${kind} output: ${output}`);
}
