import { ILayout, LayoutItem } from "./types";

/**
 * Base class for all layouts.
 * 
 * Layouts are used to programmatically arrange components and composables.
 */
export abstract class Layout implements ILayout {
    /**
     * Apply the layout to a list of items.
     * This method directly modifies the `schematicPosition` of each item.
     */
    abstract apply(items: LayoutItem[]): void;
}

/**
 * Arranges items horizontally.
 */
export class HBoxLayout extends Layout {
    constructor(private options: { spacing?: number; x?: number; y?: number } = {}) {
        super();
    }

    apply(items: LayoutItem[]): void {
        const spacing = this.options.spacing ?? 50; // Default spacing in mils/units
        let currentX = this.options.x ?? 0;
        const currentY = this.options.y ?? 0;

        for (const item of items) {
            (item as any).schematicPosition = {
                x: currentX,
                y: currentY,
                rotation: item.schematicPosition?.rotation ?? 0
            };
            currentX += spacing;
        }
    }
}

/**
 * Arranges items vertically.
 */
export class VBoxLayout extends Layout {
    constructor(private options: { spacing?: number; x?: number; y?: number } = {}) {
        super();
    }

    apply(items: LayoutItem[]): void {
        const spacing = this.options.spacing ?? 50;
        const currentX = this.options.x ?? 0;
        let currentY = this.options.y ?? 0;

        for (const item of items) {
            (item as any).schematicPosition = {
                x: currentX,
                y: currentY,
                rotation: item.schematicPosition?.rotation ?? 0
            };
            currentY += spacing;
        }
    }
}
