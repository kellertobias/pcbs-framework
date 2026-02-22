import { CircuitSnapshot } from "../synth/types";
import { Component } from "../synth/Component";

interface PlacedNode {
    isCluster: boolean;
    ref: string;
    comp?: Component;
    children: PlacedNode[];

    // local relative grid coordinates within parent (center for components/clusters)
    x: number;
    y: number;

    // computed size and padding
    width: number;
    height: number;
    padding: number;
    isFixed: boolean;
}

export class HierarchicalPlacer {
    static place(snapshot: CircuitSnapshot, getDimensions?: (comp: Component) => { width: number, height: number }) {
        // Find components that need placement
        const toPlace = snapshot.components.filter(c => c.symbol !== "Device:DNC");
        if (toPlace.length === 0) return;

        // Calculate wire counts for each component to determine padding
        const wireCounts = new Map<string, number>();
        for (const comp of snapshot.components) {
            let count = 0;
            for (const pin of comp.allPins.values()) {
                if (pin.net) count++;
            }
            wireCounts.set(comp.ref, count);
        }

        // Pre-calculate component connectivity via shared nets
        const netPins = new Map<string, string[]>(); // net name -> array of component refs
        for (const comp of snapshot.components) {
            if (comp.symbol === "Device:DNC") continue;
            for (const pin of comp.allPins.values()) {
                if (pin.net) {
                    if (!netPins.has(pin.net.name)) netPins.set(pin.net.name, []);
                    netPins.get(pin.net.name)!.push(comp.ref);
                }
            }
        }

        const compConnections = new Map<string, Map<string, number>>();
        for (const refs of netPins.values()) {
            const uniqueRefs = Array.from(new Set(refs));
            for (let i = 0; i < uniqueRefs.length; i++) {
                for (let j = i + 1; j < uniqueRefs.length; j++) {
                    const r1 = uniqueRefs[i];
                    const r2 = uniqueRefs[j];
                    if (!compConnections.has(r1)) compConnections.set(r1, new Map());
                    if (!compConnections.has(r2)) compConnections.set(r2, new Map());
                    compConnections.get(r1)!.set(r2, (compConnections.get(r1)!.get(r2) || 0) + 1);
                    compConnections.get(r2)!.set(r1, (compConnections.get(r2)!.get(r1) || 0) + 1);
                }
            }
        }

        function getComponentsInNode(node: PlacedNode): string[] {
            if (node.comp) return [node.comp.ref];
            const refs: string[] = [];
            for (const c of node.children) {
                refs.push(...getComponentsInNode(c));
            }
            return refs;
        }

        const root: PlacedNode = { isCluster: true, ref: "ROOT", children: [], x: 0, y: 0, width: 0, height: 0, padding: 0, isFixed: false };
        const clusters = new Map<string, PlacedNode>();
        clusters.set("ROOT", root);

        function getCluster(comp: Component): PlacedNode {
            const path: string[] = [];
            let current = comp.parent;
            while (current) {
                path.unshift(current.ref);
                current = current.parent;
            }
            if (comp.group) {
                path.push(`Group:${comp.group}`);
            }

            let parentNode = root;
            let currentPath = "ROOT";
            for (const p of path) {
                currentPath += "/" + p;
                if (!clusters.has(currentPath)) {
                    const newCluster: PlacedNode = { isCluster: true, ref: p, children: [], x: 0, y: 0, width: 0, height: 0, padding: 0, isFixed: false };
                    parentNode.children.push(newCluster);
                    clusters.set(currentPath, newCluster);
                }
                parentNode = clusters.get(currentPath)!;
            }
            return parentNode;
        }

        for (const comp of toPlace) {
            const cluster = getCluster(comp);
            const wires = wireCounts.get(comp.ref) || 0;
            // More wires -> more space to next component. Base padding 15 to guarantee routing corridor.
            const padding = wires * 2 + 15;
            const dims = getDimensions ? getDimensions(comp) : { width: 15, height: 15 };
            const width = dims.width;
            const height = dims.height;

            cluster.children.push({
                isCluster: false,
                ref: comp.ref,
                comp: comp,
                children: [],
                x: comp.schematicPosition ? comp.schematicPosition.x : 0,
                y: comp.schematicPosition ? comp.schematicPosition.y : 0,
                width, height, padding,
                isFixed: !!comp.schematicPosition
            });
        }

        // Bottom-up placement using force-directed physics
        function computeLayout(node: PlacedNode) {
            if (node.children.length === 0) return;

            for (const child of node.children) {
                if (child.isCluster) {
                    computeLayout(child);
                }
            }

            if (node.children.length === 1) {
                const child = node.children[0];
                if (!child.isFixed) {
                    child.x = 0;
                    child.y = 0;
                }
                node.width = child.width + 2 * child.padding;
                node.height = child.height + 2 * child.padding;
                node.padding = node.ref === "ROOT" ? 0 : 10;
                node.isFixed = child.isFixed;
                return;
            }

            // Map logical edges between children
            const childComponents = node.children.map(c => getComponentsInNode(c));
            const edgeWeights = new Map<PlacedNode, Map<PlacedNode, number>>();

            for (let i = 0; i < node.children.length; i++) {
                const c1 = node.children[i];
                edgeWeights.set(c1, new Map());
                for (let j = i + 1; j < node.children.length; j++) {
                    const c2 = node.children[j];
                    let weight = 0;
                    for (const ref1 of childComponents[i]) {
                        for (const ref2 of childComponents[j]) {
                            weight += compConnections.get(ref1)?.get(ref2) || 0;
                        }
                    }
                    if (weight > 0) {
                        edgeWeights.get(c1)!.set(c2, weight);
                        if (!edgeWeights.has(c2)) edgeWeights.set(c2, new Map());
                        edgeWeights.get(c2)!.set(c1, weight);
                    }
                }
            }

            // Initialize positions
            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i];
                // using deterministic pseudo-random so layouts don't jitter wildly across builds
                const angle = (i / node.children.length) * Math.PI * 2;
                const radius = node.children.length * 10;
                child.x = Math.cos(angle) * radius;
                child.y = Math.sin(angle) * radius;
            }

            const iterations = 500;
            const kSpring = 0.2; // attraction
            const kRepulsion = 1000;
            const damping = 0.6;
            const centerGravity = 0.15;

            const clusterPadding = 40;

            const velocities = new Map<PlacedNode, { vx: number, vy: number }>();
            for (const child of node.children) velocities.set(child, { vx: 0, vy: 0 });

            for (let iter = 0; iter < iterations; iter++) {
                const forces = new Map<PlacedNode, { fx: number, fy: number }>();
                for (const child of node.children) forces.set(child, { fx: 0, fy: 0 });

                for (let i = 0; i < node.children.length; i++) {
                    const c1 = node.children[i];
                    const f1 = forces.get(c1)!;

                    // Weak center gravity
                    f1.fx -= c1.x * centerGravity;
                    f1.fy -= c1.y * centerGravity;

                    for (let j = i + 1; j < node.children.length; j++) {
                        const c2 = node.children[j];
                        const f2 = forces.get(c2)!;

                        const dx = c2.x - c1.x;
                        const dy = c2.y - c1.y;
                        let dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < 0.1) { dist = 0.1; }

                        const nx = dx / dist;
                        const ny = dy / dist;

                        // Repulsion with AABB corner safety margin (circle vs square padding)
                        const idealDist = (c1.width / 2 + c1.padding) + (c2.width / 2 + c2.padding) + 15;

                        // Repulsion (prevent overlaps)
                        let repForce = kRepulsion * Math.pow(idealDist / dist, 2);
                        if (dist > idealDist * 2) {
                            repForce = repForce * 0.1; // decay repulsion at a distance
                        }

                        f1.fx -= nx * repForce;
                        f1.fy -= ny * repForce;
                        f2.fx += nx * repForce;
                        f2.fy += ny * repForce;

                        // Attraction (pull connected together)
                        const weight = edgeWeights.get(c1)?.get(c2) || 0;
                        if (weight > 0) {
                            const stretch = dist - idealDist;
                            if (stretch > 0) { // only attract if further than ideal distance
                                const attForce = stretch * kSpring * weight;
                                f1.fx += nx * attForce;
                                f1.fy += ny * attForce;
                                f2.fx -= nx * attForce;
                                f2.fy -= ny * attForce;
                            }
                        }
                    }
                }

                // Apply kinematics
                for (const child of node.children) {
                    const v = velocities.get(child)!;
                    const f = forces.get(child)!;
                    v.vx = (v.vx + f.fx) * damping;
                    v.vy = (v.vy + f.fy) * damping;

                    // Speed limit
                    const speed = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
                    if (speed > 100) {
                        v.vx = (v.vx / speed) * 100;
                        v.vy = (v.vy / speed) * 100;
                    }

                    if (!child.isFixed) {
                        child.x += v.vx;
                        child.y += v.vy;
                    }
                }
            }

            // Post-simulation bounding box calculation
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;

            for (const child of node.children) {
                const rw = child.width / 2 + child.padding;
                const rh = child.height / 2 + child.padding;
                if (child.x - rw < minX) minX = child.x - rw;
                if (child.x + rw > maxX) maxX = child.x + rw;
                if (child.y - rh < minY) minY = child.y - rh;
                if (child.y + rh > maxY) maxY = child.y + rh;
            }

            // Center cluster bounds locally on its internal coordinate system
            const hasFixedChildren = node.children.some(c => c.isFixed);
            if (!hasFixedChildren) {
                const cx = (minX + maxX) / 2;
                const cy = (minY + maxY) / 2;
                for (const child of node.children) {
                    child.x -= cx;
                    child.y -= cy;
                }
            } else {
                // Determine if fixed positions cause overlaps and scale them out if necessary.
                // We only do this if there's more than one fixed child to compare.
                const fixedChildren = node.children.filter(c => c.isFixed);
                if (fixedChildren.length > 1) {
                    let maxRequiredScale = 1.0;

                    for (let i = 0; i < fixedChildren.length; i++) {
                        for (let j = i + 1; j < fixedChildren.length; j++) {
                            const c1 = fixedChildren[i];
                            const c2 = fixedChildren[j];

                            const dx = Math.abs(c2.x - c1.x);
                            const dy = Math.abs(c2.y - c1.y);

                            const reqDx = (c1.width / 2 + c1.padding) + (c2.width / 2 + c2.padding);
                            const reqDy = (c1.height / 2 + c1.padding) + (c2.height / 2 + c2.padding);

                            // If they are strictly overlapping on both axes:
                            if (dx < reqDx && dy < reqDy) {
                                // Calculate how much we need to scale the distance to resolve the worst overlap axis.
                                // We pick the axis that requires the *smallest* push to resolve the overlap, 
                                // but since we scale uniformly from the origin, we check the scale factor for the primary separation axis.

                                // To prevent zero-division bounding:
                                const safeDx = dx < 0.1 ? 0.1 : dx;
                                const safeDy = dy < 0.1 ? 0.1 : dy;

                                const scaleX = reqDx / safeDx;
                                const scaleY = reqDy / safeDy;

                                // The minimum scale to escape the AABB is the smaller of the two required scales
                                const neededScale = Math.min(scaleX, scaleY);
                                if (neededScale > maxRequiredScale) {
                                    maxRequiredScale = neededScale;
                                }
                            }
                        }
                    }

                    if (maxRequiredScale > 1.0) {
                        for (const child of fixedChildren) {
                            child.x *= maxRequiredScale;
                            child.y *= maxRequiredScale;
                        }

                        // Recompute bounding box after scaling
                        minX = Infinity;
                        maxX = -Infinity;
                        minY = Infinity;
                        maxY = -Infinity;
                        for (const child of node.children) {
                            const rw = child.width / 2 + child.padding;
                            const rh = child.height / 2 + child.padding;
                            if (child.x - rw < minX) minX = child.x - rw;
                            if (child.x + rw > maxX) maxX = child.x + rw;
                            if (child.y - rh < minY) minY = child.y - rh;
                            if (child.y + rh > maxY) maxY = child.y + rh;
                        }
                    }
                }

                node.isFixed = true;
            }

            node.width = maxX - minX;
            node.height = maxY - minY;
            node.padding = node.ref === "ROOT" ? 0 : 10;
        }

        computeLayout(root);

        // Apply global flat coordinates back to components
        function applyPositions(node: PlacedNode, absoluteParentTopLeftX: number, absoluteParentTopLeftY: number) {
            for (const child of node.children) {
                if (child.isCluster) {
                    const absTopLeftX = absoluteParentTopLeftX + child.x - child.width / 2 - child.padding;
                    const absTopLeftY = absoluteParentTopLeftY + child.y - child.height / 2 - child.padding;
                    applyPositions(child, absTopLeftX, absTopLeftY);
                } else if (child.comp) {
                    const absoluteX = absoluteParentTopLeftX + child.x;
                    const absoluteY = absoluteParentTopLeftY + child.y;

                    // Subtract the parent absolute schematic position if any since `Component.absoluteSchematicPosition` adds them.
                    let parentAbsX = 0;
                    let parentAbsY = 0;
                    let current = child.comp.parent;
                    while (current) {
                        if (current.schematicPosition) {
                            parentAbsX += current.schematicPosition.x;
                            parentAbsY += current.schematicPosition.y;
                        }
                        current = current.parent;
                    }

                    const localX = absoluteX - parentAbsX;
                    const localY = absoluteY - parentAbsY;

                    // Preserve original rotation
                    const rot = child.comp.schematicPosition ? child.comp.schematicPosition.rotation : 0;
                    (child.comp as any).schematicPosition = { x: localX, y: localY, rotation: rot };
                }
            }
        }

        applyPositions(root, 0, 0);
    }
}
