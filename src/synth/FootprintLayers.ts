import definitions from './FootprintLayers.json';
/** Shared with scripts/export-pcb-dxf.py: semantic names, KiCad storage IDs and UI aliases. */
export const FootprintLayers = definitions;
export type SemanticFootprintLayer = keyof typeof definitions;
export function canonicalFootprintLayer(layer: string): string {
    for (const [name, definition] of Object.entries(definitions)) {
        if (name === layer || definition.layer === layer || definition.aliases.includes(layer))
            return definition.layer;
    }
    return layer;
}
