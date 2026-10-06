import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('loads the native ESM entry from CommonJS and shares constructors with addons', () => {
    const bridge = path.resolve(__dirname, '../runtime/three.mjs');
    const result = spawnSync(
        process.execPath,
        [
            '-e',
            `
        const bridge = require(${JSON.stringify(bridge)});
        (async () => {
            const three = await import('three');
            if (bridge.Vector3 !== three.Vector3 || bridge.BufferGeometry !== three.BufferGeometry)
                throw Error('Three.js constructor identity differs');
            const point = new bridge.Vector3(1, 2, 3).add(new three.Vector3(4, 5, 6));
            if (point.x !== 5 || point.y !== 7 || point.z !== 9) throw Error('Geometry mismatch');
            process.emitWarning('Unrelated warnings remain visible', {code:'RUNTIME_WARNING_PROBE'});
        })().catch(error => { console.error(error); process.exitCode = 1; });
    `,
        ],
        { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('THREE_CJS_DEPRECATED');
    expect(result.stderr).toContain('RUNTIME_WARNING_PROBE');
});
