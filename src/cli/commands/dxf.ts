import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Run the packaged, read-only native KiCad mechanical-layer exporter. */
export async function cmdDxf(args: string[]): Promise<void> {
    const script = ['../../../..', '../../..']
        .map((root) => path.resolve(__dirname, root, 'scripts/export-pcb-dxf.py'))
        .find(existsSync);
    if (!script) throw new Error('The packaged DXF exporter is missing.');
    const result = spawnSync(process.env.PYTHON ?? 'python3', [script, ...args], {
        stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
        throw new Error(`DXF export failed (${result.status ?? result.signal})`);
}
