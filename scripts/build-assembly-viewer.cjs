const path = require('node:path');
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
