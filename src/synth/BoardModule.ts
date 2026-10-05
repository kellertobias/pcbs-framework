import { serializeNativeBoard } from '../kicad/KicadNetFormat';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Module } from './Module';
import type { Schematic } from './Schematic';
import { KicadFootprint, type FootprintPadOptions } from './KicadFootprint';
import type { ModuleOptions, PcbPoint } from './types';
import { PcbGenerator } from '../kicad/PcbGenerator';
import { loadRoutingFile } from '../kicad/RoutingFile';
import { UuidManager } from '../kicad/UuidManager';
import { boardRoot, child, quote, value } from '../kicad/BoardComposition';
import { SExpressionParser as Parser, type SExpr } from '../kicad/SExpressionParser';
import { transformPcbPoint } from './PcbPosition';

export interface BoardModuleInterface {
    /** PCB point used as footprint and assembled-model origin. */
    origin?: PcbPoint;
    /** Only these physical source pads become carrier-board pads. */
    pads: {
        number: string;
        ref: string;
        pad: string;
        contact?: Partial<Omit<FootprintPadOptions, 'number' | 'x' | 'y'>>;
    }[];
}
export type BoardModuleOptions<P extends string | number> = Omit<ModuleOptions<P>, 'footprint'> & {
    schematic: Schematic;
    /** Stable footprint name; use a distinct name for each board variant. */
    name: string;
    /** Source project directory for footprint libraries and captured routing.json. */
    sourceDirectory?: string;
    interface?: BoardModuleInterface;
    /** Distance from carrier top to source PCB underside, mm. Defaults to zero. */
    standoff?: number;
};

/** A finished PCB assembly used as one component, with a user-defined symbol. */
export class BoardModule<P extends string | number = number> extends Module<P> {
    private static readonly building = new Set<Schematic>();
    private readonly definition: BoardModuleOptions<P>;
    constructor(options: BoardModuleOptions<P>) {
        if (!/^[A-Za-z0-9_-]+$/.test(options.name))
            throw new Error('Board module name must be a safe library filename');
        super({ ...options, footprint: `Board_Modules:${options.name}` });
        this.definition = options;
    }

    /** Generate interface geometry from the current source PCB, without invoking a renderer. */
    createFootprint(sourcePcb: string): KicadFootprint {
        const definition = this.definition.interface ?? this.definition.schematic.moduleInterface;
        if (!definition?.pads.length)
            throw new Error(`${this.ref}: source schematic must define a module interface`);
        const origin = definition.origin ?? { x: 0, y: 0 };
        if (
            ![origin.x, origin.y, this.definition.standoff ?? 0].every(Number.isFinite) ||
            (this.definition.standoff ?? 0) < 0
        )
            throw new Error('Module origin and non-negative standoff must be finite');
        const root = boardRoot(sourcePcb);
        const fp = new KicadFootprint({ name: this.definition.name });
        const tree = Parser.parse(fp.serialize())[0] as SExpr[];
        const selected = new Set<string>();
        for (const contact of definition.pads) {
            if (!contact.number || selected.has(`${contact.ref}:${contact.pad}`))
                throw new Error('Module contacts require numbers and unique source pads');
            selected.add(`${contact.ref}:${contact.pad}`);
            const matches = root.filter(
                (item): item is SExpr[] =>
                    Array.isArray(item) &&
                    item[0] === 'footprint' &&
                    value(child(item, 'property')?.[2] ?? '') === contact.ref,
            );
            if (matches.length !== 1)
                throw new Error(`Module contact cannot resolve source component ${contact.ref}`);
            const component = matches[0];
            const pads = component.filter(
                (item): item is SExpr[] =>
                    Array.isArray(item) && item[0] === 'pad' && value(item[1]) === contact.pad,
            );
            if (!pads.length)
                throw new Error(
                    `Module contact cannot resolve source pad ${contact.ref}.${contact.pad}`,
                );
            const anchor = child(component, 'at')!;
            for (const sourcePad of pads) {
                const pad = structuredClone(sourcePad);
                const at = child(pad, 'at')!;
                // Board footprints already contain mirrored local geometry for back-side parts.
                const position = transformPcbPoint(
                    { x: Number(at[1]), y: Number(at[2]) },
                    {
                        x: Number(anchor[1]),
                        y: Number(anchor[2]),
                        rotation: Number(anchor[3] ?? 0),
                    },
                );
                at[1] = String(position.x - origin.x);
                at[2] = String(position.y - origin.y);
                pad[1] = quote(contact.number);
                const cleaned = pad.filter(
                    (item) =>
                        !Array.isArray(item) ||
                        !['net', 'uuid', 'pinfunction', 'pintype'].includes(String(item[0])),
                );
                if (contact.contact) {
                    const size = child(pad, 'size')!;
                    const override = new KicadFootprint({ name: 'contact' }).addPad({
                        number: contact.number,
                        x: position.x - origin.x,
                        y: position.y - origin.y,
                        type: String(pad[2]) as FootprintPadOptions['type'],
                        shape: String(pad[3]) as FootprintPadOptions['shape'],
                        width: Number(size[1]),
                        height: Number(size[2]),
                        ...contact.contact,
                    });
                    const replacement = (Parser.parse(override.serialize())[0] as SExpr[]).find(
                        (item): item is SExpr[] => Array.isArray(item) && item[0] === 'pad',
                    )!;
                    child(replacement, 'at')!.push(String(at[3] ?? 0));
                    tree.push(replacement);
                } else tree.push(cleaned);
            }
        }
        // The source board perimeter is fabrication artwork, never carrier Edge.Cuts.
        for (const item of root) {
            if (
                !Array.isArray(item) ||
                !['gr_line', 'gr_arc', 'gr_circle', 'gr_rect', 'gr_poly'].includes(
                    String(item[0]),
                ) ||
                value(child(item, 'layer')?.[1] ?? '') !== 'Edge.Cuts'
            )
                continue;
            const contour = structuredClone(item);
            contour[0] = String(contour[0]).replace('gr_', 'fp_');
            child(contour, 'layer')![1] = quote('F.Fab');
            const shift = (node: SExpr[]): void => {
                if (['start', 'end', 'mid', 'center', 'xy'].includes(String(node[0]))) {
                    node[1] = String(Number(node[1]) - origin.x);
                    node[2] = String(Number(node[2]) - origin.y);
                }
                for (const sub of node) if (Array.isArray(sub)) shift(sub);
            };
            shift(contour);
            tree.push(contour);
        }
        // Preserve exact pad geometry (including custom primitives) from KiCad.
        const serializeAdditionalGeometry = fp.serialize.bind(fp);
        fp.serialize = () => {
            const additions = Parser.parse(serializeAdditionalGeometry())[0] as SExpr[];
            const geometry = additions.filter(
                (node) =>
                    Array.isArray(node) &&
                    (String(node[0]).startsWith('fp_') || node[0] === 'model' || node[0] === 'pad'),
            );
            return `${Parser.serialize([...tree, ...geometry])}\n`;
        };
        return fp;
    }

    /** @internal Build source board and assembled VRML, then return its carrier footprint. */
    _generateBoardFootprint(outputDir: string): string {
        const source = this.definition.schematic;
        if (BoardModule.building.has(source))
            throw new Error(`Cyclic board module: ${source.name}`);
        BoardModule.building.add(source);
        try {
            return this._buildBoardFootprint(outputDir);
        } finally {
            BoardModule.building.delete(source);
        }
    }

    private _buildBoardFootprint(outputDir: string): string {
        const assetDir = path.resolve(outputDir, 'board-modules', this.definition.name);
        fs.mkdirSync(assetDir, { recursive: true });
        let snapshot = this.definition.schematic._generateWithCapture();
        if (this.definition.sourceDirectory)
            snapshot = loadRoutingFile(snapshot, this.definition.sourceDirectory);
        if (!snapshot.pcb || snapshot.boards?.length)
            throw new Error('Board modules require a single source PCB');
        snapshot.pcb = { ...snapshot.pcb, requireAllPlaced: true };
        const result = new PcbGenerator(
            snapshot,
            new UuidManager(),
            outputDir,
            this.definition.sourceDirectory ?? outputDir,
        ).generate();
        if (result.warnings.length)
            throw new Error(`Cannot build complete module assembly: ${result.warnings.join('; ')}`);
        const footprint = this.createFootprint(result.content);
        const boardPath = path.join(assetDir, `${this.definition.name}.kicad_pcb`);
        fs.writeFileSync(boardPath, serializeNativeBoard(result.content));
        const modelPath = path.join(assetDir, `${this.definition.name}.wrl`);
        const origin = (this.definition.interface ?? this.definition.schematic.moduleInterface)!
            .origin ?? { x: 0, y: 0 };
        const binary =
            process.env.KICAD_CLI ??
            (fs.existsSync('/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli')
                ? '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli'
                : 'kicad-cli');
        const render = spawnSync(
            binary,
            [
                'pcb',
                'export',
                'vrml',
                '--force',
                '--output',
                modelPath,
                '--units',
                'tenths',
                '--user-origin',
                `${origin.x}x${origin.y}mm`,
                boardPath,
            ],
            { encoding: 'utf8', timeout: 180000 },
        );
        if (render.error || render.status !== 0 || !fs.existsSync(modelPath))
            throw new Error(
                `Module model export failed: ${render.error?.message ?? render.stderr}`,
            );
        const tree = Parser.parse(footprint.serialize())[0] as SExpr[];
        tree.push([
            'model',
            quote(modelPath.replace(/\\/g, '/')),
            [
                'offset',
                [
                    'xyz',
                    '0',
                    '0',
                    String((this.definition.standoff ?? 0) + (snapshot.pcb.thickness ?? 1.6)),
                ],
            ],
            ['scale', ['xyz', '1', '1', '1']],
            ['rotate', ['xyz', '0', '0', '0']],
        ]);
        const content = `${Parser.serialize(tree)}\n`;
        const pretty = path.join(outputDir, 'Board_Modules.pretty');
        fs.mkdirSync(pretty, { recursive: true });
        fs.writeFileSync(path.join(pretty, `${this.definition.name}.kicad_mod`), content);
        const tablePath = path.join(outputDir, 'fp-lib-table');
        const table = fs.existsSync(tablePath)
            ? (Parser.parse(fs.readFileSync(tablePath, 'utf8'))[0] as SExpr[])
            : (['fp_lib_table'] as SExpr[]);
        const existing = table.find(
            (item): item is SExpr[] =>
                Array.isArray(item) &&
                item[0] === 'lib' &&
                value(child(item, 'name')?.[1] ?? '') === 'Board_Modules',
        );
        if (
            existing &&
            value(child(existing, 'uri')?.[1] ?? '') !== '${KIPRJMOD}/Board_Modules.pretty'
        )
            throw new Error('Board_Modules library name is already in use');
        if (!existing)
            table.push([
                'lib',
                ['name', quote('Board_Modules')],
                ['type', quote('KiCad')],
                ['uri', quote('${KIPRJMOD}/Board_Modules.pretty')],
                ['options', quote('')],
                ['descr', quote('Generated PCB assemblies')],
            ]);
        fs.writeFileSync(tablePath, `${Parser.serialize(table)}\n`);
        return content;
    }
}
