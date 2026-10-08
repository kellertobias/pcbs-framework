import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { Schematic } from '../synth/Schematic';
import { Component } from '../synth/Component';
import { Net } from '../synth/Net';
import { KicadGenerator } from '../kicad/KicadGenerator';

class PagedBoard extends Schematic {
    constructor(readonly count = 2) {
        super({
            name: 'paged',
            connectionStyle: 'direct-labels',
            schematicRouting: {
                interfaceComponents: [],
                autoLayout: {
                    pages: true,
                    groups: Array.from({ length: count }, (_, i) => ({
                        id: `section-${i + 1}`,
                        title: `Section ${i + 1}`,
                        components: [`R${i + 1}`],
                    })),
                },
            },
        });
    }
    generate() {
        const shared = new Net({ name: 'SHARED' });
        for (const ref of Array.from({ length: this.count }, (_, i) => `R${i + 1}`)) {
            const part = new Component({ ref, symbol: 'Device:R', footprint: 'DNC', value: '1k' });
            part.pins[1].tie(shared);
            part.pins[2].dnc();
        }
    }
}
const cli = '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli';
describe.skipIf(!fs.existsSync(cli))('native functional-page schematics', () => {
    it.each([2, 19])(
        'preserves %i cross-sheet references and identities when regenerating',
        (count) => {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-pages-'));
            try {
                const generate = () =>
                    new KicadGenerator().generate(
                        new PagedBoard(count)._generateWithCapture(),
                        directory,
                        {
                            validateWithKicad: false,
                            pcbMode: 'preserve',
                        },
                    );
                generate();
                const first = fs.readFileSync(
                    path.join(directory, 'paged-section-1.kicad_sch'),
                    'utf8',
                );
                generate();
                expect(
                    fs.readFileSync(path.join(directory, 'paged-section-1.kicad_sch'), 'utf8'),
                ).toBe(first);
                const result = spawnSync(
                    cli,
                    [
                        'sch',
                        'export',
                        'netlist',
                        '--format',
                        'kicadxml',
                        '--output',
                        path.join(directory, 'native.net'),
                        path.join(directory, 'paged.kicad_sch'),
                    ],
                    { encoding: 'utf8' },
                );
                expect(result.status, result.stderr).toBe(0);
                const netlist = fs.readFileSync(path.join(directory, 'native.net'), 'utf8');
                expect(netlist).toContain('name="SHARED"');
                expect(netlist).toMatch(/node ref="R1" pin="1"/);
                expect(netlist).toMatch(/node ref="R2" pin="1"/);
                expect(netlist.match(/<comp ref="R\d+"/g)).toHaveLength(count);
            } finally {
                fs.rmSync(directory, { recursive: true, force: true });
            }
        },
    );
});
