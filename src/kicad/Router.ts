export interface Point {
    x: number;
    y: number;
}

export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

export class Router {
    private gridSize = 50;

    constructor(gridSize = 50) {
        this.gridSize = gridSize;
    }

    route(start: Point, end: Point, obstacles: Box[]): Point[] {
        // Quantize start and end
        const s = this.snap(start);
        const e = this.snap(end);

        if (s.x === e.x && s.y === e.y) return [s, e];

        // A* Algorithm
        const openSet = new PriorityQueue<Node>((node) => node.f);
        openSet.enqueue(new Node(s.x, s.y, 0, this.heuristic(s, e)), 0);

        const gScore = new Map<string, number>();
        gScore.set(this.key(s), 0);

        const closedSet = new Set<string>();
        // Use a map to track nodes to reconstruct path, storing the node itself allows parent traversal
        const nodeMap = new Map<string, Node>();
        nodeMap.set(this.key(s), openSet.peek()!);

        let finalNode: Node | null = null;
        let iter = 0;
        const maxIter = 200000;

        while (!openSet.isEmpty()) {
            iter++;
            if (iter > maxIter) break;

            const current = openSet.dequeue();
            const currentKey = this.key(current);

            if (closedSet.has(currentKey)) continue;

            if (Math.abs(current.x - e.x) < 0.01 && Math.abs(current.y - e.y) < 0.01) {
                finalNode = current;
                break;
            }

            closedSet.add(currentKey);

            const neighbors = this.getNeighbors(current);
            for (const neighbor of neighbors) {
                const neighborKey = this.key(neighbor);
                if (closedSet.has(neighborKey)) continue;

                // Check collision
                if (this.isBlocked(neighbor, obstacles, s, e)) continue;

                // Calculate costs
                const moveCost = 1;

                // Turn penalty: check if direction changes
                let turnCost = 0;
                if (current.parent) {
                    const prevDx = current.x - current.parent.x;
                    const prevDy = current.y - current.parent.y;
                    const newDx = neighbor.x - current.x;
                    const newDy = neighbor.y - current.y;
                    if (prevDx !== newDx || prevDy !== newDy) {
                        turnCost = 0.1; // Small penalty for turning to prefer straight lines without destroying A* performance
                    }
                }

                const tentativeG = current.g + moveCost + turnCost;

                const existingG = gScore.get(neighborKey);
                if (existingG === undefined || tentativeG < existingG) {
                    neighbor.parent = current;
                    gScore.set(neighborKey, tentativeG);
                    neighbor.g = tentativeG;
                    neighbor.f = tentativeG + this.heuristic(neighbor, e);

                    openSet.enqueue(neighbor, neighbor.f);
                    nodeMap.set(neighborKey, neighbor);
                }
            }
        }

        if (finalNode) {
            return this.simplifyPath(this.reconstructPath(finalNode));
        }

        throw new Error(`ROUTER_DEAD_END: Failed to find path from ${start.x.toFixed(2)},${start.y.toFixed(2)} to ${end.x.toFixed(2)},${end.y.toFixed(2)}. Iterations: ${iter}. OpenSetEmpty: ${openSet.isEmpty()}`);
    }

    private snap(p: Point): Point {
        return {
            x: Math.round(p.x / this.gridSize) * this.gridSize,
            y: Math.round(p.y / this.gridSize) * this.gridSize
        };
    }

    private key(p: Point): string {
        // Round to 3 decimal places to prevent IEEE 754 float drift breaking grid node uniqueness
        return `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
    }

    private heuristic(a: Point, b: Point): number {
        // Manhattan distance with a tiny tie-breaker multiplier (1.001) 
        // to prevent A* from flood-filling equal-cost diamond paths over long distances
        return ((Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) / this.gridSize) * 1.001;
    }

    private getNeighbors(node: Node): Node[] {
        const dirs = [
            { dx: 0, dy: this.gridSize },
            { dx: 0, dy: -this.gridSize },
            { dx: this.gridSize, dy: 0 },
            { dx: -this.gridSize, dy: 0 }
        ];

        return dirs.map(d => new Node(node.x + d.dx, node.y + d.dy, 0, 0));
    }

    private isBlocked(p: Point, obstacles: Box[], start: Point, end: Point): boolean {
        // Allow start and end points and their immediate grid neighbors immunity from obstacles
        if (Math.abs(p.x - start.x) <= this.gridSize * 1.5 && Math.abs(p.y - start.y) <= this.gridSize * 1.5) return false;
        if (Math.abs(p.x - end.x) <= this.gridSize * 1.5 && Math.abs(p.y - end.y) <= this.gridSize * 1.5) return false;

        for (const obs of obstacles) {
            // Obstacles are usually padded by caller or we pad here?
            // Let's assume obstacles passed in are the "keep out" zones.
            // We check strict containment.
            if (p.x >= obs.x && p.x <= obs.x + obs.width &&
                p.y >= obs.y && p.y <= obs.y + obs.height) {
                return true;
            }
        }
        return false;
    }

    private reconstructPath(node: Node): Point[] {
        const path: Point[] = [];
        let curr: Node | undefined = node;
        while (curr) {
            path.push({ x: curr.x, y: curr.y });
            curr = curr.parent;
        }
        return path.reverse();
    }

    private simplifyPath(path: Point[]): Point[] {
        if (path.length < 3) return path;

        const simplified: Point[] = [path[0]];
        for (let i = 1; i < path.length - 1; i++) {
            const prev = path[i - 1];
            const curr = path[i];
            const next = path[i + 1];

            // If collinear, skip curr
            const dx1 = curr.x - prev.x;
            const dy1 = curr.y - prev.y;
            const dx2 = next.x - curr.x;
            const dy2 = next.y - curr.y;

            if (!((dx1 === 0 && dx2 === 0) || (dy1 === 0 && dy2 === 0))) {
                simplified.push(curr);
            }
        }
        simplified.push(path[path.length - 1]);
        return simplified;
    }
}

class Node implements Point {
    x: number;
    y: number;
    g: number;
    f: number;
    parent?: Node;

    constructor(x: number, y: number, g: number, f: number) {
        this.x = x;
        this.y = y;
        this.g = g;
        this.f = f;
    }
}

class PriorityQueue<T> {
    private elements: T[] = [];
    private priority: (element: T) => number;

    constructor(priority: (element: T) => number) {
        this.priority = priority;
    }

    enqueue(element: T, priorityValue?: number) {
        this.elements.push(element);
        this.bubbleUp(this.elements.length - 1);
    }

    dequeue(): T {
        const top = this.elements[0];
        const bottom = this.elements.pop()!;
        if (this.elements.length > 0) {
            this.elements[0] = bottom;
            this.sinkDown(0);
        }
        return top;
    }

    private bubbleUp(n: number) {
        const element = this.elements[n];
        const elemPriority = this.priority(element);
        while (n > 0) {
            const parentN = Math.floor((n + 1) / 2) - 1;
            const parent = this.elements[parentN];
            if (elemPriority >= this.priority(parent)) break;
            this.elements[parentN] = element;
            this.elements[n] = parent;
            n = parentN;
        }
    }

    private sinkDown(n: number) {
        const length = this.elements.length;
        const element = this.elements[n];
        const elemPriority = this.priority(element);

        while (true) {
            const child2N = (n + 1) * 2;
            const child1N = child2N - 1;
            let swap = null;
            let child1Priority = 0;

            if (child1N < length) {
                const child1 = this.elements[child1N];
                child1Priority = this.priority(child1);
                if (child1Priority < elemPriority) {
                    swap = child1N;
                }
            }

            if (child2N < length) {
                const child2 = this.elements[child2N];
                const child2Priority = this.priority(child2);
                if (child2Priority < (swap === null ? elemPriority : child1Priority)) {
                    swap = child2N;
                }
            }

            if (swap === null) break;
            this.elements[n] = this.elements[swap];
            this.elements[swap] = element;
            n = swap;
        }
    }

    isEmpty(): boolean {
        return this.elements.length === 0;
    }

    peek(): T | undefined {
        return this.elements[0];
    }
}
