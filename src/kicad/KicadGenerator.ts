import { schematicWorksheet } from './SchematicHeader';
import { generateSchematicPages } from './SchematicPages';
import { backupGeneratedFile } from '../project/OutputPaths';
import { automaticallyRoute } from '../router/AutomaticRouting';
import { serializeNativeBoard } from './KicadNetFormat';
import { copperUuids, loadRoutingFile } from './RoutingFile';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { CircuitSnapshot, PcbNetClass } from '../synth/types';
import { SymbolLibrary } from './SymbolLibrary';
import { UuidManager } from './UuidManager';
import { SchematicGenerator } from './SchematicGenerator';
import { NetlistGenerator } from './NetlistGenerator';
import { KicadLibrary } from '../synth/KicadLibrary';
import { PcbGenerator } from './PcbGenerator';
import { PcbMode, PcbSyncReport, synchronizePcb } from './PcbSynchronizer';

export interface KicadGeneratorOptions {
    /** Enable source-driven PCB routing. The project CLI enables this for sync/rebuild. */
    autoRoute?: boolean;
    /** Library lookup root, separate from the generated output directory. */
    footprintDirectory?: string;
    noWires?: boolean;
    noSymbols?: boolean;
    experimentalRouting?: boolean;
    experimentalLayout?: boolean;
    /** Validate the temporary schematic with kicad-cli before replacing output. Defaults to true when available. */
    validateWithKicad?: boolean;
    /** PCB handling policy. Defaults to preserve so existing boards are never touched implicitly. */
    pcbMode?: PcbMode;
}

export class KicadGenerator {
    private library: SymbolLibrary;
    private uuids: UuidManager;
    public errors: string[] = [];
    public warnings: string[] = [];

    constructor(private readonly libraryPaths?: string[]) {
        this.library = new SymbolLibrary();
        this.uuids = new UuidManager();

        // Default library paths from environment
        const envPaths = process.env.KICAD_SYMBOL_DIR
            ? process.env.KICAD_SYMBOL_DIR.split(':')
            : [];

        // Standard system paths for KiCad symbols
        const systemPaths = [
            '/usr/share/kicad/symbols',
            '/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols',
            'C:\\Program Files\\KiCad\\share\\kicad\\symbols',
        ].filter((p) => fs.existsSync(p));

        const paths = [...(libraryPaths || []), ...envPaths, ...systemPaths];
        this.library.setLibraryPaths(paths);
    }

    private writeAtomic(filePath: string, content: string): void {
        const temporaryPath = `${filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
        let fd: number | undefined;
        try {
            fd = fs.openSync(temporaryPath, 'w');
            fs.writeFileSync(fd, content, 'utf-8');
            fs.fsyncSync(fd);
            fs.closeSync(fd);
            fd = undefined;
            fs.renameSync(temporaryPath, filePath);
        } catch (error) {
            if (fd !== undefined) fs.closeSync(fd);
            if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
            throw error;
        }
    }

    private writeValidatedSchematic(
        filePath: string,
        content: string,
        validateWithKicad: boolean,
    ): void {
        const temporaryPath = `${filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}.kicad_sch`;
        const validationNetlist = `${temporaryPath}.net`;
        let fd: number | undefined;

        try {
            fd = fs.openSync(temporaryPath, 'w');
            fs.writeFileSync(fd, content, 'utf-8');
            fs.fsyncSync(fd);
            fs.closeSync(fd);
            fd = undefined;

            if (validateWithKicad) {
                const validation = spawnSync(
                    'kicad-cli',
                    ['sch', 'export', 'netlist', '--output', validationNetlist, temporaryPath],
                    { encoding: 'utf-8' },
                );

                if (
                    validation.error &&
                    (validation.error as NodeJS.ErrnoException).code === 'ENOENT'
                ) {
                    this.warnings.push(
                        'kicad-cli was not found; generated schematic syntax was not externally validated.',
                    );
                } else if (validation.error || validation.status !== 0) {
                    const details = [
                        validation.stderr,
                        validation.stdout,
                        validation.error?.message,
                    ]
                        .filter(Boolean)
                        .join('\n')
                        .trim();
                    throw new Error(
                        `KiCad rejected generated schematic '${path.basename(filePath)}'${details ? `:\n${details}` : '.'}`,
                    );
                }
            }

            fs.renameSync(temporaryPath, filePath);
        } catch (error) {
            if (fd !== undefined) fs.closeSync(fd);
            throw error;
        } finally {
            if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
            if (fs.existsSync(validationNetlist)) fs.unlinkSync(validationNetlist);
        }
    }

    generate(snapshot: CircuitSnapshot, outputDir: string, options: KicadGeneratorOptions = {}) {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const automaticRouting = options.autoRoute === true && snapshot.pcb?.autoRoute !== false;
        if ((options.pcbMode ?? 'preserve') !== 'preserve' && !automaticRouting)
            snapshot = loadRoutingFile(snapshot, outputDir);
        for (const board of snapshot.boards ?? []) {
            const generator = new KicadGenerator(this.libraryPaths);
            const result = generator.generate(
                board.snapshot,
                path.join(outputDir, 'boards', board.id),
                {
                    ...options,
                    footprintDirectory:
                        board.sourceDirectory ?? options.footprintDirectory ?? outputDir,
                },
            );
            this.errors.push(...result.errors.map((error) => `${board.id}: ${error}`));
            this.warnings.push(...result.warnings.map((warning) => `${board.id}: ${warning}`));
        }
        const name = snapshot.name;
        const pcbMode = options.pcbMode ?? 'preserve';
        const schPath = path.join(outputDir, `${name}.kicad_sch`);
        const netPath = path.join(outputDir, `${name}.net`);
        const uuidPath = path.join(outputDir, 'uuids.json');

        // Validate component references end in a number
        for (const comp of snapshot.components) {
            if (comp.symbol === 'Device:DNC' || comp.ref === '#PWR') continue;
            if (!/\d+$/.test(comp.ref)) {
                throw new Error(
                    `Invalid Reference: Component '${comp.ref}' (${comp.symbol}) must end in a number to be compatible with KiCad annotation.`,
                );
            }
        }

        // Load existing UUIDs
        this.uuids.load(uuidPath);

        // Generate Schematic
        console.log(`  → Generating Schematic: ${schPath}...`);
        const schematicGen = new SchematicGenerator(snapshot, this.library, this.uuids, options);
        const paged = snapshot.schematicRouting?.autoLayout?.pages
            ? generateSchematicPages(snapshot, this.library, this.uuids, options)
            : undefined;
        const schematicContent = paged?.content ?? schematicGen.generate();
        if (paged) {
            for (const page of paged.pages) {
                this.writeAtomic(path.join(outputDir, page.file), page.content);
                this.warnings.push(...page.warnings.map((warning) => `${page.id}: ${warning}`));
            }
            this.writeAtomic(
                path.join(outputDir, `${name}-schematic-layout.json`),
                `${JSON.stringify(
                    paged.pages.map(({ content, ...page }) => page),
                    null,
                    2,
                )}\n`,
            );
        }
        if (schematicGen.layoutReport) {
            const { positions, ...layout } = schematicGen.layoutReport;
            fs.writeFileSync(
                path.join(outputDir, `${name}-schematic-layout.json`),
                `${JSON.stringify({ ...layout, positions: Object.fromEntries(positions), warnings: schematicGen.warnings }, null, 2)}\n`,
            );
            console.log(
                `  → Arranged ${positions.size} drawings in ${layout.frames.length} functional groups (${layout.paper}, ${layout.algorithm}).`,
            );
        }

        if (schematicGen.errors.length > 0) {
            this.errors.push(...schematicGen.errors);
        }
        if (schematicGen.warnings.length > 0) {
            this.warnings.push(...schematicGen.warnings);
        }
        this.writeValidatedSchematic(
            schPath,
            schematicContent,
            options.validateWithKicad !== false,
        );

        // Generate Netlist
        console.log(`  → Generating Netlist: ${netPath}...`);
        const netlistGen = new NetlistGenerator(snapshot, this.library, this.uuids, schPath);
        const netlistContent = netlistGen.generate();
        this.writeAtomic(netPath, netlistContent);

        // Save UUIDs
        this.uuids.save();

        // Generate minimal project file if missing
        const proPath = path.join(outputDir, `${name}.kicad_pro`);
        if (!fs.existsSync(proPath)) {
            const proContent = JSON.stringify(
                {
                    meta: { filename: `${name}.kicad_pro`, version: 1 },
                    board: {
                        design_settings: {
                            rules: {
                                solder_mask_clearance: 0.0,
                                solder_mask_min_width: 0.0,
                                solder_paste_clearance: 0.0,
                                solder_paste_margin: 0.0,
                            },
                        },
                    },
                },
                null,
                2,
            );
            this.writeAtomic(proPath, proContent);
        }
        if (snapshot.schematicRouting?.autoLayout) {
            const worksheet = `${name}.kicad_wks`;
            this.writeAtomic(path.join(outputDir, worksheet), schematicWorksheet());
            const project = JSON.parse(fs.readFileSync(proPath, 'utf8'));
            project.schematic = { ...project.schematic, page_layout_descr_file: worksheet };
            this.writeAtomic(proPath, `${JSON.stringify(project, null, 2)}\n`);
        }
        if (snapshot.pcb?.netClasses?.length && pcbMode !== 'preserve') {
            this.syncProjectNetSettings(proPath, snapshot);
            this.syncCustomRules(
                path.join(outputDir, `${name}.kicad_dru`),
                snapshot.pcb.netClasses,
            );
        }
        if (snapshot.pcb?.designRules && pcbMode !== 'preserve') {
            const project = JSON.parse(fs.readFileSync(proPath, 'utf-8'));
            project.board ??= {};
            project.board.design_settings ??= {};
            project.board.design_settings.rules = {
                ...project.board.design_settings.rules,
                ...snapshot.pcb.designRules,
            };
            this.writeAtomic(proPath, JSON.stringify(project, null, 2));
        }
        if (snapshot.pcb?.routeHints?.length || snapshot.pcb?.exactRoutes?.length) {
            this.writeRouteIntent(outputDir, name, snapshot);
        }

        // PCB writes are always governed by an explicit mode. The default preserve
        // mode intentionally does not even read an existing board.
        const pcbPath = path.join(outputDir, `${name}.kicad_pcb`);
        if (snapshot.pcb && pcbMode !== 'preserve') {
            const routingStatePath = path.join(outputDir, `${name}.pcb-routing-state.json`);
            let ownedCopperUuids: string[] = [];
            if (fs.existsSync(routingStatePath)) {
                const state = JSON.parse(fs.readFileSync(routingStatePath, 'utf-8'));
                if (
                    state.version !== 1 ||
                    state.board !== name ||
                    !Array.isArray(state.ownedCopperUuids) ||
                    state.ownedCopperUuids.some((uuid: unknown) => typeof uuid !== 'string')
                )
                    throw new Error(`Invalid routing ownership state: ${routingStatePath}`);
                ownedCopperUuids = state.ownedCopperUuids;
            }
            const pcbResult = new PcbGenerator(
                snapshot,
                this.uuids,
                outputDir,
                options.footprintDirectory,
            ).generate();
            if (automaticRouting) {
                const routed = automaticallyRoute(snapshot, pcbResult.content, outputDir);
                pcbResult.content = routed.content;
                console.log(
                    `  → Automatic PCB routing: ${routed.cached ? 'reused matching generated cache' : 'regenerated from circuit and layout hints'}.`,
                );
            }
            this.uuids.save();
            this.warnings.push(...pcbResult.warnings);
            if (pcbMode === 'sync' && fs.existsSync(pcbPath)) {
                const synchronized = synchronizePcb(
                    fs.readFileSync(pcbPath, 'utf-8'),
                    pcbResult.content,
                    {
                        refreshFootprints: snapshot.pcb.refreshFootprints,
                        ownedCopperUuids,
                    },
                );
                console.log(
                    `  → Synchronizing PCB: ${pcbPath} (${synchronized.report.updatedFootprints.length} updated, ${synchronized.report.addedFootprints.length} added)...`,
                );
                this.writeAtomic(pcbPath, serializeNativeBoard(synchronized.content));
                this.writePcbReport(outputDir, name, synchronized.report);
                for (const move of synchronized.report.routedFootprintMoves) {
                    this.warnings.push(`PCB_SYNC_REROUTE_REQUIRED ${JSON.stringify(move)}`);
                }
                if (snapshot.pcb.zones?.length)
                    this.warnings.push(
                        `PCB_ZONES_REQUIRE_REFILL ${snapshot.pcb.zones.length} managed zone outline(s) changed; open/save in KiCad or refill before fabrication export.`,
                    );
            } else {
                let backupPath: string | undefined;
                if (pcbMode === 'rebuild' && fs.existsSync(pcbPath)) {
                    backupPath = this.createPcbBackup(pcbPath);
                    console.log(`  → Backed up PCB: ${backupPath}`);
                }
                console.log(
                    `  → ${pcbMode === 'rebuild' ? 'Rebuilding' : 'Generating'} PCB: ${pcbPath} (${pcbResult.placed} explicitly placed footprints)...`,
                );
                this.writeAtomic(pcbPath, serializeNativeBoard(pcbResult.content));
                const report: PcbSyncReport & { backupPath?: string } = {
                    mode: pcbMode,
                    addedFootprints: [],
                    updatedFootprints: [],
                    addedGeometry: [],
                    updatedGeometry: [],
                    zoneFill: snapshot.pcb.zones?.length
                        ? 'requires-kicad-refill'
                        : 'not-applicable',
                    routedFootprintMoves: [],
                    preservedCopper: { segments: 0, arcs: 0, vias: 0, zones: 0 },
                    backupPath,
                };
                this.writePcbReport(outputDir, name, report);
                if (snapshot.pcb.zones?.length)
                    this.warnings.push(
                        `PCB_ZONES_REQUIRE_REFILL ${snapshot.pcb.zones.length} managed zone outline(s) generated without transient filled-polygon caches.`,
                    );
            }
            this.writeAtomic(
                routingStatePath,
                `${JSON.stringify({ version: 1, board: name, ownedCopperUuids: copperUuids(pcbResult.content) }, null, 2)}\n`,
            );
        } else if (pcbMode !== 'preserve' && !snapshot.pcb) {
            this.warnings.push(
                `PCB mode '${pcbMode}' requested, but the schematic declares no PCB configuration; no board was written.`,
            );
        }

        return {
            success: this.errors.length === 0,
            errors: this.errors,
            warnings: this.warnings,
        };
    }

    private createPcbBackup(pcbPath: string): string {
        return backupGeneratedFile(pcbPath);
    }

    private writeRouteIntent(outputDir: string, name: string, snapshot: CircuitSnapshot): void {
        const intent = {
            version: 1,
            generatedBy: '@tobisk/pcbs',
            hints: snapshot.pcb?.routeHints ?? [],
            exactRoutes: (snapshot.pcb?.exactRoutes ?? []).map((route) => ({
                id: route.id,
                net: route.net,
            })),
            note: 'Route hints are constraints only and do not create copper. Exact routes are the only TypeScript route declarations emitted as copper.',
        };
        this.writeAtomic(
            path.join(outputDir, `${name}.pcb-intent.json`),
            `${JSON.stringify(intent, null, 2)}\n`,
        );
    }

    public syncProjectNetSettings(projectPath: string, snapshot: CircuitSnapshot): void {
        const project = JSON.parse(fs.readFileSync(projectPath, 'utf-8'));
        const netSettings = project.net_settings ?? {
            classes: [],
            meta: { version: 4 },
            net_colors: null,
            netclass_assignments: null,
            netclass_patterns: [],
        };
        const declared = snapshot.pcb?.netClasses ?? [];
        const declaredNames = new Set(declared.map((netClass) => netClass.name));
        const preserved = (netSettings.classes ?? []).filter(
            (entry: any) => !declaredNames.has(entry.name),
        );
        netSettings.classes = [
            ...preserved,
            ...declared.map((netClass) => this.kicadNetClass(netClass)),
        ];
        const assignments: Record<string, string> = {
            ...(netSettings.netclass_assignments ?? {}),
        };
        for (const netClass of declared) {
            const nets = new Set(netClass.nets ?? []);
            for (const net of snapshot.nets) if (net.class === netClass.name) nets.add(net.name);
            for (const net of nets) assignments[net] = netClass.name;
        }
        netSettings.netclass_assignments = Object.keys(assignments).length ? assignments : null;
        // KiCad 9 resolves net-class patterns; retain legacy assignments for older
        // projects, and write equivalent literal patterns for current KiCad.
        const patterns = (netSettings.netclass_patterns ?? []).filter(
            (p: any) => !Object.prototype.hasOwnProperty.call(assignments, p.pattern),
        );
        netSettings.netclass_patterns = [
            ...patterns,
            ...Object.entries(assignments).map(([pattern, netclass]) => ({
                pattern,
                netclass,
            })),
        ];
        project.net_settings = netSettings;
        this.writeAtomic(projectPath, `${JSON.stringify(project, null, 2)}\n`);
    }

    private kicadNetClass(netClass: PcbNetClass): Record<string, unknown> {
        return {
            bus_width: 12,
            clearance: netClass.clearance,
            diff_pair_gap: netClass.diffPairGap ?? netClass.clearance,
            diff_pair_via_gap:
                netClass.diffPairViaGap ?? netClass.diffPairGap ?? netClass.clearance,
            diff_pair_width: netClass.diffPairWidth ?? netClass.width,
            line_style: 0,
            microvia_diameter: netClass.microviaDiameter ?? 0.3,
            microvia_drill: netClass.microviaDrill ?? 0.1,
            name: netClass.name,
            pcb_color: 'rgba(0, 0, 0, 0.000)',
            priority: netClass.name === 'Default' ? 2147483647 : 0,
            schematic_color: 'rgba(0, 0, 0, 0.000)',
            track_width: netClass.width,
            via_diameter: netClass.viaDiameter ?? Math.max(0.6, netClass.width * 2),
            via_drill: netClass.viaDrill ?? 0.3,
            wire_width: 6,
        };
    }

    public syncCustomRules(rulePath: string, netClasses: PcbNetClass[]): void {
        const begin = '# TSPCB MANAGED RULES BEGIN';
        const end = '# TSPCB MANAGED RULES END';
        const existing = fs.existsSync(rulePath)
            ? fs.readFileSync(rulePath, 'utf-8')
            : `(version 1)\n`;
        const before = existing.includes(begin)
            ? existing.slice(0, existing.indexOf(begin)).trimEnd()
            : existing.trimEnd();
        const after = existing.includes(end)
            ? existing.slice(existing.indexOf(end) + end.length).trimStart()
            : '';
        const managed = netClasses.flatMap((netClass) => this.customRules(netClass)).join('\n\n');
        const content = `${before}\n\n${begin}\n${managed}${managed ? '\n' : ''}${end}${after ? `\n${after}` : ''}\n`;
        this.writeAtomic(rulePath, content);
    }

    private customRules(netClass: PcbNetClass): string[] {
        const rules: string[] = [];
        const escapedName = netClass.name.replace(/'/g, "\\'").replace(/"/g, '\\"');
        // Explicit clearance rules also apply when an older/newer KiCad project
        // resolves a generated class through its Default fallback.
        rules.push(
            `(rule "TSPCB ${escapedName} clearance"\n\t${netClass.name === 'Default' ? '' : `(condition "A.NetClass == '${escapedName}'")`}\n\t(constraint clearance (min ${netClass.clearance}mm))\n)`,
        );
        if (netClass.preferredLayers?.length) {
            const layerCondition = netClass.preferredLayers
                .map((layer) => `A.Layer == '${layer}'`)
                .join(' || ');
            rules.push(
                `(rule "TSPCB ${escapedName} preferred layers"\n\t(condition "A.NetClass == '${escapedName}' && A.Type == 'Track' && !(${layerCondition})")\n\t(constraint disallow track)\n)`,
            );
        }
        if (netClass.length) {
            const target = netClass.length.target;
            const tolerance = netClass.length.tolerance ?? 0;
            const min =
                netClass.length.min ?? (target !== undefined ? target - tolerance : undefined);
            const max =
                netClass.length.max ?? (target !== undefined ? target + tolerance : undefined);
            const values = [
                min !== undefined ? `(min ${min}mm)` : '',
                target !== undefined ? `(opt ${target}mm)` : '',
                max !== undefined ? `(max ${max}mm)` : '',
            ]
                .filter(Boolean)
                .join(' ');
            rules.push(
                `(rule "TSPCB ${escapedName} length"\n\t(condition "A.NetClass == '${escapedName}'")\n\t(constraint length ${values})\n)`,
            );
        }
        return rules;
    }

    private writePcbReport(
        outputDir: string,
        name: string,
        report: PcbSyncReport & { backupPath?: string },
    ): void {
        this.writeAtomic(
            path.join(outputDir, `${name}.pcb-sync.json`),
            `${JSON.stringify(report, null, 2)}\n`,
        );
    }
}
