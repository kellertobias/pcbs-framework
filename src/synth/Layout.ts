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

    apply(allItems: LayoutItem[]): void {
        const items = allItems.filter(i => i.schematicPosition !== null);
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

    apply(allItems: LayoutItem[]): void {
        const items = allItems.filter(i => i.schematicPosition !== null);
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

        const iterations = this.options.iterations ?? 1000; // Increased iterations for stability
        const spacing = this.options.spacing ?? 100; // Optimal distance

        // Find center of pinned items to use as gravity well
        let pinSumX = 0, pinSumY = 0, pinCount = 0;
        items.forEach(item => {
            if (item.schematicPosition?.x !== undefined && item.schematicPosition?.y !== undefined) {
                pinSumX += item.schematicPosition.x;
                pinSumY += item.schematicPosition.y;
                pinCount++;
            }
        });
        const gravityOriginX = pinCount > 0 ? Math.round(pinSumX / pinCount) : (this.options.x ?? 0);
        const gravityOriginY = pinCount > 0 ? Math.round(pinSumY / pinCount) : (this.options.y ?? 0);

        // Initialize positions
        const positions = new Map<LayoutItem, { x: number; y: number; dx: number; dy: number; pinned: boolean }>();
        items.forEach((item, i) => {
            // Check if position is explicitly set (not null/undefined)
            const hasPos = item.schematicPosition && typeof item.schematicPosition.x === 'number' && typeof item.schematicPosition.y === 'number';

            const currentX = hasPos ? item.schematicPosition!.x : gravityOriginX;
            const currentY = hasPos ? item.schematicPosition!.y : gravityOriginY;

            positions.set(item, {
                x: hasPos ? currentX : currentX + (Math.random() - 0.5) * spacing,
                y: hasPos ? currentY : currentY + (Math.random() - 0.5) * spacing,
                dx: 0,
                dy: 0,
                pinned: !!hasPos
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

        // Group Logic: Collect items by group
        const groupMap = new Map<string, LayoutItem[]>();
        items.forEach(item => {
            const g = (item as any).group;
            if (g) {
                if (!groupMap.has(g)) groupMap.set(g, []);
                groupMap.get(g)!.push(item);
            }
        });

        // Fruchterman-Reingold algorithm
        const k = spacing;
        const k2 = k * k;
        let t = spacing * 10; // Initial temperature
        const dt = t / (iterations + 1);

        const repulse = (d: number) => {
            // Enhanced repulsion to avoid overlap
            // If d is very small (potential overlap), force should be massive
            const minSpace = 100; // Minimum safe distance between centers (approx component size + padding)
            if (d < minSpace) {
                return k2 * 10 / Math.max(d, 0.1); // Stronger repulsion at close range
            }
            return k2 / Math.max(d, 0.01);
        };
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

                    if (posU.pinned && posV.pinned) continue;

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

            // Calculate attractive forces (edges)
            edges.forEach(([u, v]) => {
                const posU = positions.get(u)!;
                const posV = positions.get(v)!;

                if (posU.pinned && posV.pinned) return;

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

            // Group Attraction
            groupMap.forEach(groupItems => {
                // Attract every item in group to every other item in group
                // Or better: attract to group centroid
                let gx = 0, gy = 0;
                groupItems.forEach(item => {
                    const pos = positions.get(item)!;
                    gx += pos.x;
                    gy += pos.y;
                });
                gx /= groupItems.length;
                gy /= groupItems.length;

                groupItems.forEach(item => {
                    const pos = positions.get(item)!;
                    if (pos.pinned) return;

                    const dx = pos.x - gx;
                    const dy = pos.y - gy;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;

                    // Pull towards centroid
                    const f = dist / 2; // Linear pull
                    const fx = (dx / dist) * f;
                    const fy = (dy / dist) * f;

                    pos.dx -= fx;
                    pos.dy -= fy;
                });
            });

            // Calculate central gravity to prevent unconnected items from flying away
            positions.forEach(pos => {
                if (pos.pinned) return;
                const dx = pos.x - gravityOriginX;
                const dy = pos.y - gravityOriginY;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;

                // A weak constant pull toward the center
                const f = dist / 10;
                const fx = (dx / dist) * f;
                const fy = (dy / dist) * f;

                pos.dx -= fx;
                pos.dy -= fy;
            });

            // Apply displacements
            positions.forEach(pos => {
                if (pos.pinned) return;
                const dist = Math.sqrt(pos.dx * pos.dx + pos.dy * pos.dy) || 0.01;
                const moveDist = Math.min(dist, t);
                pos.x += (pos.dx / dist) * moveDist;
                pos.y += (pos.dy / dist) * moveDist;
            });

            t -= dt;
        }

        // Center the layout if needed... (logic similar to before but updated)
        // ...

        // Snap to grid (50 units)
        const gridSize = 50;

        for (const item of items) {
            const pos = positions.get(item)!;
            if (!pos.pinned) {
                (item as any).schematicPosition = {
                    x: Math.round(pos.x / gridSize) * gridSize,
                    y: Math.round(pos.y / gridSize) * gridSize,
                    rotation: item.schematicPosition?.rotation ?? 0
                };
            }
        }

        // Rotation Heuristic for 2-pin components
        for (const item of items) {
            // Respect existing rotation if set manually
            if (positions.get(item)?.pinned && item.schematicPosition?.rotation !== undefined) continue;

            const anyItem = item as any;
            // Heuristic: only rotate 2-pin passives
            if (!/^[RCD]/.test(anyItem.ref)) continue;
            if (!anyItem.allPins) continue;

            const pins = Array.from(anyItem.allPins.values());
            if (pins.length !== 2) continue;

            // Find center of connected neighbors
            let sumX = 0, sumY = 0, count = 0;

            pins.forEach((pin: any) => {
                if (pin.net && pin.net.name) {
                    const neighbors = netToItems.get(pin.net.name);
                    if (neighbors) {
                        neighbors.forEach(n => {
                            if (n !== item && n.schematicPosition) {
                                sumX += n.schematicPosition.x;
                                sumY += n.schematicPosition.y;
                                count++;
                            }
                        });
                    }
                }
            });

            // Check for Power/GND connections first to force vertical orientation
            let isPowerAligned = false;
            const p1Net = (pins[0] as any).net?.name || "";
            const p2Net = (pins[1] as any).net?.name || "";

            const isGnd = (n: string) => /gnd|vss|earth|0v/i.test(n);
            const isVcc = (n: string) => /vcc|vdd|5v|3v|vin/i.test(n);

            if (isGnd(p1Net) && !isGnd(p2Net)) {
                anyItem.schematicPosition = { ...anyItem.schematicPosition, rotation: 270 };
                isPowerAligned = true;
            } else if (isGnd(p2Net) && !isGnd(p1Net)) {
                anyItem.schematicPosition = { ...anyItem.schematicPosition, rotation: 90 };
                isPowerAligned = true;
            } else if (isVcc(p1Net) && !isVcc(p2Net)) {
                anyItem.schematicPosition = { ...anyItem.schematicPosition, rotation: 90 };
                isPowerAligned = true;
            } else if (isVcc(p2Net) && !isVcc(p1Net)) {
                anyItem.schematicPosition = { ...anyItem.schematicPosition, rotation: 270 };
                isPowerAligned = true;
            }

            if (!isPowerAligned && count > 0) {
                const avgX = sumX / count;
                const avgY = sumY / count;
                const myX = anyItem.schematicPosition?.x || 0;
                const myY = anyItem.schematicPosition?.y || 0;

                const dx = Math.abs(myX - avgX);
                const dy = Math.abs(myY - avgY);

                // If neighbors are predominantly vertical relative to me, rotate 90
                if (dy > dx * 1.5) {
                    anyItem.schematicPosition = {
                        ...anyItem.schematicPosition,
                        rotation: 90
                    };
                }
            }
        }
    }
}

/**
 * Checks for overlaps between components.
 * Throws an error if overlapping components are found.
 * Assumes a default size if exact bounding box is not available.
 */
export function checkOverlaps(items: LayoutItem[]): void {
    // Basic check using fixed size 100x100 if size unknown
    // Ideally we should use the library, but here we do a basic check.
    // If schematicPosition is null, we can't check.

    const size = 100; // units assumed size
    const positionedItems = items.filter(i => i.schematicPosition && typeof i.schematicPosition.x === 'number');

    for (let i = 0; i < positionedItems.length; i++) {
        const u = positionedItems[i];
        const uPos = u.schematicPosition!;

        for (let j = i + 1; j < positionedItems.length; j++) {
            const v = positionedItems[j];
            const vPos = v.schematicPosition!;

            // Check distance
            const dx = Math.abs(uPos.x - vPos.x);
            const dy = Math.abs(uPos.y - vPos.y);

            if (dx < size && dy < size) {
                // If refs are same, it's the same object (shouldn't happen here due to loops)
                throw new Error(`Placement overlap detected between ${u.ref} and ${v.ref} at (${uPos.x}, ${uPos.y})`);
            }
        }
    }
}
