import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveSchematic } from '../utils';

type PdfSelection = 'all' | 'schematic' | 'pcb';
export interface PdfOptions {
    entry?: string;
    output?: string;
    only: PdfSelection;
}

export function parsePdfArgs(args: string[]): PdfOptions {
    const options: PdfOptions = { only: 'all' };
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (['--output', '--only', '--root'].includes(argument)) {
            const value = args[++index];
            if (!value || value.startsWith('-')) throw new Error(`${argument} requires a value.`);
            if (argument === '--output') options.output = value;
            if (argument === '--only') {
                if (value !== 'all' && value !== 'schematic' && value !== 'pcb') {
                    throw new Error('--only must be all, schematic, or pcb.');
                }
                options.only = value;
            }
        } else if (argument.startsWith('-')) {
            throw new Error(`Unknown PDF option '${argument}'.`);
        } else if (options.entry) {
            throw new Error(`Unexpected additional PDF entry '${argument}'.`);
        } else options.entry = argument;
    }
    return options;
}

export type PdfRunner = (args: string[]) => void;

function runKicad(args: string[]): void {
    const macBinary = '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli';
    const binary = process.env.KICAD_CLI ?? (fs.existsSync(macBinary) ? macBinary : 'kicad-cli');
    const result = spawnSync(binary, args, {
        encoding: 'utf8',
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
        throw new Error(
            `KiCad PDF export failed: ${result.error?.message ?? (result.stderr || result.stdout || (result.signal ? `signal ${result.signal}` : `exit ${result.status}`))}`,
        );
    }
}

/** Export saved KiCad sources, including filled copper, without synthesizing a board. */
export function exportProjectPdfs(
    projectBase: string,
    outputDir: string,
    only: PdfSelection = 'all',
    run: PdfRunner = runKicad,
): string[] {
    const base = path.resolve(projectBase);
    const name = path.basename(base);
    const schematic = `${base}.kicad_sch`;
    const board = `${base}.kicad_pcb`;
    const sources = [
        ...(only !== 'pcb' ? [schematic] : []),
        ...(only !== 'schematic' ? [board] : []),
    ];
    const originals = new Map(
        sources.map((source) => {
            if (!fs.existsSync(source)) {
                throw new Error(
                    `KiCad source missing: ${source}. Run synth first or select --only schematic/pcb.`,
                );
            }
            return [source, fs.readFileSync(source)] as const;
        }),
    );
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-pdf-'));
    const outputs: string[] = [];
    try {
        if (only !== 'pcb') {
            const output = path.join(temporary, `${name}-schematic.pdf`);
            run(['sch', 'export', 'pdf', '--output', output, schematic]);
            outputs.push(output);
        }
        if (only !== 'schematic') {
            for (const side of ['front', 'back'] as const) {
                const output = path.join(temporary, `${name}-pcb-${side}.pdf`);
                const prefix = side === 'front' ? 'F' : 'B';
                run([
                    'pcb',
                    'export',
                    'pdf',
                    '--mode-single',
                    '--output',
                    output,
                    '--layers',
                    `${prefix}.Cu,${prefix}.SilkS,Edge.Cuts`,
                    '--scale',
                    '0',
                    '--check-zones',
                    ...(side === 'back' ? ['--mirror'] : []),
                    board,
                ]);
                outputs.push(output);
            }
        }
        for (const [source, original] of originals) {
            if (!original.equals(fs.readFileSync(source))) {
                throw new Error(`KiCad PDF exporter unexpectedly modified source: ${source}`);
            }
        }
        for (const output of outputs) {
            if (
                !fs.existsSync(output) ||
                fs.readFileSync(output).subarray(0, 5).toString() !== '%PDF-'
            ) {
                throw new Error(`KiCad did not produce a valid PDF: ${path.basename(output)}`);
            }
        }
        fs.mkdirSync(outputDir, { recursive: true });
        return outputs.map((output) => {
            const destination = path.resolve(outputDir, path.basename(output));
            fs.copyFileSync(output, destination);
            return destination;
        });
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

export async function cmdPdf(args: string[]): Promise<void> {
    const options = parsePdfArgs(args);
    let base: string;
    if (options.entry && /\.kicad_(sch|pcb)$/.test(options.entry)) {
        base = path.resolve(options.entry).replace(/\.kicad_(sch|pcb)$/, '');
    } else {
        const entry = await resolveSchematic(options.entry);
        const schematic = require(entry).default;
        if (!schematic || typeof schematic.name !== 'string' || !schematic.name) {
            throw new Error(`${entry} must default-export a named Schematic instance.`);
        }
        base = path.join(path.dirname(entry), schematic.name);
    }
    const outputDir = path.resolve(options.output ?? path.join(path.dirname(base), 'pdf'));
    for (const output of exportProjectPdfs(base, outputDir, options.only)) {
        console.log(`PDF generated: ${output}`);
    }
}
