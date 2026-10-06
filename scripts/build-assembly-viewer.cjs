const path = require('node:path');
const fs = require('node:fs');
const runtime = path.resolve(__dirname, '../dist/src/runtime');
fs.mkdirSync(runtime, { recursive: true });
for (const file of ['three.mjs', 'three.d.mts']) {
    fs.copyFileSync(path.resolve(__dirname, '../src/runtime', file), path.join(runtime, file));
}
const { build } = require('esbuild');
build({
    entryPoints: [path.resolve(__dirname, '../src/assembly/viewer.ts')],
    outfile: path.resolve(__dirname, '../dist/src/assembly/viewer-browser.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    minify: true,
}).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
