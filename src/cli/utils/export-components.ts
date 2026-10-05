import type { CircuitSnapshot } from '../../synth/types';
import type { Component } from '../../synth/Component';

const panelRotations = new WeakMap<Component<any>, number>();
export const panelRotation = (component: Component<any>): number =>
    panelRotations.get(component) ?? 0;

/** Match native panel references without mutating shared source components. */
export function exportComponents(
    snapshot: CircuitSnapshot,
    prefix = '',
    rotation = 0,
): Component<any>[] {
    return [
        ...snapshot.components
            .filter(
                (component) =>
                    component.symbol !== 'Device:DNC' &&
                    component.symbol !== 'Mechanical:MountingHole' &&
                    !component.symbol.startsWith('Jumper:SolderJumper'),
            )
            .map((component) => {
                if (!prefix) return component;
                const copy = Object.create(component) as Component<any>;
                Object.defineProperty(copy, 'ref', { value: `${prefix}${component.ref}` });
                panelRotations.set(copy, rotation);
                return copy;
            }),
        ...(snapshot.boards ?? []).flatMap((board) =>
            exportComponents(
                board.snapshot,
                `${prefix}${board.id}_`,
                rotation + (board.rotation ?? 0),
            ),
        ),
    ];
}
