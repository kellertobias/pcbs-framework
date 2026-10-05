import fs from 'node:fs';
import path from 'node:path';
import { stitchFilledZones } from '../../router/ZoneStitching';
import { saveRoutingFile } from '../../kicad/RoutingFile';
export async function cmdStitchZones(args: string[]): Promise<void> {
    const input = args[0];
    if (!input) throw Error('stitch-zones board.kicad_pcb --net GND --output routing.json');
    const option = (name: string, fallback: string) => {
        const i = args.indexOf(name);
        return i < 0 ? fallback : args[i + 1];
    };
    const board = path.resolve(input),
        name = path.basename(board, '.kicad_pcb');
    const result = stitchFilledZones(fs.readFileSync(board, 'utf8'), name, option('--net', 'GND'));
    const output = path.resolve(option('--output', path.join(path.dirname(board), 'routing.json')));
    saveRoutingFile(output, result.routing);
    console.log(
        `Saved ${result.added} stitching vias and existing copper to ${output}; regenerate, refill and run DRC.`,
    );
}
