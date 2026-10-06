import { outputPaths, resolveGeneratedInput } from '../../project/OutputPaths';
import * as fs from 'fs';
import * as path from 'path';
import { resolveSchematic, die } from '../utils';
import { exportFrontPanel, exportVerticalFrontPanel } from '../../frontpanel/FrontPanelExporter';
import type { FrontPanelEdge } from '../../frontpanel/types';
import { exportSchematicFrontPanel } from '../../frontpanel/SchematicFrontPanel';

export async function cmdFrontPanel(args: string[]): Promise<void> {
    let entry: string | undefined;
    let panelName: string | undefined;
    const flags = new Map<string, string>();
    const allowed = new Set([
        '--edge',
        '--components',
        '--height',
        '--bottom-z',
        '--output',
        '--pcb',
        '--list',
    ]);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            if (!allowed.has(arg)) die(`Unknown frontpanel option: ${arg}`);
            if (flags.has(arg)) die(`Duplicate frontpanel option: ${arg}`);
            if (arg === '--list') {
                flags.set(arg, 'true');
                continue;
            }
            const value = args[++i];
            if (!value || value.startsWith('--')) die(`Missing value for ${arg}`);
            flags.set(arg, value);
        } else {
            if (!entry) entry = arg;
            else if (!panelName) panelName = arg;
            else die('Use frontpanel <schematic> <panel-name>');
        }
    }
    if (
        !flags.has('--edge') &&
        ['--components', '--height', '--bottom-z'].some((key) => flags.has(key))
    )
        die('Vertical frontpanel export requires --edge');
    const schematicPath = entry?.endsWith('.kicad_pcb')
        ? resolveGeneratedInput(entry)
        : await resolveSchematic(entry);
    const schematicDir = outputPaths(path.dirname(schematicPath)).export;
    if (
        !schematicPath.endsWith('.kicad_pcb') &&
        (panelName || flags.has('--list') || !flags.has('--edge'))
    ) {
        const mod = require(schematicPath);
        if (panelName || flags.has('--list') || mod.frontPanels) {
            if (!mod.default || typeof mod.default._generateWithCapture !== 'function')
                die('Named panel export requires a default Schematic instance');
            if (
                !mod.frontPanels ||
                typeof mod.frontPanels !== 'object' ||
                Array.isArray(mod.frontPanels)
            )
                die('The schematic must export const frontPanels = { ... }');
            if (flags.has('--edge'))
                die('Named panels define the edge and components in the schematic');
            if (flags.has('--list')) {
                if (panelName) die('Use --list without a panel name');
                console.log(Object.keys(mod.frontPanels).join('\n'));
                return;
            }
            if (!panelName) die(`Choose a panel name: ${Object.keys(mod.frontPanels).join(', ')}`);
            const result = exportSchematicFrontPanel(mod.default, mod.frontPanels, panelName, {
                pcbFile: flags.has('--pcb')
                    ? path.resolve(flags.get('--pcb')!)
                    : path.join(schematicDir, `${mod.default.name}.kicad_pcb`),
                outputDir: flags.get('--output'),
            });
            console.log(
                `Front panel '${result.name}': ${result.cutouts} cutouts, ${result.labels} names, ${result.annotations} annotations, ${result.drawings} artwork entities\n${result.dxfFile}\n${result.svgFile}`,
            );
            return;
        }
    }
    if (panelName || flags.has('--list') || flags.has('--pcb'))
        die('Named front panels require a TypeScript schematic entry');
    const pcbFiles = schematicPath.endsWith('.kicad_pcb')
        ? [path.basename(schematicPath)]
        : fs
              .readdirSync(schematicDir)
              .filter((name) => name.endsWith('.kicad_pcb') && !name.startsWith('_autosave'));
    if (pcbFiles.length === 0) die(`No .kicad_pcb file found in ${schematicDir}. Run synth first.`);
    if (pcbFiles.length > 1)
        die(
            `More than one .kicad_pcb file found in ${schematicDir}; keep only the intended board.`,
        );
    const pcbFile = path.join(schematicDir, pcbFiles[0]);
    if (flags.has('--edge') && (!flags.has('--components') || !flags.has('--height')))
        die(
            'Vertical export requires --edge top|right|bottom|left --components J1,J2 --height <mm>',
        );
    const result = flags.has('--edge')
        ? exportVerticalFrontPanel(pcbFile, {
              edge: flags.get('--edge') as FrontPanelEdge,
              components: flags
                  .get('--components')!
                  .split(',')
                  .map((ref) => ref.trim()),
              height: Number(flags.get('--height')),
              bottomZ: flags.has('--bottom-z') ? Number(flags.get('--bottom-z')) : undefined,
              outputDir: flags.get('--output'),
          })
        : exportFrontPanel(pcbFile, flags.get('--output'));
    console.log(`\n🧰  Front panel exported\n`);
    console.log(`  Outline segments: ${result.outlineSegments}`);
    console.log(`  Cutouts: ${result.cutouts}`);
    console.log(`  Labels: ${result.labels}`);
    console.log(`  DXF: ${result.dxfFile}`);
    console.log(`  SVG: ${result.svgFile}`);
}
