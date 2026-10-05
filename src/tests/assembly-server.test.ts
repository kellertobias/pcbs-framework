import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { serveAssembly } from '../assembly/server';

describe('atomic assembly asset revisions', () => {
    it('pins asset requests to their export revision and restricts manual refresh origins', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-server-'));
        const snapshot = (name: string) => {
            const dir = path.join(root, name);
            fs.mkdirSync(path.join(dir, 'assets/model'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'assets/model/part.wrl'), name);
            fs.writeFileSync(
                path.join(dir, 'assembly.json'),
                JSON.stringify({ name, parts: [{ id: 'model', url: '/assets/model/part.wrl' }] }),
            );
            return dir;
        };
        const bundle = path.join(root, 'viewer.js');
        fs.writeFileSync(bundle, '');
        const first = snapshot('old'),
            second = snapshot('new');
        let calls = 0;
        const served = await serveAssembly(
            first,
            0,
            async () => {
                calls++;
                served.replaceDirectory(second);
            },
            bundle,
        );
        try {
            const manifest = await (await fetch(served.url + '/assembly.json')).json();
            expect(manifest.revision).toBe(1);
            expect(await (await fetch(served.url + manifest.parts[0].url)).text()).toBe('old');
            expect(
                (
                    await fetch(served.url + '/refresh', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Origin: 'https://unrelated.example',
                        },
                        body: '{}',
                    })
                ).status,
            ).toBe(403);
            expect(calls).toBe(0);
            const refreshed = await fetch(served.url + '/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Origin: served.url },
                body: '{}',
            });
            expect(refreshed.status).toBe(200);
            expect(calls).toBe(1);
            const next = await (await fetch(served.url + '/assembly.json')).json();
            expect(next.revision).toBe(2);
            expect(await (await fetch(served.url + next.parts[0].url)).text()).toBe('new');
            expect(await (await fetch(served.url + manifest.parts[0].url)).text()).toBe('old');
            served.setRefreshState(false, 'bad input');
            expect(await (await fetch(served.url + '/revision.json')).json()).toMatchObject({
                revision: 2,
                error: 'bad input',
            });
        } finally {
            await new Promise<void>((resolve) => served.server.close(() => resolve()));
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
