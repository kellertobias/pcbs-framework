import { outputPaths } from '../../project/OutputPaths';
import { resolveProjectEntryPath } from '../utils';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { Assembly } from '../../synth/Assembly';
import { prepareAssembly } from '../../assembly/prepare';
import { serveAssembly } from '../../assembly/server';

export async function cmdRenderAssembly(args: string[]): Promise<void> {
    if (!args[1])
        throw new Error(
            'Usage: renders assembly <assembly.ts> [--only view,view] [--output-dir directory] [--width 1600] [--height 1000]',
        );
    const option = (flag: string) => {
        const i = args.indexOf(flag);
        return i < 0 ? undefined : args[i + 1];
    };
    const file = resolveProjectEntryPath(args[1], 'assemblies');
    const exported = require(file);
    const assembly = exported.default ?? exported;
    if (!(assembly instanceof Assembly)) throw new Error('Entry must default-export an Assembly');
    const wanted = option('--only')?.split(',');
    if (wanted?.some((id) => !assembly.views.some((v) => v.id === id)))
        throw new Error('Unknown assembly view in --only');
    const views = assembly.views.filter((v) => !wanted || wanted.includes(v.id));
    if (!views.length) throw new Error('Assembly needs named views to render');
    const width = Number(option('--width') ?? 1600),
        height = Number(option('--height') ?? 1000);
    if (![width, height].every((v) => Number.isInteger(v) && v > 0 && v <= 8192))
        throw new Error('Render dimensions must be 1–8192 pixels');
    const executable =
        process.env.PCB_ASSEMBLY_CHROME ??
        [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/google-chrome',
            `${process.env.PROGRAMFILES}/Google/Chrome/Application/chrome.exe`,
        ].find((p) => fs.existsSync(p));
    if (!executable)
        throw new Error('Install Chrome/Chromium or set PCB_ASSEMBLY_CHROME to its executable');
    const output = path.resolve(option('--output-dir') ?? outputPaths(path.dirname(file)).renders);
    fs.mkdirSync(output, { recursive: true });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-assembly-render-'));
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    let server: Awaited<ReturnType<typeof serveAssembly>>['server'] | undefined;
    try {
        await prepareAssembly(assembly, path.dirname(file), directory);
        const served = await serveAssembly(directory);
        server = served.server;
        browser = await puppeteer.launch({
            executablePath: executable,
            headless: true,
            args: ['--enable-webgl', '--enable-unsafe-swiftshader'],
        });
        const page = await browser.newPage();
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        for (const view of views) {
            await page.goto(`${served.url}?render=${encodeURIComponent(view.id)}`, {
                waitUntil: 'domcontentloaded',
            });
            await page.waitForFunction(
                () => document.body.dataset.renderReady || document.body.dataset.renderError,
                { timeout: 180000 },
            );
            const error = await page.evaluate(() => document.body.dataset.renderError);
            if (error) throw new Error(error);
            await page.screenshot({ path: path.join(output, `${view.id}.png`) });
            console.log(`Rendered ${view.id}: ${path.join(output, `${view.id}.png`)}`);
        }
    } finally {
        await browser?.close();
        if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
