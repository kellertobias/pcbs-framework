/**
 * Singleton OpenCascade WASM loader.
 *
 * Caches the OC instance after first init to avoid re-loading the WASM binary.
 * Safe for repeated calls from tests and CLI.
 */
import type { OpenCascadeInstance } from "opencascade.js/dist/node";

let _oc: OpenCascadeInstance | null = null;
let _initPromise: Promise<OpenCascadeInstance> | null = null;

/**
 * Dynamic import that works in both ESM (vitest) and CJS (ts-node) contexts.
 *
 * 1. First tries normal `import()` — works natively in vitest, Node ESM, etc.
 * 2. If that fails because ts-node transpiled `import()` → `require()` and
 *    the target is ESM-only, falls back to `new Function("s","return import(s)")`
 *    which prevents the transpiler from rewriting it.
 */
async function esmImport(specifier: string): Promise<any> {
    try {
        return await import(specifier);
    } catch (err: any) {
        if (
            err?.code === "ERR_REQUIRE_ESM" ||
            err?.message?.includes("require() of ES Module")
        ) {
            // ts-node transpiled import() to require(). Use new Function to
            // get a real ESM import. ESM requires full file extensions.
            const esmSpecifier = specifier.endsWith(".js") ? specifier : specifier + ".js";
            const dynamicImport = new Function("s", "return import(s)") as
                (s: string) => Promise<any>;
            return dynamicImport(esmSpecifier);
        }
        // If the error is MODULE_NOT_FOUND, retry with .js extension
        if (err?.code === "MODULE_NOT_FOUND" || err?.code === "ERR_MODULE_NOT_FOUND") {
            const esmSpecifier = specifier.endsWith(".js") ? specifier : specifier + ".js";
            try {
                return await import(esmSpecifier);
            } catch {
                throw err; // throw original
            }
        }
        throw err;
    }
}

/**
 * Initialize OpenCascade WASM and return the instance.
 * The first call loads the WASM (~2-3 s); subsequent calls return the cached instance.
 */
export async function initOCC(): Promise<OpenCascadeInstance> {
    if (_oc) return _oc;
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
        const mod = await esmImport("opencascade.js/dist/node");
        const initOpenCascade = mod.default;
        _oc = await initOpenCascade();
        return _oc!;
    })();

    return _initPromise!;
}
