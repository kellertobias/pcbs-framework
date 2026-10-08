import type { CircuitSnapshot } from '../synth/types';
import type { SymbolLibrary } from './SymbolLibrary';
import { SchematicGenerator } from './SchematicGenerator';
import { schematicHeader } from './SchematicHeader';
import { SExpressionParser as Parser, type SExpr } from './SExpressionParser';
import { UuidManager } from './UuidManager';
import type { KicadGeneratorOptions } from './KicadGenerator';

const childStyle = (
    group: { connectionStyle?: CircuitSnapshot['connectionStyle'] },
    snapshot: CircuitSnapshot,
) => group.connectionStyle ?? snapshot.connectionStyle;
const quote = (value: string) => JSON.stringify(value);
const nodes = (root: SExpr[], kind: string) =>
    root.filter((node): node is SExpr[] => Array.isArray(node) && node[0] === kind);

/** Scope drawing identities by page, while retaining physical component identities. */
class PageUuids extends UuidManager {
    constructor(
        private readonly parent: UuidManager,
        private readonly page: string,
        private readonly refs: Set<string>,
    ) {
        super();
    }
    getOrGenerate(key: string): string {
        return this.parent.getOrGenerate(
            this.refs.has(key) ||
                [...this.refs].some(
                    (ref) => key.startsWith(`${ref}_pin_`) || key.startsWith(`${ref}/unit/`),
                )
                ? key
                : `page/${this.page}/${key}`,
        );
    }
}

/** Native hierarchy: global net labels carry electrical connections between sections. */
export function generateSchematicPages(
    snapshot: CircuitSnapshot,
    library: SymbolLibrary,
    uuids: UuidManager,
    options: KicadGeneratorOptions,
) {
    const layout = snapshot.schematicRouting!.autoLayout!;
    const refs = new Set(
        snapshot.components.filter((c) => c.symbol !== 'Device:DNC').map((c) => c.ref),
    );
    const claimed = new Set<string>();
    for (const group of layout.groups) {
        if (!/^[a-zA-Z0-9_-]+$/.test(group.id))
            throw new Error(`Invalid schematic page id '${group.id}'`);
        for (const drawing of group.components) {
            if (drawing.includes('/'))
                throw new Error(
                    'Paged groups currently require whole components, not split drawing units.',
                );
            if (!refs.has(drawing) || claimed.has(drawing))
                throw new Error(`Unknown or duplicate schematic page component '${drawing}'`);
            claimed.add(drawing);
        }
    }
    if (claimed.size !== refs.size)
        throw new Error('Paged schematic groups must include every component.');
    const parentUuid = uuids.getOrGenerate('ROOT');
    const pages = layout.groups
        .filter((g) => g.components.length)
        .map((group, index) => {
            const members = new Set(group.components);
            const pageUuids = new PageUuids(uuids, group.id, refs);
            const childUuid = pageUuids.getOrGenerate('ROOT');
            const sheetUuid = uuids.getOrGenerate(`sheet/${group.id}`);
            const child: CircuitSnapshot = {
                ...snapshot,
                size: 'A4',
                projectName: snapshot.projectName ?? snapshot.name,
                components: snapshot.components.filter((c) => members.has(c.ref)),
                connectionStyle: group.connectionStyle ?? snapshot.connectionStyle,
                schematicRouting: {
                    ...snapshot.schematicRouting,
                    interfaceComponents: (
                        snapshot.schematicRouting?.interfaceComponents ?? []
                    ).filter((ref) => members.has(ref)),
                    externalNets: snapshot.nets
                        .filter(
                            (net) =>
                                net.pins.some(
                                    (pin) => !pin.isDNC && members.has(pin.component.ref),
                                ) &&
                                net.pins.some(
                                    (pin) => !pin.isDNC && !members.has(pin.component.ref),
                                ),
                        )
                        .map((net) => net.name),
                    autoLayout: {
                        ...layout,
                        algorithm:
                            childStyle(group, snapshot) === 'direct-labels'
                                ? 'grid'
                                : layout.algorithm,
                        pages: false,
                        labelOnly: childStyle(group, snapshot) === 'direct-labels',
                        groups: [group],
                    },
                },
            };
            const generator = new SchematicGenerator(child, library, pageUuids, options);
            const root = Parser.parse(generator.generate())[0] as SExpr[];
            const hierarchy = `/${parentUuid}/${sheetUuid}`;
            for (const symbol of nodes(root, 'symbol')) {
                for (const property of nodes(symbol, 'property')) {
                    if (property[1] === quote('hierarchy_path')) property[2] = quote(hierarchy);
                    if (property[1] === quote('root_uuid')) property[2] = quote(parentUuid);
                }
                const instances = nodes(symbol, 'instances')[0];
                if (instances)
                    for (const project of nodes(instances, 'project')) {
                        project[1] = quote(snapshot.name);
                        for (const path of nodes(project, 'path')) path[1] = quote(hierarchy);
                    }
            }
            root.push([
                'sheet_instances',
                ['path', quote(hierarchy), ['page', quote(String(index + 2))]],
            ]);
            return {
                id: group.id,
                title: group.title,
                file: `${snapshot.name}-${group.id}.kicad_sch`,
                uuid: sheetUuid,
                childUuid,
                content: Parser.serialize(root),
                warnings: generator.warnings,
                layout: generator.layoutReport,
            };
        });
    const overviewPaper = (
        [
            ['A4', 297, 210],
            ['A3', 420, 297],
            ['A2', 594, 420],
            ['A1', 841, 594],
            ['A0', 1189, 841],
        ] as const
    ).find(
        ([, width, height]) =>
            Math.floor((width - 25) / 125) * Math.floor((height - 80) / 24) >= pages.length,
    );
    if (!overviewPaper)
        throw new Error('Schematic overview exceeds A0; reduce the number of groups.');
    const overviewRows = Math.floor((overviewPaper[2] - 80) / 24);
    const overview: CircuitSnapshot = {
        ...snapshot,
        size: overviewPaper[0],
        components: [],
        nets: [],
        autoPack: false,
        schematicRouting: undefined,
        connectionStyle: 'direct-labels',
    };
    const root = Parser.parse(
        new SchematicGenerator(overview, library, uuids, options).generate(),
    )[0] as SExpr[];
    root.push(...schematicHeader(overview, uuids));
    for (const [index, page] of pages.entries()) {
        const x = 20 + Math.floor(index / overviewRows) * 125,
            y = 25 + (index % overviewRows) * 24;
        root.push([
            'sheet',
            ['at', String(x), String(y)],
            ['size', '110', '15'],
            ['stroke', ['width', '0.254'], ['type', 'default']],
            ['fill', ['color', '0', '0', '0', '0']],
            ['uuid', quote(page.uuid)],
            [
                'property',
                quote('Sheetname'),
                quote(page.title),
                ['at', String(x), String(y - 1.27), '0'],
                ['effects', ['font', ['size', '1.27', '1.27']], ['justify', 'left', 'bottom']],
            ],
            [
                'property',
                quote('Sheetfile'),
                quote(page.file),
                ['at', String(x), String(y + 16.27), '0'],
                ['effects', ['font', ['size', '1.016', '1.016']], ['justify', 'left', 'top']],
            ],
            [
                'instances',
                [
                    'project',
                    quote(snapshot.name),
                    ['path', quote(`/${parentUuid}`), ['page', quote(String(index + 2))]],
                ],
            ],
        ]);
    }
    root.push([
        'text',
        quote(
            'Functional sections share named global nets. Electrical circuit and PCB are defined by the TypeScript source.',
        ),
        ['at', '20', '15', '0'],
        ['effects', ['font', ['size', '1.27', '1.27']], ['justify', 'left']],
        ['uuid', quote(uuids.getOrGenerate('overview/note'))],
    ]);
    root.push(['sheet_instances', ['path', quote('/'), ['page', quote('1')]]]);
    return { content: Parser.serialize(root), pages };
}
