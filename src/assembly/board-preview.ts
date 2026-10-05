import fs from 'node:fs';
import path from 'node:path';
import { PcbGenerator } from '../kicad/PcbGenerator';
import { UuidManager } from '../kicad/UuidManager';
import { loadRoutingFile } from '../kicad/RoutingFile';
import { Module } from '../synth/Module';
import { BoardModule } from '../synth/BoardModule';
import type { AssemblyBoard } from '../synth/Assembly';
import type { Schematic } from '../synth/Schematic';

/** TypeScript boards are source-driven preview assets. Never write back to the project PCB. */
export async function prepareBoardPreview(
    part: AssemblyBoard,
    base: string,
    saved: string,
    output: string,
): Promise<string> {
    const entry = part.file && path.resolve(base, part.file);
    if (!part.schematic && (!entry || !/\.[jt]s$/i.test(entry))) return saved;
    const exported = entry ? require(entry) : undefined;
    const schematic: Schematic = part.schematic ?? exported.default ?? exported;
    const sourceDirectory = path.dirname(saved);
    const snapshot = loadRoutingFile(schematic._generateWithCapture(), sourceDirectory);
    if (entry && preferSavedBoard(entry, saved, snapshot.pcb?.routingFile ?? 'routing.json'))
        return saved;
    if (!snapshot.pcb) throw new Error(`No PCB configuration for assembly board ${part.id}`);
    fs.mkdirSync(output, { recursive: true });
    const libraries = new Set<string>();
    const generated = new Set<string>();
    for (const component of snapshot.components) {
        if (
            !(component instanceof Module) ||
            component instanceof BoardModule ||
            !component.footprint?.includes(':')
        )
            continue;
        const [library, name] = component.footprint.split(':');
        if (generated.has(component.footprint)) continue;
        generated.add(component.footprint);
        const factory = component.constructor as typeof Module;
        const footprint = factory.makeFootprint();
        if (footprint.name !== name)
            throw new Error(
                `Preview footprint name mismatch: ${component.footprint} versus ${footprint.name}`,
            );
        // Inherited model factories can describe a base device rather than a derived multi-model assembly.
        if (Object.prototype.hasOwnProperty.call(factory, 'make3DModel')) {
            const model = await factory.make3DModel();
            if (model) {
                const result = await model.export({
                    outDir: path.join(output, 'models'),
                    baseName: name,
                    formats: ['wrl'],
                });
                if (result.wrlPath) {
                    const links = footprint.get3DModels();
                    if (links.length > 1)
                        throw new Error(
                            `Model factory for ${name} must declare a single assembly model link`,
                        );
                    footprint.set3DModel({ ...links[0], path: result.wrlPath });
                }
            }
        }
        footprint.writeFile(path.join(output, `${library}.pretty`));
        libraries.add(library);
    }
    fs.writeFileSync(
        path.join(output, 'fp-lib-table'),
        `(fp_lib_table (version 7)\n${[...libraries].map((library) => `(lib (name ${JSON.stringify(library)})(type "KiCad")(uri ${JSON.stringify(path.join(output, `${library}.pretty`))})(options "")(descr "Assembly preview"))`).join('\n')}\n)`,
    );
    const uuids = new UuidManager();
    uuids.load(path.join(sourceDirectory, 'uuids.json'));
    const result = new PcbGenerator(snapshot, uuids, output, sourceDirectory).generate();
    const missingGeometry = result.warnings.filter((warning) =>
        warning.startsWith('Could not resolve footprint'),
    );
    if (missingGeometry.length)
        throw new Error(`Incomplete assembly board ${part.id}: ${missingGeometry.join('; ')}`);
    const file = path.join(output, `${schematic.name}.kicad_pcb`);
    fs.writeFileSync(file, result.content.split('${KIPRJMOD}').join(sourceDirectory));
    return file;
}

/** The most recently authored geometry wins between native KiCad and local source dependencies. */
export function preferSavedBoard(
    entry: string,
    saved: string,
    routingFile = 'routing.json',
): boolean {
    const visited = new Set<string>();
    const visit = (file: string): number => {
        if (
            visited.has(file) ||
            file.includes(`${path.sep}node_modules${path.sep}`) ||
            file.startsWith(path.resolve(__dirname, '..') + path.sep)
        )
            return 0;
        visited.add(file);
        return Math.max(
            fs.statSync(file).mtimeMs,
            ...(require.cache[file]?.children ?? []).map((child) => visit(child.filename)),
        );
    };
    const routing = path.resolve(path.dirname(saved), routingFile);
    const modified = Math.max(
        visit(require.resolve(entry)),
        fs.existsSync(routing) ? fs.statSync(routing).mtimeMs : 0,
    );
    return fs.statSync(saved).mtimeMs >= modified;
}
