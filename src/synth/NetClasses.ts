import type { NetClassDefinition, PcbNetClass } from './types';
import type { Net } from './Net';

/** Define physical net rules once alongside the circuit and reuse them on named nets. */
export function defineNetClass(rules: NetClassDefinition): NetClassDefinition {
    if (!rules.name.trim()) throw new Error('A net class needs a name.');
    for (const [key, value] of Object.entries(rules)) {
        if (typeof value === 'number' && (!Number.isFinite(value) || value <= 0))
            throw new Error(`Invalid ${rules.name} net class ${key}.`);
    }
    return Object.freeze({ ...rules });
}
export function circuitNetClasses(
    declared: readonly PcbNetClass[],
    nets: readonly Net[],
): PcbNetClass[] {
    const classes = new Map<string, PcbNetClass>();
    const key = ({ nets: _nets, ...rules }: PcbNetClass) =>
        JSON.stringify(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b)));
    for (const rule of [
        ...declared,
        ...nets.flatMap((net) =>
            net.classDefinition
                ? [
                      {
                          ...net.classDefinition,
                          nets: nets.filter((n) => n.class === net.class).map((n) => n.name),
                      },
                  ]
                : [],
        ),
    ]) {
        const previous = classes.get(rule.name);
        if (previous && key(previous) !== key(rule))
            throw new Error(`Conflicting definitions of net class '${rule.name}'.`);
        classes.set(rule.name, {
            ...rule,
            nets: [...new Set([...(previous?.nets ?? []), ...(rule.nets ?? [])])],
        });
    }
    return [...classes.values()];
}
