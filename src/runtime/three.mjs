// Keep Three.js on its ESM entry point when this bridge is loaded by the CommonJS CLI.
// Browser bundling uses the same entry point and shares constructors with Three.js addons.
export * from 'three';
