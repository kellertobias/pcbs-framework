/**
 * Singleton OpenCascade WASM loader.
 *
 * Caches the OC instance after first init to avoid re-loading the WASM binary.
 * Safe for repeated calls from tests and CLI.
 */
import { initOpenCascade } from "./occ-loader";

type OpenCascadeInstance = any;

let _oc: OpenCascadeInstance | null = null;
let _initPromise: Promise<OpenCascadeInstance> | null = null;

export async function initOCC(): Promise<OpenCascadeInstance> {
    if (_oc) return _oc;
    if (_initPromise) return _initPromise;

    // Use our custom loader that avoids problematic 'import' of WASM files
    _initPromise = initOpenCascade({
        libs: [
            "opencascade.core.wasm",
            "opencascade.modelingAlgorithms.wasm",
            "opencascade.dataExchangeBase.wasm"
        ]
    }).then(oc => {
        _oc = oc;
        return oc;
    });

    return _initPromise!;
}
