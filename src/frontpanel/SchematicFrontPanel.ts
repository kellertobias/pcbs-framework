import type { Schematic } from '../synth/Schematic';
import { exportVerticalFrontPanel } from './FrontPanelExporter';
import type {
    FrontPanelDefinition,
    FrontPanels,
    SchematicFrontPanelExportOptions,
    SchematicFrontPanelExportResult,
} from './types';

/** Type-check a named panel returned by a schematic's frontPanels callback. */
export function defineFrontPanel(definition: FrontPanelDefinition): FrontPanelDefinition {
    return definition;
}

/** Generate a named schematic panel using current saved PCB placement, without writing the PCB. */
export function exportSchematicFrontPanel<T extends Schematic>(
    schematic: T,
    frontPanels: FrontPanels<T>,
    name: string,
    options: SchematicFrontPanelExportOptions,
): SchematicFrontPanelExportResult {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name))
        throw new Error('Panel names must contain only letters, numbers, underscores, or hyphens');
    if (!Object.hasOwnProperty.call(frontPanels, name) || typeof frontPanels[name] !== 'function')
        throw new Error(
            `Unknown front panel '${name}'. Available panels: ${Object.keys(frontPanels).join(', ') || 'none'}`,
        );
    const snapshot = schematic._generateWithCapture();
    const definition = frontPanels[name](schematic);
    if (!definition || !definition.extends || !Array.isArray(definition.components))
        throw new Error(`${name}: return a front-panel definition with components and extends`);
    const validateStyle = (style?: import('./types').FrontPanelTextStyle) => {
        if (style?.bold !== undefined && typeof style.bold !== 'boolean')
            throw new Error('Text bold must be a boolean');
    };
    validateStyle(definition.textStyle);
    if (definition.nameHeight !== undefined && !Number.isFinite(definition.nameHeight))
        throw new Error('Name height must be finite');
    const captured = new Set(snapshot.components);
    const selections = new Map<
        string,
        {
            footprint: string;
            face?: import('./types').FrontPanelInterface;
            name?: string;
            placement: 'above' | 'below';
            nameStyle?: import('./types').FrontPanelTextStyle;
        }
    >();
    for (const selection of definition.components) {
        const component = selection?.component;
        if (!component || !captured.has(component))
            throw new Error(`${name}: select component instances from the supplied schematic`);
        if (selections.has(component.ref))
            throw new Error(`${name}: duplicate component '${component.ref}'`);
        validateStyle(selection.nameStyle);
        const placement = selection.namePlacement ?? 'above';
        if (placement !== 'above' && placement !== 'below')
            throw new Error(`${component.ref}: namePlacement must be above or below`);
        const text = selection.name ?? component.frontPanelLabel;
        if (text !== undefined && (typeof text !== 'string' || /[\r\n]/.test(text)))
            throw new Error(`${component.ref}: name must be single-line text`);
        selections.set(component.ref, {
            footprint: component.footprint,
            face: component.frontPanelInterface,
            name: text,
            placement,
            nameStyle: selection.nameStyle,
        });
    }
    const validateDrawings = (items: readonly import('./types').FrontPanelDrawing[]) => {
        for (const d of items)
            if (d.type === 'group') {
                if (
                    d.anchor &&
                    (!captured.has(d.anchor.component) || !selections.has(d.anchor.component.ref))
                )
                    throw new Error(
                        'Artwork anchors must reference selected components from this schematic',
                    );
                validateDrawings(d.drawings);
            }
    };
    validateDrawings(definition.drawings ?? []);
    const result = exportVerticalFrontPanel(
        options.pcbFile,
        {
            edge: definition.edge,
            components: [...selections.keys()],
            height: definition.extends.top + definition.extends.bottom,
            outputDir: options.outputDir,
        },
        {
            name,
            extends: definition.extends,
            selections,
            drawings: definition.drawings,
            nameHeight: definition.nameHeight,
            textStyle: definition.textStyle,
        },
    );
    return { ...result, name };
}
