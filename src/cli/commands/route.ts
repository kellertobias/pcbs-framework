import { outputPaths, generatedFile } from '../../project/OutputPaths';
import { GridRoutingBackend } from '../../router/GridRoutingBackend';
import { loadRoutingFile } from '../../kicad/RoutingFile';
import * as path from 'path';
import { CircuitSnapshot } from '@tobisk/pcbs';
import { resolveSchematic, die } from '@tobisk/pcbs/cli/utils';
import { runIncrementalRouting, SimpleRoutingBackend, CapacityRoutingBackend } from '../../router';

function valuesFor(args: string[], flag: string): string[] {
    const values: string[] = [];
    for (let index = 0; index < args.length; index++) {
        if (args[index] === flag && args[index + 1]) values.push(args[++index]);
        else if (args[index].startsWith(`${flag}=`))
            values.push(args[index].slice(flag.length + 1));
    }
    return values;
}

function positionalEntry(args: string[]): string | undefined {
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === '--backend' || argument === '--reroute-net') {
            index++;
            continue;
        }
        if (!argument.startsWith('--')) return argument;
    }
    return undefined;
}

export async function cmdRoute(args: string[]): Promise<void> {
    const schematicPath = await resolveSchematic(positionalEntry(args));
    try {
        const mod = require(schematicPath);
        const schematic = mod.default;
        if (!schematic || typeof schematic.generate !== 'function')
            die(`${schematicPath} must export a Schematic instance.`);
        schematic.generate();
        const snapshot = loadRoutingFile(
            schematic._generateWithCapture() as CircuitSnapshot,
            outputPaths(path.dirname(schematicPath)).export,
        );
        const backendName = valuesFor(args, '--backend')[0] ?? 'capacity';
        if (backendName !== 'simple' && backendName !== 'capacity' && backendName !== 'grid')
            die(`Unknown routing backend '${backendName}'. Available: capacity, grid, simple.`);
        const boardPath = generatedFile(path.dirname(schematicPath), `${snapshot.name}.kicad_pcb`);
        const report = runIncrementalRouting(snapshot, boardPath, {
            backend:
                backendName === 'grid'
                    ? new GridRoutingBackend()
                    : backendName === 'capacity'
                      ? new CapacityRoutingBackend()
                      : new SimpleRoutingBackend(),
            routeAll: backendName !== 'simple' || args.includes('--all'),
            rerouteNets: valuesFor(args, '--reroute-net'),
            runDrc: !args.includes('--no-drc'),
        });
        console.log(`  ✅ Routing finished with backend '${report.backend}'.`);
        console.log(
            `     Completed ${report.completed.length}, skipped ${report.skipped.length}, failed ${report.failed.length}, constraint violations ${report.constraintViolating.length}.`,
        );
        if (report.backupPath) console.log(`     Backup: ${report.backupPath}`);
        console.log(`     DRC: ${report.drc.status}. Human review is still required.`);
        if (report.failed.length) process.exitCode = 1;
    } catch (error) {
        die(`Routing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
