import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
/** Native KiCad VRML contains many tiny face meshes. Merge equivalent untextured
 * materials within one assembly part, retaining world geometry and part identity.
 * Textured, animated, multi-material and hidden meshes remain untouched.
 */
export function optimizeAssemblyPart(root: THREE.Group): void {
    root.updateMatrixWorld(true);
    const inverse = root.matrixWorld.clone().invert();
    const buckets = new Map<
        string,
        { material: THREE.Material; meshes: THREE.Mesh[]; geometries: THREE.BufferGeometry[] }
    >();
    root.traverse((object) => {
        if (
            !(object instanceof THREE.Mesh) ||
            object instanceof THREE.SkinnedMesh ||
            object instanceof THREE.InstancedMesh ||
            !object.visible ||
            Array.isArray(object.material) ||
            Object.keys(object.geometry.morphAttributes).length
        )
            return;
        let parent = object.parent;
        while (parent && parent !== root) {
            if (!parent.visible) return;
            parent = parent.parent;
        }
        const material = object.material;
        if (Object.values(material).some((value) => value instanceof THREE.Texture)) return;
        const data = material.toJSON();
        delete data.uuid;
        delete (data as { metadata?: unknown }).metadata;
        delete data.name;
        const geometry = object.geometry.index
            ? object.geometry.toNonIndexed()
            : object.geometry.clone();
        if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
        for (const name of Object.keys(geometry.attributes))
            if (!['position', 'normal', 'color'].includes(name)) geometry.deleteAttribute(name);
        const key = JSON.stringify(data) + Object.keys(geometry.attributes).sort().join(',');
        geometry.applyMatrix4(inverse.clone().multiply(object.matrixWorld));
        const bucket: {
            material: THREE.Material;
            meshes: THREE.Mesh[];
            geometries: THREE.BufferGeometry[];
        } = buckets.get(key) ?? { material, meshes: [], geometries: [] };
        bucket.meshes.push(object);
        bucket.geometries.push(geometry);
        buckets.set(key, bucket);
    });
    const retired = new Set<THREE.BufferGeometry>();
    for (const bucket of buckets.values()) {
        if (bucket.meshes.length < 2) {
            bucket.geometries.forEach((g) => g.dispose());
            continue;
        }
        const geometry = mergeGeometries(bucket.geometries, false);
        bucket.geometries.forEach((g) => g.dispose());
        if (!geometry) continue;
        for (const mesh of bucket.meshes) {
            mesh.removeFromParent();
            retired.add(mesh.geometry);
        }
        root.add(new THREE.Mesh(geometry, bucket.material));
    }
    // A loader may share geometry with an unmerged mesh. Retain those buffers.
    root.traverse((object) => {
        if (object instanceof THREE.Mesh) retired.delete(object.geometry);
    });
    retired.forEach((geometry) => geometry.dispose());
    root.updateMatrixWorld(true);
}
