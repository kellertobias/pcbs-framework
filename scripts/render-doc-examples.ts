import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import { zipSync } from 'fflate';
import indicator from '../docs/examples/coin-cell-led/Indicator';
import { makeFootprint } from '../docs/examples/library/footprint';
import { makeModel } from '../docs/examples/library/model';
import { KicadGenerator } from '../src/kicad/KicadGenerator';
import { cmdRenderSeries } from '../src/cli/commands/render-series';
import { renderModel } from '../src/datasheet/ModelRenderer';

const root = path.resolve(__dirname, '..');
const work = path.join(root, '.cache/docs-examples');
const assets = path.join(root, 'docs/public/examples');
const cli =
    process.env.KICAD_CLI ??
    (fs.existsSync('/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli')
        ? '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli'
        : 'kicad-cli');

function native(args: string[]) {
    const result = spawnSync(cli, args, {
        encoding: 'utf8',
        timeout: 180_000,
        maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
        throw new Error(
            `KiCad ${args.slice(0, 3).join(' ')} failed: ${result.error?.message ?? result.stderr}`,
        );
    }
    return result.stdout.trim();
}

/** Crop only the exported SVG page margins; every drawn element is retained. */
function plotPng(svg: string, output: string) {
    const drawing = new Resvg(svg);
    const bounds = drawing.getBBox();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) throw new Error('Empty native SVG');
    const margin = Math.max(bounds.width, bounds.height) * 0.05;
    bounds.x -= margin;
    bounds.y -= margin;
    bounds.width += 2 * margin;
    bounds.height += 2 * margin;
    drawing.cropByBBox(bounds);
    fs.writeFileSync(
        output,
        new Resvg(drawing.toString(), {
            fitTo: { mode: 'width', value: 1400 },
            background: 'white',
        })
            .render()
            .asPng(),
    );
}

function archiveFiles(directory: string, prefix = ''): Record<string, Uint8Array> {
    const result: Record<string, Uint8Array> = {};
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        const name = `${prefix}${entry.name}`;
        if (entry.isDirectory()) Object.assign(result, archiveFiles(file, `${name}/`));
        else if (!entry.name.endsWith('.lck')) result[name] = fs.readFileSync(file);
    }
    return result;
}

async function main() {
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    fs.mkdirSync(assets, { recursive: true });
    process.env.KICAD_CLI = cli;
    const snapshot = indicator._generateWithCapture();
    const generated = new KicadGenerator().generate(snapshot, work, {
        pcbMode: 'rebuild',
        autoRoute: true,
    });
    if (!generated.success || generated.errors.length) throw new Error(generated.errors.join('\n'));
    const nativeNetlist = path.join(work, 'Indicator-native.xml');
    native([
        'sch',
        'export',
        'netlist',
        '--format',
        'kicadxml',
        '--output',
        nativeNetlist,
        path.join(work, 'Indicator.kicad_sch'),
    ]);
    const nativePins = [
        ...fs.readFileSync(nativeNetlist, 'utf8').matchAll(/<net\b[^>]*>([\s\S]*?)<\/net>/g),
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
            [...new Set(net.pins.map((pin) => `${pin.component.ref}.${pin.name}`))]
                .sort()
                .join(','),
        )
        .sort();
    if (JSON.stringify(nativePins) !== JSON.stringify(sourcePins)) {
        throw new Error(
            `Native schematic connectivity differs from source: ${JSON.stringify({ nativePins, sourcePins })}`,
        );
    }
    const board = path.join(work, 'Indicator.kicad_pcb');
    const report = path.join(work, 'Indicator-drc.json');
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
        throw new Error(`Example failed filled-zone DRC: ${JSON.stringify(drc)}`);

    const svgDirectory = path.join(work, 'native-svg');
    fs.mkdirSync(svgDirectory, { recursive: true });
    native([
        'sch',
        'export',
        'svg',
        '--exclude-drawing-sheet',
        '--no-background-color',
        '--output',
        svgDirectory,
        path.join(work, 'Indicator.kicad_sch'),
    ]);
    const schematicSvg = path.join(svgDirectory, 'Indicator.svg');
    plotPng(fs.readFileSync(schematicSvg, 'utf8'), path.join(assets, 'indicator-schematic.png'));
    await cmdRenderSeries([path.join(root, 'docs/examples/coin-cell-led/renders.ts')]);
    // Tight framing keeps board plots legible beside source code on a documentation page.
    for (const side of ['front', 'back'] as const) {
        const svg = path.join(svgDirectory, `${side}.svg`);
        const prefix = side === 'front' ? 'F' : 'B';
        native([
            'pcb',
            'export',
            'svg',
            '--mode-single',
            '--exclude-drawing-sheet',
            '--page-size-mode',
            '2',
            '--layers',
            `${prefix}.Cu,${prefix}.SilkS,Edge.Cuts`,
            ...(side === 'back' ? ['--mirror'] : []),
            '--output',
            svg,
            board,
        ]);
        plotPng(fs.readFileSync(svg, 'utf8'), path.join(assets, `indicator-${side}.png`));
    }

    const library = path.join(work, 'Documentation.pretty');
    makeFootprint().writeFile(library);
    native([
        'fp',
        'export',
        'svg',
        '--footprint',
        'TeachingPads',
        '--output',
        svgDirectory,
        library,
    ]);
    const footprintSvg = path.join(svgDirectory, 'TeachingPads.svg');
    plotPng(fs.readFileSync(footprintSvg, 'utf8'), path.join(assets, 'footprint.png'));
    const model = await makeModel();
    const exported = await model.export({
        outDir: path.join(work, 'models'),
        baseName: 'MountingPlate',
        formats: ['wrl', 'stl', '3mf'],
    });
    for (const file of [exported.wrlPath, exported.stlPath, exported.threeMfPath]) {
        if (!file || !fs.existsSync(file) || fs.statSync(file).size === 0) {
            throw new Error('A required example model export is missing.');
        }
    }
    const wrl = fs.readFileSync(exported.wrlPath!, 'utf8');
    for (const view of ['isometric', 'top'] as const) {
        fs.writeFileSync(
            path.join(assets, `model-${view}.png`),
            renderModel(wrl, {
                view,
                width: 1200,
                height: 850,
                title: view === 'isometric' ? 'Mounting plate' : '',
                measurements: false,
            }).png,
        );
    }

    const sources = archiveFiles(path.join(root, 'docs/examples'), 'source/');
    const downloads: Record<string, Uint8Array> = { ...sources };
    for (const name of [
        'Indicator.kicad_pcb',
        'Indicator.kicad_sch',
        'Indicator.kicad_pro',
        'Indicator.kicad_dru',
        'Indicator.net',
        'Indicator-native.xml',
        'Indicator-drc.json',
        'uuids.json',
    ]) {
        downloads[`kicad/${name}`] = fs.readFileSync(path.join(work, name));
    }
    Object.assign(
        downloads,
        archiveFiles(library, 'kicad/Documentation.pretty/'),
        archiveFiles(path.join(work, 'models'), 'models/'),
    );
    fs.writeFileSync(path.join(assets, 'examples.zip'), zipSync(downloads));
    const images = fs
        .readdirSync(assets)
        .filter((name) => name.endsWith('.png'))
        .sort();
    fs.writeFileSync(
        path.join(assets, 'manifest.json'),
        `${JSON.stringify(
            {
                kicad: native(['version']),
                framework: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
                    .version,
                sourceHash: exampleSourceHash(),
                images: Object.fromEntries(
                    images.map((name) => [name, hash(fs.readFileSync(path.join(assets, name)))]),
                ),
                archiveHash: hash(fs.readFileSync(path.join(assets, 'examples.zip'))),
                drc: {
                    errors: errors.length,
                    unconnected: drc.unconnected_items.length,
                    warnings: drc.violations.filter(
                        (v: { severity: string }) => v.severity === 'warning',
                    ).length,
                },
                generationWarnings: generated.warnings,
                nativeSchematicConnectivity: 'Pin partitions match the TypeScript source.',
            },
            null,
            2,
        )}\n`,
    );
    console.log(
        `Generated ${images.length} documentation images and examples.zip. Filled-zone DRC passed.`,
    );
}

function hash(content: Uint8Array | string) {
    return createHash('sha256').update(content).digest('hex');
}

function exampleSourceHash() {
    const digest = createHash('sha256');
    const sources = archiveFiles(path.join(root, 'docs/examples'), 'source/');
    sources['scripts/render-doc-examples.ts'] = fs.readFileSync(__filename);
    for (const [name, content] of Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)))
        digest.update(name).update(content);
    return digest.digest('hex');
}

async function run() {
    if (!process.argv.includes('--check')) return main();
    const manifest = JSON.parse(fs.readFileSync(path.join(assets, 'manifest.json'), 'utf8'));
    if (manifest.sourceHash !== exampleSourceHash())
        throw new Error('Example source changed. Run npm run docs:examples and review its images.');
    for (const [name, expected] of Object.entries(manifest.images)) {
        if (hash(fs.readFileSync(path.join(assets, name))) !== expected)
            throw new Error(`Example image changed: ${name}`);
    }
    if (hash(fs.readFileSync(path.join(assets, 'examples.zip'))) !== manifest.archiveHash)
        throw new Error('Example download changed. Regenerate the assets.');
    console.log('Example source, screenshots and download match the generation manifest.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
