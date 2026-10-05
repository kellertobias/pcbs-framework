import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportProjectPdfs, parsePdfArgs, type PdfRunner } from '../cli/commands/pdf';

const temporaryDirectories: string[] = [];
function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-export-test-'));
    temporaryDirectories.push(directory);
    const base = path.join(directory, 'Board with spaces');
    fs.writeFileSync(`${base}.kicad_sch`, 'saved schematic');
    fs.writeFileSync(`${base}.kicad_pcb`, 'saved copper');
    return { base, output: path.join(directory, 'pdf') };
}
afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('native project PDF export', () => {
    it('exports all schematic sheets and exactly one composite PDF per side, mirroring only the back', () => {
        const { base, output } = fixture();
        const calls: string[][] = [];
        const run: PdfRunner = (args) => {
            calls.push(args);
            fs.writeFileSync(args[args.indexOf('--output') + 1], '%PDF-1.7\n');
        };
        const outputs = exportProjectPdfs(base, output, 'all', run);
        expect(outputs.map((file) => path.basename(file))).toEqual([
            'Board with spaces-schematic.pdf',
            'Board with spaces-pcb-front.pdf',
            'Board with spaces-pcb-back.pdf',
        ]);
        expect(calls[0].slice(0, 3)).toEqual(['sch', 'export', 'pdf']);
        expect(calls[0]).not.toContain('--pages');
        for (const [index, side] of ['F', 'B'].entries()) {
            const args = calls[index + 1];
            expect(args).toContain('--mode-single');
            expect(args).toContain(`${side}.Cu,${side}.SilkS,Edge.Cuts`);
            expect(args).toContain('--check-zones');
            expect(args.includes('--mirror')).toBe(index === 1);
            expect(args[args.length - 1]).toBe(`${base}.kicad_pcb`);
        }
        expect(fs.readFileSync(`${base}.kicad_sch`, 'utf8')).toBe('saved schematic');
        expect(fs.readFileSync(`${base}.kicad_pcb`, 'utf8')).toBe('saved copper');
        expect(outputs.every((file) => fs.readFileSync(file, 'utf8').startsWith('%PDF-'))).toBe(
            true,
        );
    });

    it('allows schematic-only export without a PCB, and checks all required sources before running', () => {
        const { base, output } = fixture();
        fs.unlinkSync(`${base}.kicad_pcb`);
        let calls = 0;
        const run: PdfRunner = (args) => {
            calls++;
            fs.writeFileSync(args[args.indexOf('--output') + 1], '%PDF-1.7\n');
        };
        expect(() => exportProjectPdfs(base, output, 'all', run)).toThrow(/source missing/);
        expect(calls).toBe(0);
        expect(exportProjectPdfs(base, output, 'schematic', run)).toHaveLength(1);
        expect(calls).toBe(1);
    });

    it('does not replace existing deliverables when KiCad fails or returns no PDF', () => {
        const { base, output } = fixture();
        fs.mkdirSync(output);
        const previous = path.join(output, 'Board with spaces-schematic.pdf');
        fs.writeFileSync(previous, 'previous PDF');
        expect(() =>
            exportProjectPdfs(base, output, 'all', () => {
                throw new Error('KiCad failed');
            }),
        ).toThrow('KiCad failed');
        expect(() => exportProjectPdfs(base, output, 'all', () => {})).toThrow(/valid PDF/);
        expect(fs.readFileSync(previous, 'utf8')).toBe('previous PDF');
        expect(fs.readdirSync(output)).toEqual([path.basename(previous)]);
    });

    it('reports an unexpected source mutation before publishing PDFs', () => {
        const { base, output } = fixture();
        expect(() =>
            exportProjectPdfs(base, output, 'pcb', (args) => {
                fs.writeFileSync(`${base}.kicad_pcb`, 'changed');
                fs.writeFileSync(args[args.indexOf('--output') + 1], '%PDF-1.7\n');
            }),
        ).toThrow(/modified source/);
        expect(fs.existsSync(output)).toBe(false);
    });

    it('accepts explicit selections and rejects misspelled or incomplete options', () => {
        expect(parsePdfArgs(['--output', 'review', 'my_board', '--only', 'pcb'])).toEqual({
            entry: 'my_board',
            output: 'review',
            only: 'pcb',
        });
        for (const args of [['--only', 'back'], ['--output'], ['--out', 'review'], ['a', 'b']]) {
            expect(() => parsePdfArgs(args)).toThrow();
        }
    });
});
