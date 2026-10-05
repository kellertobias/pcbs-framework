import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { optimizeAssemblyPart } from '../assembly/optimize';
import { measureAssemblyPoints } from '../assembly/measurement';

describe('assembly rendering geometry', () => {
    it('reduces native face draw calls without changing transformed bounds or measurements', () => {
        const root = new THREE.Group();
        root.position.set(30, 40, 50);
        root.rotation.set(0.2, 0.3, 0.4);
        const model = new THREE.Group();
        model.scale.setScalar(2.54);
        model.rotation.x = Math.PI / 2;
        root.add(model);
        const material = new THREE.MeshPhongMaterial({ color: 0x99aabb });
        for (let i = 0; i < 20; i++) {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), material.clone());
            mesh.position.x = i * 2;
            model.add(mesh);
        }
        root.updateMatrixWorld(true);
        const before = new THREE.Box3().setFromObject(root, true);
        optimizeAssemblyPart(root);
        const after = new THREE.Box3().setFromObject(root, true);
        let meshes = 0;
        root.traverse((o) => {
            if (o instanceof THREE.Mesh) meshes++;
        });
        expect(meshes).toBe(1);
        expect(after.min.distanceTo(before.min)).toBeLessThan(1e-5);
        expect(after.max.distanceTo(before.max)).toBeLessThan(1e-5);
        const delta = measureAssemblyPoints(after.min.toArray(), after.max.toArray());
        expect(delta.distance).toBeCloseTo(after.getSize(new THREE.Vector3()).length());
    });
});
