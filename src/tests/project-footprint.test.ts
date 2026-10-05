import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { footprint, child } from '../kicad/FootprintGeometry';
import { KicadSymbol } from '../synth/KicadSymbol';

describe('project-specific footprint lookup', () => {
    it('resolves same-name libraries independently and refreshes changed geometry', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-footprint-'));
        try {
            const dirs = ['one', 'two'].map((name) => path.join(directory, name));
            for (const [index, dir] of dirs.entries()) {
                fs.mkdirSync(path.join(dir, 'Own.pretty'), { recursive: true });
                fs.writeFileSync(
                    path.join(dir, 'Own.pretty/Module.kicad_mod'),
                    `(footprint "Module" (at ${index} 0))`,
                );
            }
            expect(child(footprint('Own:Module', [dirs[0]]), 'at')?.[1]).toBe('0');
            expect(child(footprint('Own:Module', [dirs[1]]), 'at')?.[1]).toBe('1');
            fs.writeFileSync(
                path.join(dirs[0], 'Own.pretty/Module.kicad_mod'),
                '(footprint "Module" (at 123 0))',
            );
            expect(child(footprint('Own:Module', [dirs[0]]), 'at')?.[1]).toBe('123');
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
    it('uses a symbol’s declared project footprint library', () => {
        const symbol = new KicadSymbol({ name: 'Module', footprint: 'Own:Module' });
        expect(symbol.serialize()).toContain('(property "Footprint" "Own:Module"');
    });
});
