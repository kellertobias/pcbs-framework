import type { CircuitSnapshot } from '../synth/types';
import {
    inPolygon,
    rectObstacle,
    type BoardTerminal,
    type CopperObstacle,
} from './BoardRoutingGeometry';

/** Region ownership comes from original pad positions, before any escape fanout moves terminals. */
export function routingRegionObstacles(
    snapshot: CircuitSnapshot,
    terminals: BoardTerminal[],
): Map<string, CopperObstacle[]> {
    const regions = snapshot.pcb?.routingRegions ?? [];
    const ids = new Set<string>();
    for (const region of regions) {
        if (
            !region.id ||
            ids.has(region.id) ||
            !['keepout', 'local'].includes(region.mode) ||
            region.points.length < 3 ||
            region.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
        )
            throw new Error(`Invalid or duplicate routing region '${region.id}'.`);
        ids.add(region.id);
    }
    const result = new Map<string, CopperObstacle[]>();
    for (const net of new Set(terminals.map((t) => t.net).filter((n): n is string => !!n))) {
        const obstacles: CopperObstacle[] = [];
        for (const region of regions) {
            const local =
                region.mode === 'local' &&
                (region.nets
                    ? region.nets.includes(net)
                    : terminals.some((t) => t.net === net && inPolygon(t.at, region.points)));
            if (!local)
                obstacles.push(rectObstacle(region.points, 0, region.layers ?? ['F.Cu', 'B.Cu']));
        }
        for (const hint of snapshot.pcb?.routeHints ?? [])
            if (hint.nets.includes(net))
                for (const polygon of hint.forbiddenRegions ?? [])
                    obstacles.push(rectObstacle(polygon, 0, ['F.Cu', 'B.Cu']));
        result.set(net, obstacles);
    }
    return result;
}
