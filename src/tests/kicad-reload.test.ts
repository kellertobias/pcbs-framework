import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
    completeKicadReload,
    KicadReloadPhase,
    KicadReloadRunner,
    prepareKicadReload,
} from '../cli/KicadReload';

describe('KiCad PCB reload coordination', () => {
    it('saves before synthesis and reloads the same canonical PCB afterwards', () => {
        const calls: Array<{ phase: KicadReloadPhase; pcbPath: string }> = [];
        const runner: KicadReloadRunner = (phase, pcbPath) => {
            calls.push({ phase, pcbPath });
            return { status: phase === 'save' ? 'saved' : 'reloaded', target: pcbPath };
        };
        const input = path.join('relative', 'Board.kicad_pcb');

        const prepared = prepareKicadReload(input, runner);
        const completed = completeKicadReload(prepared, runner);

        expect(prepared.shouldReload).toBe(true);
        expect(completed?.status).toBe('reloaded');
        expect(calls).toEqual([
            { phase: 'save', pcbPath: path.resolve(input) },
            { phase: 'revert', pcbPath: path.resolve(input) },
        ]);
    });

    it('does not issue a revert when the exact board is not open', () => {
        const calls: KicadReloadPhase[] = [];
        const runner: KicadReloadRunner = (phase) => {
            calls.push(phase);
            return { status: 'not-open', openBoards: ['/another/Board.kicad_pcb'] };
        };

        const prepared = prepareKicadReload('Board.kicad_pcb', runner);
        expect(completeKicadReload(prepared, runner)).toBeUndefined();
        expect(prepared.shouldReload).toBe(false);
        expect(calls).toEqual(['save']);
    });

    it('reports IPC unavailability without pretending the board was reloaded', () => {
        const runner: KicadReloadRunner = () => ({
            status: 'unavailable',
            message: 'connection refused',
        });
        const prepared = prepareKicadReload('Board.kicad_pcb', runner);

        expect(prepared).toMatchObject({
            shouldReload: false,
            status: 'unavailable',
            message: 'connection refused',
        });
        expect(completeKicadReload(prepared, runner)).toBeUndefined();
    });

    it('fails clearly if the matching board disappears between save and reload', () => {
        const runner: KicadReloadRunner = (phase) => ({
            status: phase === 'save' ? 'saved' : 'not-open',
        });
        const prepared = prepareKicadReload('Board.kicad_pcb', runner);

        expect(() => completeKicadReload(prepared, runner)).toThrow(
            /no longer has the synchronized board open/,
        );
    });
});
