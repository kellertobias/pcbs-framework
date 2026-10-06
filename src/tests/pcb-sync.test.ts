import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSynthArgs, pcbModeFromArgs } from '../cli/commands/synth';
import { KicadGenerator } from '../kicad/KicadGenerator';
import { SExpressionParser } from '../kicad/SExpressionParser';
import { synchronizePcb } from '../kicad/PcbSynchronizer';
import type { CircuitSnapshot } from '../synth/types';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});

const existingBoard = `(kicad_pcb
  (version 20241229)
  (generator "pcbnew")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "SIGNAL")
  (footprint "Managed:R" (layer "F.Cu") (at 10 20 0)
    (property "Reference" "R1" (layer "F.SilkS"))
    (pad "1" smd rect (at 0 0 0) (size 2 1) (layers "F.Cu" "F.Mask") (net 1 "SIGNAL")))
  (footprint "Manual:Part" (layer "F.Cu") (at 80 80 0) (property "Reference" "J99"))
  (segment (start 10 20) (end 20 20) (width 0.25) (layer "F.Cu") (net 1))
  (arc (start 20 20) (mid 21 21) (end 22 20) (width 0.25) (layer "F.Cu") (net 1))
  (via (at 22 20) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
  (zone (net 1) (net_name "SIGNAL") (layer "F.Cu") (polygon (pts (xy 0 0) (xy 1 0) (xy 1 1))))
  (gr_text "MANUAL" (at 50 50) (layer "F.SilkS"))
  (dimension (type aligned) (layer "Dwgs.User") (pts (xy 0 0) (xy 10 0)) (height 2))
)\n`;

const generatedBoard = `(kicad_pcb
  (version 20260206)
  (generator "pcb_framework")
  (generator_version "10.0")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "SIGNAL")
  (net 2 "ADDED")
  (footprint "Managed:R" (layer "B.Cu") (at 30 40 180)
    (property "Reference" "R1")
    (pad "1" smd rect (at 0 0 180) (size 2 1) (layers "B.Cu" "B.Mask") (net 1 "SIGNAL")))
  (footprint "Managed:R" (layer "F.Cu") (at 60 60 0)
    (property "Reference" "R2")
    (pad "1" thru_hole circle (at 0 0) (size 1 1) (drill 0.5) (layers "*.Cu" "*.Mask") (net 2 "ADDED")))
)\n`;

describe('PCB modes', () => {
    it('defaults to preserve and accepts both explicit CLI forms', () => {
        expect(pcbModeFromArgs(['board'])).toBe('preserve');
        expect(pcbModeFromArgs(['board', '--pcb', 'sync'])).toBe('sync');
        expect(pcbModeFromArgs(['board', '--pcb-mode=rebuild'])).toBe('rebuild');
    });

    it('parses reload explicitly and rejects unsupported synth options', () => {
        expect(parseSynthArgs(['board', '--pcb', 'sync', '--reload-kicad'])).toMatchObject({
            entry: 'board',
            pcbMode: 'sync',
            reloadKicad: true,
        });
        expect(() => parseSynthArgs(['board', '--pcb', 'sync', '--reload'])).toThrow(
            /Unknown synth option '--reload'/,
        );
        expect(() => parseSynthArgs(['board', '--reload-kicad'])).toThrow(
            /requires --pcb sync or --pcb rebuild/,
        );
        expect(() => parseSynthArgs(['board', 'extra'])).toThrow(
            /Unexpected additional synth entry/,
        );
    });

    it('syncs declared footprints while preserving copper and manual objects', () => {
        const result = synchronizePcb(existingBoard, generatedBoard);
        const repeated = synchronizePcb(result.content, generatedBoard);
        const ast = SExpressionParser.parse(result.content);
        const serialized = SExpressionParser.serialize(ast);

        expect(serialized).toContain('(property "Reference" "J99")');
        expect(serialized).toContain('(gr_text "MANUAL"');
        expect(serialized).toContain('(dimension');
        expect(serialized.match(/\(segment/g) ?? []).toHaveLength(1);
        expect(serialized.match(/\(arc/g) ?? []).toHaveLength(1);
        expect(serialized.match(/\(via/g) ?? []).toHaveLength(1);
        expect(serialized.match(/\(zone/g) ?? []).toHaveLength(1);
        expect(serialized).toContain('(at 30 40 180)');
        expect(serialized).toMatch(/\(pad "1" smd rect\s+\(at 0 0 180\)/);
        expect(serialized).toContain('(property "Reference" "R1" (layer "B.SilkS"))');
        expect(serialized).toContain('(property "Reference" "R2")');
        expect(serialized).toContain('(net 2 "ADDED")');
        expect(serialized).toContain('(version 20241229)');
        expect(serialized).not.toContain('(generator_version "10.0")');
        expect(result.report.addedFootprints).toEqual(['R2']);
        expect(result.report.updatedFootprints).toEqual(['R1']);
        expect(result.report.routedFootprintMoves).toEqual([
            expect.objectContaining({ reference: 'R1', nets: ['SIGNAL'] }),
        ]);
        expect(result.report.preservedCopper).toEqual({ segments: 1, arcs: 1, vias: 1, zones: 1 });
        expect(repeated.content).toBe(result.content);
    });

    it('removes the stale absolute pad angle when a footprint rotates back to zero', () => {
        const rotatedExisting = existingBoard
            .replace('(at 10 20 0)', '(at 10 20 90)')
            .replace('(at 0 0 0) (size 2 1)', '(at 0 0 90) (size 2 1)');
        const zeroDegreeGenerated = generatedBoard
            .replace('(at 30 40 180)', '(at 30 40 0)')
            .replace('(at 0 0 180)', '(at 0 0)');

        const result = synchronizePcb(rotatedExisting, zeroDegreeGenerated);
        const serialized = SExpressionParser.serialize(SExpressionParser.parse(result.content));

        expect(serialized).toContain('(at 30 40 0)');
        expect(serialized).toMatch(/\(pad "1" smd rect\s+\(at 0 0\)\s+\(size 2 1\)/);
    });

    it('upgrades a framework-managed board header without replacing manual copper', () => {
        const legacyFrameworkBoard = existingBoard.replace(
            '(generator "pcbnew")',
            '(generator "pcb_framework")\n  (generator_version "2.1")',
        );
        const result = synchronizePcb(legacyFrameworkBoard, generatedBoard);
        const repeated = synchronizePcb(result.content, generatedBoard);

        expect(result.content).toContain('(version 20260206)');
        expect(result.content).toContain('(generator "pcb_framework")');
        expect(result.content).toContain('(generator_version "10.0")');
        expect(result.content).toMatch(/\(segment\s+\(start 10 20\)\s+\(end 20 20\)/);
        expect(result.content).toContain('(gr_text "MANUAL"');
        expect(result.report.preservedCopper).toEqual({ segments: 1, arcs: 1, vias: 1, zones: 1 });
        expect(repeated.content).toBe(result.content);
    });

    it('preserve never reads or writes an existing PCB', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-preserve-'));
        temporaryDirectories.push(directory);
        const pcbPath = path.join(directory, 'ModeTest.kicad_pcb');
        fs.writeFileSync(pcbPath, 'not even valid KiCad; preserve must not parse this\n');
        const snapshot: CircuitSnapshot = {
            name: 'ModeTest',
            components: [],
            nets: [],
            pcb: {
                outline: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                ],
            },
        };

        new KicadGenerator([]).generate(snapshot, directory, {
            pcbMode: 'preserve',
            validateWithKicad: false,
        });

        expect(fs.readFileSync(pcbPath, 'utf-8')).toBe(
            'not even valid KiCad; preserve must not parse this\n',
        );
        expect(fs.existsSync(path.join(directory, 'ModeTest.pcb-sync.json'))).toBe(false);
    });

    it('rebuild creates an exact recoverable backup before replacing the board', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-rebuild-'));
        temporaryDirectories.push(directory);
        const pcbPath = path.join(directory, 'ModeTest.kicad_pcb');
        fs.writeFileSync(pcbPath, existingBoard);
        const snapshot: CircuitSnapshot = {
            name: 'ModeTest',
            components: [],
            nets: [],
            pcb: {
                outline: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                ],
            },
        };

        new KicadGenerator([]).generate(snapshot, directory, {
            pcbMode: 'rebuild',
            validateWithKicad: false,
        });

        const backup = fs
            .readdirSync(path.join(directory, '.backups'))
            .find((name) => name.startsWith('ModeTest.kicad_pcb.backup-'));
        expect(backup).toBeDefined();
        expect(fs.readFileSync(path.join(directory, '.backups', backup!), 'utf-8')).toBe(
            existingBoard,
        );
        expect(fs.readFileSync(pcbPath, 'utf-8')).toContain('(generator "pcb_framework")');
    });

    it('leaves the original file intact when an atomic replacement cannot start', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbs-atomic-'));
        temporaryDirectories.push(directory);
        const target = path.join(directory, 'protected.kicad_pcb');
        fs.writeFileSync(target, 'original\n');
        fs.chmodSync(directory, 0o500);
        try {
            expect(() =>
                (new KicadGenerator([]) as any).writeAtomic(target, 'replacement\n'),
            ).toThrow();
            expect(fs.readFileSync(target, 'utf-8')).toBe('original\n');
        } finally {
            fs.chmodSync(directory, 0o700);
        }
    });
});
