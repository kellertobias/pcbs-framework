import * as THREE from 'three';
import type { AssemblyPart, AssemblyPlacement } from '../synth/Assembly';
export function placementMatrix(part: AssemblyPlacement): THREE.Matrix4 {
    return new THREE.Matrix4().compose(
        new THREE.Vector3(...(part.position ?? [0, 0, 0])),
        new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
                ...((part.rotation ?? [0, 0, 0]).map(THREE.MathUtils.degToRad) as [
                    number,
                    number,
                    number,
                ]),
                'XYZ',
            ),
        ),
        new THREE.Vector3(1, 1, 1),
    );
}
export function assemblyWorldMatrix(
    part: AssemblyPlacement,
    parts: readonly AssemblyPart[],
    chain = new Set<string>(),
): THREE.Matrix4 {
    if (chain.has(part.id)) throw new Error(`Assembly group cycle at ${part.id}`);
    const local = placementMatrix(part);
    if (!part.group) return local;
    const parent = parts.find((p) => p.id === part.group);
    if (!parent || parent.kind !== 'group')
        throw new Error(`Unknown assembly group: ${part.group}`);
    return assemblyWorldMatrix(parent, parts, new Set([...chain, part.id])).multiply(local);
}
export function validateAssemblyHierarchy(parts: readonly AssemblyPart[]): void {
    for (const part of parts) assemblyWorldMatrix(part, parts);
}
