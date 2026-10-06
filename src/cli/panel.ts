import { outputPaths } from '../project/OutputPaths';
import { serializeNativeBoard } from '../kicad/KicadNetFormat';
import { KicadGenerator } from '../kicad/KicadGenerator';
import fs from 'node:fs';
import path from 'node:path';
import { PcbPanel } from '../synth/PcbPanel';
import { PcbGenerator } from '../kicad/PcbGenerator';
import { UuidManager } from '../kicad/UuidManager';
import { prepareProjectLibraries } from '../project/ProjectLibraries';
import { getConfig } from './config';

/** Refresh the referenced boards before copying saved native copper into a new panel. */
export async function buildPcbPanel(
    panel: PcbPanel,
    entry: string,
    refresh = true,
): Promise<string> {
    if (
        !Object.keys(panel.project.definition.panels ?? {}).some(
            (key) => panel.project.entry('panels', key) === path.resolve(entry),
        )
    )
        throw new Error('Panel entry does not belong to its project');
    if (refresh) {
        const { cmdSynth } = await import('./commands/synth');
        for (const source of panel.sourceEntries()) await cmdSynth([source, '--pcb', 'sync']);
    }
    const directory = outputPaths(path.dirname(entry)).export;
    fs.mkdirSync(directory, { recursive: true });
    prepareProjectLibraries(directory, getConfig().projectRoot);
    const uuids = new UuidManager();
    uuids.load(path.join(directory, 'uuids.json'));
    const snapshot = panel._generateWithCapture();
    const result = new PcbGenerator(snapshot, uuids, directory).generate();
    if (result.warnings.length) console.warn(result.warnings.join('\n'));
    const file = path.join(directory, `${panel.name}.kicad_pcb`);
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, serializeNativeBoard(result.content));
    fs.renameSync(temporary, file);
    uuids.save();
    const project = path.join(directory, `${panel.name}.kicad_pro`);
    const settings = fs.existsSync(project) ? JSON.parse(fs.readFileSync(project, 'utf8')) : {};
    settings.meta = { filename: path.basename(project), version: 1 };
    settings.board ??= {};
    settings.board.design_settings ??= {};
    settings.board.design_settings.rules = {
        ...settings.board.design_settings.rules,
        ...snapshot.pcb?.designRules,
    };
    fs.writeFileSync(project, JSON.stringify(settings, null, 2));
    if (snapshot.pcb?.netClasses?.length) {
        const generator = new KicadGenerator();
        generator.syncProjectNetSettings(project, snapshot);
        generator.syncCustomRules(
            path.join(directory, `${panel.name}.kicad_dru`),
            snapshot.pcb.netClasses,
        );
    }
    console.log(`Built manufacturing panel: ${file}`);
    return file;
}
