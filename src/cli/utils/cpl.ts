import { positionRows } from './position-rows';
import { panelRotation } from './export-components';
import * as fs from 'fs';
import * as path from 'path';
import { Component } from '../../synth/Component';
import { loadOverrides, resolveOverride } from './overrides';

/**
 * Convert KiCad's Pick & Place (pos) ASCII output to JLCPCB CPL format.
 *
 * KiCad pos (ASCII, mm, both sides) output has the following columns:
 *   Ref  Val  Package  PosX  PosY  Rot  Side
 *
 * JLCPCB CPL expects:
 *   Designator  Val  Package  Mid X  Mid Y  Rotation  Layer
 */
export function convertPosToCpl(
    posFilePath: string,
    cplOutputPath: string,
    components: Component<any>[],
    projectRoot: string,
    projectDirectory?: string,
): string {
    const content = fs.readFileSync(posFilePath, 'utf-8');

    const common = loadOverrides(projectRoot);
    const local = projectDirectory ? loadOverrides(projectDirectory) : {};
    const overrides = { placement: { ...common.placement, ...local.placement } };
    const componentMap = new Map<string, Component<any>>();

    // Index components by Reference for fast lookup
    for (const comp of components) {
        componentMap.set(comp.ref, comp);
    }

    const csvLines: string[] = [];
    // JLCPCB CPL header
    csvLines.push('Designator,Val,Package,Mid X,Mid Y,Rotation,Layer');

    for (const [ref, val, pkg, posXStr, posYStr, rotStr, side] of positionRows(content)) {
        // Parse numbers
        let posX = parseFloat(posXStr);
        let posY = parseFloat(posYStr);
        let rot = parseFloat(rotStr);
        if (
            ![posX, posY, rot].every(Number.isFinite) ||
            !['top', 'bottom'].includes(side.toLowerCase())
        )
            throw new Error(`Invalid placement coordinates or side: ${ref}`);

        // Apply overrides if component exists
        const comp = componentMap.get(ref);
        if (comp) {
            const override = resolveOverride(comp, overrides);
            if (override) {
                // Native position Y is up. Rotate source-frame correction offsets into panel space.
                const angle = (panelRotation(comp) * Math.PI) / 180;
                posX += (override.x ?? 0) * Math.cos(angle) - (override.y ?? 0) * Math.sin(angle);
                posY += (override.x ?? 0) * Math.sin(angle) + (override.y ?? 0) * Math.cos(angle);
                if (override.r !== undefined) rot += override.r;

                // Normalize rotation to 0-360 range
                rot = ((rot % 360) + 360) % 360;
            }
        }

        // Map side: KiCad uses "top"/"bottom", JLCPCB uses "Top"/"Bottom"
        const layer =
            side.toLowerCase() === 'top'
                ? 'Top'
                : side.toLowerCase() === 'bottom'
                  ? 'Bottom'
                  : side;

        // Format position with mm suffix (JLCPCB expects this)
        const midX = `${posX.toFixed(4)}mm`;
        const midY = `${posY.toFixed(4)}mm`;
        const rotation = rot.toFixed(4);

        // CSV escape helper
        const esc = (s: string) =>
            s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;

        csvLines.push(`${esc(ref)},${esc(val)},${esc(pkg)},${midX},${midY},${rotation},${layer}`);
    }

    fs.writeFileSync(cplOutputPath, csvLines.join('\n'), 'utf-8');
    return cplOutputPath;
}
