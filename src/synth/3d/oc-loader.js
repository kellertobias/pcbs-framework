
/**
 * A local version of initOpenCascade that doesn't use ESM WASM imports.
 */
export const initOpenCascade = async ({
  module = {},
  libs = [],
} = {}) => {
  // Load the main JS (glue code) via dynamic import.
  // This file contains the Emscripten module but NO .wasm imports.
  const mod = await import('opencascade.js/dist/opencascade.js');
  const ocMainJS = mod.default || mod;

  return new Promise((resolve, reject) => {
    new ocMainJS({
      ...module
    }).then(async (oc) => {
      for (let lib of libs) {
        await oc.loadDynamicLibrary(lib, {
          loadAsync: true,
          global: true,
          nodelete: true,
          allowUndefined: false
        });
      }
      resolve(oc);
    }).catch(reject);
  });
};
