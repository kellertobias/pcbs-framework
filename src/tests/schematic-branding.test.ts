import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { schematicHeader, schematicRevision, schematicWorksheet } from '../kicad/SchematicHeader';
import { UuidManager } from '../kicad/UuidManager';
import { loadProjectBranding } from '../synth/ProjectBranding';
import type { CircuitSnapshot } from '../synth/types';

describe('project schematic branding', () => {
    it('loads the nearest configuration and resolves its logo relative to the configuration', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-branding-'));
        try {
            const nested = path.join(directory, 'project', 'circuit');
            fs.mkdirSync(nested, { recursive: true });
            fs.writeFileSync(
                path.join(directory, 'pcb.config.json'),
                JSON.stringify({ branding: { company: 'Outer' } }),
            );
            const config = path.join(directory, 'project', 'pcb.config.json');
            fs.writeFileSync(
                config,
                JSON.stringify({ branding: { company: 'Inner', logo: 'logo.svg' } }),
            );
            expect(loadProjectBranding(nested)).toEqual({
                company: 'Inner',
                logo: path.join(directory, 'project', 'logo.svg'),
            });
            fs.writeFileSync(config, JSON.stringify({ branding: { company: 'Edited' } }));
            expect(loadProjectBranding(nested).company).toBe('Edited');
            fs.writeFileSync(config, JSON.stringify({ branding: { logo: 42 } }));
            expect(() => loadProjectBranding(nested)).toThrow('branding.logo');
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
    it('embeds a native PNG image and gives the drawing stable identities and a short internal revision', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-header-'));
        try {
            const logo = path.join(directory, 'logo.svg');
            fs.writeFileSync(
                logo,
                '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="green"/></svg>',
            );
            const snapshot = {
                name: 'internal-name',
                projectName: 'Friendly Project',
                description: 'A readable circuit.',
                branding: { logo },
                schematicRevision: 18,
                revision: 'very-long-release-revision',
            } as CircuitSnapshot;
            const uuids = new UuidManager();
            const result = schematicHeader(snapshot, uuids);
            expect(result).toEqual(schematicHeader(snapshot, uuids));
            const image = result.find((item) => item[0] === 'image')!;
            if (!Array.isArray(image)) throw new Error('Missing native image');
            const data = image.find(
                (item) => Array.isArray(item) && item[0] === 'data',
            ) as string[];
            expect(Buffer.from(data.slice(1).join(''), 'base64').subarray(0, 8)).toEqual(
                Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
            );
            expect(schematicWorksheet()).toContain('(tbtext "%T"');
            expect(schematicWorksheet()).toContain('Tobias Media PCB Framework');
            expect(JSON.stringify(image)).toContain('267');
            expect(schematicRevision(snapshot)).toBe('R18');
            expect(schematicRevision({ ...snapshot, schematicRevision: undefined })).toBe('R1');
            expect(() => schematicRevision({ ...snapshot, schematicRevision: 0 })).toThrow(
                'positive integer',
            );
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});
