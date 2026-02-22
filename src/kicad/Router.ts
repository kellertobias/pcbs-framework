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
        const openSet = new PriorityQueue<Node>();
        openSet.enqueue(new Node(s.x, s.y, 0, this.heuristic(s, e)), 0);

        const gScore = new Map<string, number>();
        gScore.set(this.key(s), 0);

        const closedSet = new Set<string>();
        // Use a map to track nodes to reconstruct path, storing the node itself allows parent traversal
        const nodeMap = new Map<string, Node>();
        nodeMap.set(this.key(s), openSet.peek()!);

        let finalNode: Node | null = null;

        while (!openSet.isEmpty()) {
            const current = openSet.dequeue();
            const currentKey = this.key(current);

            if (closedSet.has(currentKey)) continue;

            if (current.x === e.x && current.y === e.y) {
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
                        turnCost = 5; // Penalty for turning
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

        // Fallback: direct line
        return [start, end];
    }

    private snap(p: Point): Point {
        return {
            x: Math.round(p.x / this.gridSize) * this.gridSize,
            y: Math.round(p.y / this.gridSize) * this.gridSize
        };
    }

    private key(p: Point): string {
        return `${p.x},${p.y}`;
    }

    private heuristic(a: Point, b: Point): number {
        // Manhattan distance
        return (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) / this.gridSize;
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
        // Allow start and end points
        if (Math.abs(p.x - start.x) < 1 && Math.abs(p.y - start.y) < 1) return false;
        if (Math.abs(p.x - end.x) < 1 && Math.abs(p.y - end.y) < 1) return false;

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
            const prev = path[i-1];
            const curr = path[i];
            const next = path[i+1];

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
    private items: { item: T, priority: number }[] = [];

    enqueue(item: T, priority: number) {
        this.items.push({ item, priority });
        this.items.sort((a, b) => a.priority - b.priority);
    }

    dequeue(): T {
        return this.items.shift()!.item;
    }

    peek(): T | undefined {
        return this.items[0]?.item;
    }

    isEmpty(): boolean {
        return this.items.length === 0;
    }
}
