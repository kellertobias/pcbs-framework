import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { KicadLibrary, type CircuitSnapshot } from '../../src/synth';
import { KicadGenerator } from '../../src/kicad/KicadGenerator';
import { renderModel } from '../../src/datasheet/ModelRenderer';
import { exportSchematicFrontPanel } from '../../src/frontpanel/SchematicFrontPanel';
import puppeteer from 'puppeteer-core';
import { prepareAssembly } from '../../src/assembly/prepare';
import { serveAssembly } from '../../src/assembly/server';
import assembly from '../../docs/examples/mechanical/assembly';
import { buildPcbPanel } from '../../src/cli/panel';
import grouped from '../../docs/examples/circuits/GroupedIndicator';
import divider from '../../docs/examples/circuits/Divider';
import {
    labelledCircuit,
    automaticCircuit,
    pagedCircuit,
} from '../../docs/examples/circuits/variants';
import { RepeatedIndicators, noPourBoard } from '../../docs/examples/boards/variants';
import { TeachingResistor } from '../../docs/examples/library/TeachingResistor';
import { throughHole, slottedPad } from '../../docs/examples/library/pad-variants';
import { solidPlate, cylinder, boredPlate } from '../../docs/examples/mechanical/model-steps';
import { frontPanels } from '../../docs/examples/mechanical/front-panel';
import fixture, { makeFixtureFootprint } from '../../docs/examples/mechanical/PanelFixture';
import { makeDatasheet } from '../../docs/examples/library/datasheet';
import { makeQuoteSheet } from '../../docs/examples/library/cost';

interface Context {
    root: string;
    work: string;
    assets: string;
    native: (args: string[]) => string;
    plotPng: (svg: string, output: string) => void;
}

export async function generateGallery({ root, work, assets, native, plotPng }: Context) {
    const directory = path.join(work, 'gallery');
    fs.mkdirSync(directory, { recursive: true });
    const validation: Record<string, unknown> = {};
    const png = (svg: string, name: string) =>
        plotPng(fs.readFileSync(svg, 'utf8'), path.join(assets, `${name}.png`));

    function schematic(snapshot: CircuitSnapshot, name: string) {
        const output = path.join(directory, name);
        const generated = new KicadGenerator().generate(snapshot, output, { pcbMode: 'preserve' });
        if (!generated.success || generated.errors.length)
            throw new Error(generated.errors.join('\n'));
        const netlist = path.join(output, 'native.xml');
        native([
            'sch',
            'export',
            'netlist',
            '--format',
            'kicadxml',
            '--output',
            netlist,
            path.join(output, `${snapshot.name}.kicad_sch`),
        ]);
        const nativePins = [
            ...fs.readFileSync(netlist, 'utf8').matchAll(/<net\b[^>]*>([\s\S]*?)<\/net>/g),
        ]
            .map((match) =>
                [...match[1].matchAll(/<node\s+ref="([^"]+)"\s+pin="([^"]+)"/g)]
                    .filter((node) => !node[1].startsWith('#'))
                    .map((node) => `${node[1]}.${node[2]}`)
                    .sort()
                    .join(','),
            )
            .filter(Boolean)
            .sort();
        const sourcePins = snapshot.nets
            .map((net) =>
                [
                    ...new Set(
                        net.pins
                            .filter((pin) =>
                                snapshot.components.some(
                                    (component) => component.ref === pin.component.ref,
                                ),
                            )
                            .map((pin) => `${pin.component.ref}.${pin.name}`),
                    ),
                ]
                    .sort()
                    .join(','),
            )
            .filter(Boolean)
            .sort();
        if (JSON.stringify(nativePins) !== JSON.stringify(sourcePins))
            throw new Error(
                `Native connectivity mismatch: ${name}\n${JSON.stringify({ nativePins, sourcePins })}`,
            );
        const svgDir = path.join(output, 'svg');
        native([
            'sch',
            'export',
            'svg',
            '--exclude-drawing-sheet',
            '--no-background-color',
            '--output',
            svgDir,
            path.join(output, `${snapshot.name}.kicad_sch`),
        ]);
        for (const file of fs
            .readdirSync(svgDir)
            .filter((file) => file.endsWith('.svg'))
            .sort()) {
            const suffix =
                file === `${snapshot.name}.svg`
                    ? ''
                    : `-${path.basename(file, '.svg').replace(`${snapshot.name}-`, '')}`;
            png(path.join(svgDir, file), `${name}${suffix}`);
        }
        validation[name] = { nativePinPartitions: nativePins.length, warnings: generated.warnings };
    }

    schematic(labelledCircuit(), 'schematic-labels');
    schematic(grouped._generateWithCapture(), 'schematic-groups');
    schematic(automaticCircuit(), 'schematic-grid');
    schematic(pagedCircuit(), 'schematic-pages');
    schematic(divider._generateWithCapture(), 'schematic-divider');

    function boardImage(board: string, name: string, plot = true) {
        const report = `${board}.drc.json`;
        native([
            'pcb',
            'drc',
            '--refill-zones',
            '--save-board',
            '--format',
            'json',
            '--output',
            report,
            board,
        ]);
        const drc = JSON.parse(fs.readFileSync(report, 'utf8'));
        const errors = drc.violations.filter((v: { severity: string }) => v.severity === 'error');
        if (errors.length || drc.unconnected_items.length)
            throw new Error(`DRC failed for ${name}: ${JSON.stringify(drc)}`);
        validation[name] = {
            errors: 0,
            unconnected: 0,
            warnings: drc.violations.filter((v: { severity: string }) => v.severity === 'warning')
                .length,
        };
        if (!plot) return;
        const svg = path.join(directory, `${name}.svg`);
        native([
            'pcb',
            'export',
            'svg',
            '--mode-single',
            '--exclude-drawing-sheet',
            '--page-size-mode',
            '2',
            '--layers',
            'F.Cu,F.SilkS,Edge.Cuts',
            '--output',
            svg,
            board,
        ]);
        png(svg, name);
    }
    for (const [name, snapshot] of [
        ['board-no-pour', noPourBoard()],
        [
            'board-composition',
            new RepeatedIndicators(path.join(work, 'Indicator.kicad_pcb'))._generateWithCapture(),
        ],
    ] as const) {
        const output = path.join(directory, name);
        const result = new KicadGenerator().generate(snapshot, output, {
            pcbMode: 'rebuild',
            autoRoute: true,
        });
        if (!result.success || result.errors.length) throw new Error(result.errors.join('\n'));
        boardImage(path.join(output, `${snapshot.name}.kicad_pcb`), name);
    }

    // Use a disposable project so native output never lands beside tracked example source.
    const projectDir = path.join(directory, 'project');
    fs.cpSync(path.join(root, 'docs/examples'), projectDir, { recursive: true });
    const sourceOutput = path.join(projectDir, 'coin-cell-led/export');
    fs.mkdirSync(sourceOutput, { recursive: true });
    for (const file of fs.readdirSync(work).filter((file) => file.startsWith('Indicator.')))
        fs.copyFileSync(path.join(work, file), path.join(sourceOutput, file));
    const panelEntry = path.join(projectDir, 'boards/Production.ts');
    const panel = require(panelEntry).default;
    const panelBoard = await buildPcbPanel(panel, panelEntry, false);
    boardImage(panelBoard, 'board-production');

    const library = path.join(directory, 'Documentation.pretty');
    for (const [name, footprint] of [
        ['footprint-through-hole', throughHole()],
        ['footprint-slot', slottedPad()],
    ] as const) {
        footprint.writeFile(library);
        const output = path.join(directory, name);
        fs.mkdirSync(output, { recursive: true });
        native(['fp', 'export', 'svg', '--footprint', footprint.name, '--output', output, library]);
        png(path.join(output, `${footprint.name}.svg`), name);
    }
    const symbolFile = new KicadLibrary()
        .addSymbol(TeachingResistor.makeSymbol())
        .writeSymbols(path.join(directory, 'Documentation.kicad_sym'));
    const symbolDir = path.join(directory, 'symbols');
    fs.mkdirSync(symbolDir, { recursive: true });
    native(['sym', 'export', 'svg', '--output', symbolDir, symbolFile]);
    png(path.join(symbolDir, 'TeachingResistor_unit1.svg'), 'symbol');

    for (const [name, factory] of [
        ['model-solid', solidPlate],
        ['model-cylinder', cylinder],
        ['model-bored', boredPlate],
    ] as const) {
        const model = await factory();
        const files = await model.export({
            outDir: path.join(directory, 'models'),
            baseName: name,
            formats: ['wrl', 'stl', '3mf'],
        });
        for (const file of [files.wrlPath, files.stlPath, files.threeMfPath])
            if (!file || !fs.statSync(file).size) throw new Error(`Missing model: ${name}`);
        fs.writeFileSync(
            path.join(assets, `${name}.png`),
            renderModel(fs.readFileSync(files.wrlPath!, 'utf8'), {
                view: 'isometric',
                width: 1200,
                height: 850,
                measurements: false,
            }).png,
        );
    }
    const fixtureDirectory = path.join(directory, 'front-panel');
    fs.mkdirSync(fixtureDirectory, { recursive: true });
    makeFixtureFootprint().writeFile(path.join(fixtureDirectory, 'Documentation.pretty'));
    fs.writeFileSync(
        path.join(fixtureDirectory, 'fp-lib-table'),
        KicadLibrary.generateFpLibTable('${KIPRJMOD}', 'Documentation'),
    );
    fs.writeFileSync(
        path.join(directory, 'fp-lib-table'),
        KicadLibrary.generateFpLibTable('${KIPRJMOD}', 'Documentation'),
    );
    const fixtureResult = new KicadGenerator().generate(
        fixture._generateWithCapture(),
        path.join(directory, 'front-panel'),
        { pcbMode: 'rebuild' },
    );
    if (!fixtureResult.success || fixtureResult.errors.length)
        throw new Error(fixtureResult.errors.join('\n'));
    boardImage(path.join(directory, 'front-panel/PanelFixture.kicad_pcb'), 'panel-fixture', false);
    const front = exportSchematicFrontPanel(fixture, frontPanels, 'indicator', {
        pcbFile: path.join(directory, 'front-panel/PanelFixture.kicad_pcb'),
        outputDir: path.join(directory, 'front-panel'),
    });
    png(front.svgFile, 'front-panel');
    await renderAssemblyGallery(root, directory, assets);
    await renderPdfGallery(directory, assets);
    return validation;
}

export async function renderAssemblyGallery(root: string, directory: string, assets: string) {
    const output = path.join(directory, 'assembly');
    await prepareAssembly(assembly, path.join(root, 'docs/examples/mechanical'), output);
    const { server, url } = await serveAssembly(
        output,
        0,
        undefined,
        path.join(root, 'dist/src/assembly/viewer-browser.js'),
    );
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
        const executable =
            process.env.PCB_ASSEMBLY_CHROME ??
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        browser = await puppeteer.launch({
            executablePath: executable,
            headless: true,
            args: ['--enable-webgl', '--enable-unsafe-swiftshader'],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
        for (const view of assembly.views) {
            await page.goto(`${url}?render=${encodeURIComponent(view.id)}`, {
                waitUntil: 'domcontentloaded',
            });
            await page.waitForFunction(
                () => document.body.dataset.renderReady || document.body.dataset.renderError,
                { timeout: 180_000 },
            );
            const error = await page.evaluate(() => document.body.dataset.renderError);
            if (error) throw new Error(error);
            await page.screenshot({ path: path.join(assets, `${view.id}.png`) });
            console.log(`Rendered assembly view: ${view.id}`);
        }
    } finally {
        await browser?.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

export async function renderPdfGallery(directory: string, assets: string) {
    for (const [name, factory, pages] of [
        ['datasheet', makeDatasheet, 3],
        ['cost', makeQuoteSheet, 1],
    ] as const) {
        const pdf = await factory(path.join(directory, `${name}.pdf`));
        const result = spawnSync(
            'pdftoppm',
            [
                '-f',
                '1',
                '-l',
                String(pages),
                '-scale-to',
                '1400',
                '-png',
                pdf,
                path.join(assets, name),
            ],
            { encoding: 'utf8', timeout: 30_000 },
        );
        if (result.status !== 0)
            throw new Error(`PDF preview failed: ${result.error?.message ?? result.stderr}`);
    }
}
