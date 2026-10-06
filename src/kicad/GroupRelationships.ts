import type { GroupFrame } from './GroupedSchematicLayout';
import type { SchematicGroup } from '../synth/types';

/** Solve explicit relative box constraints, then let sheet packing place each connected cluster. */
export function groupClusters(frames: GroupFrame[], groups: SchematicGroup[]) {
    const positions = new Map<string, { x: number; y: number; root: string }>();
    const active = new Set<string>();
    const resolve = (frame: GroupFrame): { x: number; y: number; root: string } => {
        const saved = positions.get(frame.id);
        if (saved) return saved;
        if (active.has(frame.id))
            throw new Error(`Cyclic schematic group relationship at '${frame.id}'.`);
        active.add(frame.id);
        const relative = groups.find((g) => g.id === frame.id)?.relativeTo;
        let result = { x: 0, y: 0, root: frame.id };
        if (relative) {
            const anchor = frames.find((f) => f.id === relative.group);
            if (!anchor) throw new Error(`Unknown relative schematic group '${relative.group}'.`);
            if (
                !['left', 'right', 'up', 'down'].includes(relative.direction) ||
                !Number.isFinite(relative.gap ?? 12.7) ||
                (relative.gap ?? 12.7) < 0
            )
                throw new Error(`Invalid relationship for schematic group '${frame.id}'.`);
            const p = resolve(anchor),
                gap = Math.ceil((relative.gap ?? 12.7) / 2.54) * 2.54;
            result = {
                root: p.root,
                x:
                    p.x +
                    (relative.direction === 'right'
                        ? anchor.width + gap
                        : relative.direction === 'left'
                          ? -frame.width - gap
                          : 0),
                y:
                    p.y +
                    (relative.direction === 'down'
                        ? anchor.height + gap
                        : relative.direction === 'up'
                          ? -frame.height - gap
                          : 0),
            };
        }
        active.delete(frame.id);
        positions.set(frame.id, result);
        return result;
    };
    frames.forEach(resolve);
    return [...new Set([...positions.values()].map((p) => p.root))].map((root) => {
        const members = frames.filter((f) => positions.get(f.id)!.root === root);
        const minX = Math.min(...members.map((f) => positions.get(f.id)!.x)),
            minY = Math.min(...members.map((f) => positions.get(f.id)!.y));
        const offsets = members.map((frame) => ({
            frame,
            x: positions.get(frame.id)!.x - minX,
            y: positions.get(frame.id)!.y - minY,
        }));
        for (const [index, a] of offsets.entries())
            for (const b of offsets.slice(index + 1))
                if (
                    a.x < b.x + b.frame.width &&
                    b.x < a.x + a.frame.width &&
                    a.y < b.y + b.frame.height &&
                    b.y < a.y + a.frame.height
                )
                    throw new Error(
                        `Relative schematic groups '${a.frame.id}' and '${b.frame.id}' overlap; chain the relationships or use different sides.`,
                    );
        return {
            offsets,
            width: Math.max(...offsets.map((f) => f.x + f.frame.width)),
            height: Math.max(...offsets.map((f) => f.y + f.frame.height)),
        };
    });
}
