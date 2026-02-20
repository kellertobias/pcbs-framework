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

/**
 * Arranges items using a force-directed (gravity) layout based on their net connections.
 */
export class GravityLayout extends Layout {
    constructor(private options: { spacing?: number; iterations?: number; x?: number; y?: number } = {}) {
        super();
    }

    apply(items: LayoutItem[]): void {
        const numItems = items.length;
        if (numItems === 0) return;

        const iterations = this.options.iterations ?? 100;
        const spacing = this.options.spacing ?? 500; // Optimal distance

        // Initialize positions with some pseudo-random jitter
        const positions = new Map<LayoutItem, { x: number; y: number; dx: number; dy: number }>();
        items.forEach((item, i) => {
            const currentX = item.schematicPosition?.x ?? 0;
            const currentY = item.schematicPosition?.y ?? 0;
            positions.set(item, {
                x: currentX + (i % 5) * 10 - 20,
                y: currentY + (i % 7) * 10 - 30,
                dx: 0,
                dy: 0
            });
        });

        // Determine edges (connections via shared nets)
        const netToItems = new Map<string, Set<LayoutItem>>();
        items.forEach(item => {
            const allPins = (item as any).allPins;
            if (allPins instanceof Map) {
                allPins.forEach((pin: any) => {
                    if (pin && pin.net && typeof pin.net.name === 'string') {
                        let itemsOnNet = netToItems.get(pin.net.name);
                        if (!itemsOnNet) {
                            itemsOnNet = new Set();
                            netToItems.set(pin.net.name, itemsOnNet);
                        }
                        itemsOnNet.add(item);
                    }
                });
            }
        });

        // Edges: Set of connected item pairs
        const edges: [LayoutItem, LayoutItem][] = [];
        const seenPairs = new Set<string>();

        netToItems.forEach((connectedItems) => {
            const arr = Array.from(connectedItems);
            for (let i = 0; i < arr.length; i++) {
                for (let j = i + 1; j < arr.length; j++) {
                    const u = arr[i];
                    const v = arr[j];
                    const pairId = u.ref < v.ref ? `${u.ref}-${v.ref}` : `${v.ref}-${u.ref}`;
                    if (!seenPairs.has(pairId)) {
                        seenPairs.add(pairId);
                        edges.push([u, v]);
                    }
                }
            }
        });

        // Fruchterman-Reingold algorithm
        const k = spacing;
        const k2 = k * k;
        let t = spacing * 10; // Initial temperature
        const dt = t / (iterations + 1);

        const repulse = (d: number) => k2 / Math.max(d, 0.01);
        const attract = (d: number) => (d * d) / k;

        for (let iter = 0; iter < iterations; iter++) {
            // Reset displacements
            positions.forEach(pos => { pos.dx = 0; pos.dy = 0; });

            // Calculate repulsive forces
            for (let i = 0; i < items.length; i++) {
                const u = items[i];
                const posU = positions.get(u)!;
                for (let j = i + 1; j < items.length; j++) {
                    const v = items[j];
                    const posV = positions.get(v)!;

                    const dx = posU.x - posV.x;
                    const dy = posU.y - posV.y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;

                    const f = repulse(dist);
                    const fx = (dx / dist) * f;
                    const fy = (dy / dist) * f;

                    posU.dx += fx;
                    posU.dy += fy;
                    posV.dx -= fx;
                    posV.dy -= fy;
                }
            }

            // Calculate attractive forces
            edges.forEach(([u, v]) => {
                const posU = positions.get(u)!;
                const posV = positions.get(v)!;

                const dx = posU.x - posV.x;
                const dy = posU.y - posV.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;

                const f = attract(dist);
                const fx = (dx / dist) * f;
                const fy = (dy / dist) * f;

                posU.dx -= fx;
                posU.dy -= fy;
                posV.dx += fx;
                posV.dy += fy;
            });

            // Apply displacements
            positions.forEach(pos => {
                const dist = Math.sqrt(pos.dx * pos.dx + pos.dy * pos.dy) || 0.01;
                const moveDist = Math.min(dist, t);
                pos.x += (pos.dx / dist) * moveDist;
                pos.y += (pos.dy / dist) * moveDist;
            });

            t -= dt;
        }

        // Center the layout
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        positions.forEach(pos => {
            if (pos.x < minX) minX = pos.x;
            if (pos.y < minY) minY = pos.y;
            if (pos.x > maxX) maxX = pos.x;
            if (pos.y > maxY) maxY = pos.y;
        });

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        const targetX = this.options.x ?? 0;
        const targetY = this.options.y ?? 0;

        const offsetX = targetX - centerX;
        const offsetY = targetY - centerY;

        for (const item of items) {
            const pos = positions.get(item)!;
            (item as any).schematicPosition = {
                x: Math.round(pos.x + offsetX),
                y: Math.round(pos.y + offsetY),
                rotation: item.schematicPosition?.rotation ?? 0
            }; // Added semi-colon
        }
    }
}
