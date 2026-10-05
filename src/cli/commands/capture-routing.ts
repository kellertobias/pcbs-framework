import * as fs from 'fs';
import * as path from 'path';
import { resolveSchematic } from '../utils';
import { captureRouting, copperUuids, saveRoutingFile } from '../../kicad/RoutingFile';
import { PcbGenerator } from '../../kicad/PcbGenerator';
import { UuidManager } from '../../kicad/UuidManager';

/** Explicit snapshot of manual/router copper; source-declared module routes stay in TypeScript. */
export async function cmdCaptureRouting(args: string[]): Promise<void> {
    if (args.length > 1 || args.some((arg) => arg.startsWith('-')))
        throw new Error('Usage: capture-routing [entry]');
    const entry = await resolveSchematic(args[0]);
    const schematic = require(entry).default;
    if (!schematic || typeof schematic._generateWithCapture !== 'function')
        throw new Error(`${entry} must export a Schematic instance.`);
    const snapshot = schematic._generateWithCapture();
    if (!snapshot.pcb) throw new Error('Routing capture requires a PCB configuration.');
    const directory = path.dirname(entry);
    const board = path.join(directory, `${snapshot.name}.kicad_pcb`);
    const source = fs.readFileSync(board, 'utf-8');
    const uuids = new UuidManager();
    uuids.load(path.join(directory, 'uuids.json'));
    const declared = new PcbGenerator(snapshot, uuids, directory).generate();
    const routing = captureRouting(source, snapshot.name, {
        excludeUuids: copperUuids(declared.content),
        handoffs: snapshot.pcb.handoffs,
    });
    const file = path.resolve(directory, snapshot.pcb.routingFile ?? 'routing.json');
    saveRoutingFile(file, routing);
    console.log(
        `  ✅ Saved ${routing.routes.length} routed net(s) to ${file}. Previous routing file backed up when present.`,
    );
}
