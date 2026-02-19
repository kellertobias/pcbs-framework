
import fs from 'fs';
import { dirname } from 'path';

/**
 * Custom OpenCascade initializer that avoids using 'import' for WASM files,
 * which causes issues in Node.js ESM/Vitest environment.
 */
export const initOpenCascade = async (options: any = {}) => {
    const { module = {}, libs = [] } = options;

    // Standard CommonJS doesn't need createRequire, but we keep the logic
    // for compatibility with how it was originally structured.
    // In Node.js CJS, require, __filename, and __dirname are already available.

    console.log('[occ-loader] Setting up polyfills...');
    // @ts-ignore
    globalThis.__dirname = __dirname;
    // @ts-ignore
    globalThis.__filename = __filename;
    // @ts-ignore
    globalThis.require = require;

    console.log('[occ-loader] Importing opencascade.js glue code via string-eval...');
    const ocMainJSPath = require.resolve('opencascade.js/dist/opencascade.js');
    const ocMainJSCode = fs.readFileSync(ocMainJSPath, 'utf8');

    // The opencascade.js glue code is an IIFE followed by "export default Module;"
    // We strip the export and eval the rest to get the Module constructor.
    const patchedCode = ocMainJSCode.replace('export default Module;', 'Module');
    const ocMainJS = eval(patchedCode);

    console.log('[occ-loader] Reading main WASM binary...');
    const wasmPath = require.resolve('opencascade.js/dist/opencascade.wasm');
    const wasmBinary = fs.readFileSync(wasmPath);

    console.log('[occ-loader] Instantiating OpenCascade module...');
    return new Promise((resolve, reject) => {
        try {
            const ocModule = new (ocMainJS as any)({
                wasmBinary: wasmBinary,
                locateFile: (path: string) => {
                    // This is still used by internally by ocMainJS if it needs other files
                    const resolved = require.resolve('opencascade.js/dist/' + path);
                    console.log(`[occ-loader] locateFile: ${path} -> ${resolved}`);
                    return resolved;
                },
                ...module
            });

            ocModule.then(async (oc: any) => {
                console.log('[occ-loader] OpenCascade core initialized. Loading libraries...');
                for (const lib of libs) {
                    const libPath = typeof lib === 'string' && !lib.includes('/')
                        ? require.resolve('opencascade.js/dist/' + lib)
                        : lib;
                    console.log(`[occ-loader] Loading dynamic library: ${libPath}`);

                    // Force loadAsync: false to use readFileSync (ENVIRONMENT_IS_NODE logic)
                    // instead of fetch (which fails on absolute paths).
                    oc.loadDynamicLibrary(libPath, {
                        loadAsync: false,
                        global: true,
                        nodelete: true,
                        allowUndefined: false
                    });
                }
                console.log('[occ-loader] All libraries loaded.');
                resolve(oc);
            }).catch((e: any) => {
                console.error('[occ-loader] Failed to initialize ocModule:', e);
                reject(e);
            });
        } catch (e) {
            console.error('[occ-loader] Synchronous error during instantiation:', e);
            reject(e);
        }
    });
};
