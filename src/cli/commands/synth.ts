import { PcbPanel } from '../../synth/PcbPanel';
import { buildPcbPanel } from '../panel';
import * as path from 'path';
import { resolveSchematic, die } from '@tobisk/pcbs/cli/utils';
import { CircuitSnapshot } from '@tobisk/pcbs';
import type { PcbMode } from '../../kicad/PcbSynchronizer';
import { completeKicadReload, prepareKicadReload, PreparedKicadReload } from '../KicadReload';

export interface SynthCliOptions {
    entry?: string;
    noWires: boolean;
    noSymbols: boolean;
    experimentalRouting: boolean;
    experimentalLayout: boolean;
    reloadKicad: boolean;
    pcbMode: PcbMode;
}

/** Parse synth options strictly so misspelled feature flags cannot be silently ignored. */
export function parseSynthArgs(args: string[]): SynthCliOptions {
    const booleans = new Set([
        '--no-wires',
        '--no-symbols',
        '--experimental-routing',
        '--experimental',
        '--reload-kicad',
    ]);
    const values = new Set(['--pcb', '--pcb-mode', '--root']);
    let entry: string | undefined;
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        const inlineName = argument.includes('=')
            ? argument.slice(0, argument.indexOf('='))
            : argument;
        if (booleans.has(argument)) continue;
        if (values.has(inlineName)) {
            if (!argument.includes('=')) {
                if (args[index + 1] === undefined || args[index + 1].startsWith('--'))
                    throw new Error(`Option '${argument}' requires a value.`);
                index++;
            }
            continue;
        }
        if (argument.startsWith('-')) throw new Error(`Unknown synth option '${argument}'.`);
        if (entry !== undefined)
            throw new Error(`Unexpected additional synth entry '${argument}'.`);
        entry = argument;
    }

    const pcbMode = pcbModeFromArgs(args);
    const reloadKicad = args.includes('--reload-kicad');
    if (reloadKicad && pcbMode === 'preserve') {
        throw new Error(
            '--reload-kicad requires --pcb sync or --pcb rebuild because preserve mode does not update the PCB.',
        );
    }
    return {
        entry,
        noWires: args.includes('--no-wires'),
        noSymbols: args.includes('--no-symbols'),
        experimentalRouting: args.includes('--experimental-routing'),
        experimentalLayout: args.includes('--experimental'),
        reloadKicad,
        pcbMode,
    };
}

export function pcbModeFromArgs(args: string[]): PcbMode {
    const inline = args.find((arg) => arg.startsWith('--pcb-mode=') || arg.startsWith('--pcb='));
    const explicit = inline?.slice(inline.indexOf('=') + 1);
    const index = args.findIndex((arg) => arg === '--pcb-mode' || arg === '--pcb');
    const value = explicit ?? (index >= 0 ? args[index + 1] : undefined) ?? 'preserve';
    if (value !== 'preserve' && value !== 'sync' && value !== 'rebuild') {
        die(`Invalid PCB mode '${value}'. Expected preserve, sync, or rebuild.`);
    }
    return value;
}

/**
 * synth: Compile TypeScript schematic → Generate KiCad files directly
 */
export async function cmdSynth(args: string[]): Promise<void> {
    const parsed = parseSynthArgs(args);
    const schematicPath = await resolveSchematic(parsed.entry);
    const schematicDir = path.dirname(schematicPath);
    const schematicName = path.basename(schematicDir);

    console.log(`\n🚀  Synthesizing: ${schematicName}\n`);

    // Step 1: Load the TypeScript schematic
    try {
        const mod = require(schematicPath);
        const schematic = mod.default;
        if (typeof mod.beforeSynth === 'function') await mod.beforeSynth();
        if (schematic instanceof PcbPanel) {
            await buildPcbPanel(schematic, schematicPath);
            return;
        }

        if (!schematic || typeof schematic.generate !== 'function') {
            die(
                `${schematicPath} must have a default export that is a Schematic instance with a generate() method.`,
            );
        }

        console.log(`  → Generating circuit: ${schematic.name}...`);
        const snapshot = schematic._generateWithCapture() as CircuitSnapshot;
        console.log(`  ✅ Circuit generation complete.`);

        console.log(`  → Generating KiCad files...`);
        const { runSynthesis } = require('@tobisk/pcbs/cli/synthesis');

        let reload: PreparedKicadReload | undefined;
        if (parsed.reloadKicad) {
            const pcbPath = path.join(schematicDir, `${snapshot.name}.kicad_pcb`);
            reload = prepareKicadReload(pcbPath);
            if (reload.shouldReload) {
                console.log(`  → Saved matching open KiCad board before synchronization.`);
            } else if (reload.status === 'not-open') {
                console.log(`  → Matching PCB is not open in KiCad; no reload is needed.`);
            } else {
                console.warn(
                    `  ⚠️  KiCad IPC is unavailable; PCB generation will continue without reload.${reload.message ? ` ${reload.message}` : ' Enable the IPC API in KiCad Preferences → Plugins.'}`,
                );
            }
        }
        const result = runSynthesis(snapshot, schematicDir, {
            noWires: parsed.noWires,
            noSymbols: parsed.noSymbols,
            experimentalRouting: parsed.experimentalRouting,
            experimentalLayout: parsed.experimentalLayout,
            pcbMode: parsed.pcbMode,
        });

        if (result.success) {
            if (reload?.shouldReload) {
                completeKicadReload(reload);
                console.log(`  ✅ Reloaded synchronized PCB in KiCad.`);
            }
            console.log(`  ✅ Synthesis successful!`);
            console.log(`  📂 Output: ${schematicDir}`);
        } else {
            console.log(`  📂 Output: ${schematicDir}`);
            console.warn(
                `\n  ⚠️  Synthesis completed with warnings! The schematic was generated but may have issues. Use with caution.`,
            );
            if (result.errors && result.errors.length > 0) {
                console.warn(
                    `\n  Errors:\n` + result.errors.map((e: string) => `    - ${e}`).join('\n'),
                );
            }
            process.exit(1);
        }
    } catch (err: any) {
        die(`Synthesis failed: ${err.message}`);
    }
}
