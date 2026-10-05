import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    AssemblyLiveRefresh,
    assemblyInputs,
    inputSignature,
    loadAssembly,
    assemblyModules,
} from '../assembly/live';
import { Assembly } from '../synth/Assembly';

describe('live assembly source refresh', () => {
    it('tracks saved PCB models and explicit generator inputs, including atomic file replacement', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-live-'));
        try {
            const pcb = path.join(dir, 'board.kicad_pcb'),
                model = path.join(dir, 'part.wrl');
            fs.writeFileSync(pcb, '(kicad_pcb (model "${KIPRJMOD}/part.wrl"))');
            fs.writeFileSync(model, 'old');
            const assembly = new Assembly({ name: 'live' })
                .addBoard({ id: 'board', file: 'board.kicad_pcb' })
                .addGenerated({
                    id: 'mount',
                    inputs: ['dimensions.json'],
                    model: {} as never,
                });
            fs.writeFileSync(path.join(dir, 'assembly.ts'), '');
            const inputs = assemblyInputs(assembly, path.join(dir, 'assembly.ts'));
            expect(inputs).toContain(pcb);
            expect(inputs).toContain(model);
            expect(inputs).toContain(path.join(dir, 'dimensions.json'));
            const before = inputSignature(inputs);
            fs.writeFileSync(path.join(dir, 'replacement'), 'new');
            fs.renameSync(path.join(dir, 'replacement'), model);
            expect(inputSignature(inputs)).not.toBe(before);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('serializes exports, catches a save during export, and leaves failed refreshes retryable', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-live-'));
        try {
            const file = path.join(dir, 'pcb');
            fs.writeFileSync(file, 'first');
            const rebuild = vi.fn(async () => {
                if (rebuild.mock.calls.length === 1) fs.writeFileSync(file, 'second save');
                return [file];
            });
            const live = new AssemblyLiveRefresh([file], rebuild);
            fs.writeFileSync(file, 'changed');
            await Promise.all([live.check(), live.refresh()]);
            expect(rebuild).toHaveBeenCalledTimes(2);
            await live.check();
            expect(rebuild).toHaveBeenCalledTimes(2);
            rebuild.mockRejectedValueOnce(new Error('bad input'));
            fs.writeFileSync(file, 'invalid save');
            await expect(live.check()).rejects.toThrow('bad input');
            await live.check();
            expect(rebuild).toHaveBeenCalledTimes(3);
            fs.writeFileSync(file, 'repaired save');
            await live.check();
            expect(rebuild).toHaveBeenCalledTimes(4);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('refreshes typechecked dependency exports without stacking require hooks', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-types-'));
        try {
            const entry = path.join(dir, 'assembly.ts'),
                dep = path.join(dir, 'name.ts');
            const assemblyModule = JSON.stringify(path.resolve(__dirname, '../synth/Assembly.ts'));
            fs.writeFileSync(dep, "export const original = 'first';");
            fs.writeFileSync(
                entry,
                `import {Assembly} from ${assemblyModule};import {original} from './name';export default new Assembly({name:original});`,
            );
            const updated = `import {Assembly} from ${assemblyModule};import {added} from './name';export default new Assembly({name:added});`;
            const script = `require('ts-node').register({transpileOnly:false});const fs=require('node:fs');const {loadAssembly,assemblyModules}=require(${JSON.stringify(path.resolve(__dirname, '../assembly/live.ts'))});const entry=${JSON.stringify(entry)};const first=loadAssembly(entry).name;const graph=assemblyModules(entry);const hook=require.extensions['.ts'];fs.writeFileSync(${JSON.stringify(dep)},"export const added='updated';");fs.writeFileSync(entry,${JSON.stringify(updated)});const second=loadAssembly(entry,graph).name;const third=loadAssembly(entry,graph).name;console.log(JSON.stringify({first,second,third,sameHook:hook===require.extensions['.ts']}));`;
            const result = JSON.parse(
                execFileSync(process.execPath, ['-e', script], {
                    cwd: path.resolve(__dirname, '../..'),
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        TS_NODE_COMPILER_OPTIONS: JSON.stringify({
                            allowImportingTsExtensions: true,
                        }),
                    },
                }),
            );
            expect(result).toEqual({
                first: 'first',
                second: 'updated',
                third: 'updated',
                sameHook: true,
            });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('reloads generated-model source dependencies without changing the shared Assembly class', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-live-'));
        try {
            const entry = path.join(dir, 'assembly.cjs'),
                dep = path.join(dir, 'name.cjs');
            fs.writeFileSync(dep, "module.exports='first';");
            fs.writeFileSync(
                entry,
                `const {Assembly}=require(${JSON.stringify(path.resolve(__dirname, '../synth/Assembly.ts'))});module.exports=new Assembly({name:require('./name.cjs')});`,
            );
            // Exercise the CLI's actual CommonJS/ts-node cache, rather than Vitest's separate module graph.
            const script = `require('ts-node/register/transpile-only');const fs=require('node:fs');const {loadAssembly,assemblyModules}=require(${JSON.stringify(path.resolve(__dirname, '../assembly/live.ts'))});const entry=${JSON.stringify(entry)};const first=loadAssembly(entry).name;const graph=assemblyModules(entry);fs.writeFileSync(${JSON.stringify(dep)},"module.exports='updated';");console.log(JSON.stringify({first,updated:loadAssembly(entry,graph).name,graph}));`;
            const result = JSON.parse(
                execFileSync(process.execPath, ['-e', script], {
                    cwd: path.resolve(__dirname, '../..'),
                    encoding: 'utf8',
                }),
            );
            expect(result.first).toBe('first');
            expect(result.updated).toBe('updated');
            expect(result.graph).toContain(fs.realpathSync(dep));
            expect(result.graph).not.toContain(path.resolve(__dirname, '../synth/Assembly.ts'));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
