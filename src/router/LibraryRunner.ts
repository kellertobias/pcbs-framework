import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
/** Ship one worker with the package; source and compiled layouts both resolve it. */
export function runRoutingLibrary<T>(input: unknown, timeout = 30000): T {
    let directory = __dirname;
    let worker = '';
    while (directory !== path.dirname(directory)) {
        const candidate = path.join(directory, 'scripts', 'autorouter-worker.mjs');
        if (fs.existsSync(candidate)) {
            worker = candidate;
            break;
        }
        directory = path.dirname(directory);
    }
    if (!worker) throw new Error('Routing worker is missing from the framework installation.');
    const child = spawnSync(process.execPath, [worker], {
        input: JSON.stringify(input),
        encoding: 'utf-8',
        timeout,
        maxBuffer: 32 * 1024 * 1024,
    });
    if (child.error) throw new Error(`Routing engine failed: ${child.error.message}`);
    let output: {
        result?: T;
        error?: string;
    };
    try {
        output = JSON.parse(child.stdout);
    } catch {
        throw new Error(`Routing engine returned invalid output: ${child.stderr.slice(-1500)}`);
    }
    if (child.status !== 0 || output.error || output.result === undefined)
        throw new Error(output.error ?? `Routing engine exited with ${child.status}`);
    return output.result;
}
