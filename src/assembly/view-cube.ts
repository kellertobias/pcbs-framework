/// <reference lib="dom" />
import * as THREE from '../runtime/three.mjs';
export const CUBE_FACES = [
    { name: 'Right', direction: [1, 0, 0] },
    { name: 'Left', direction: [-1, 0, 0] },
    { name: 'Back', direction: [0, 1, 0] },
    { name: 'Front', direction: [0, -1, 0] },
    { name: 'Top', direction: [0, 0, 1] },
    { name: 'Bottom', direction: [0, 0, -1] },
] as const;
export function cubeViewName(direction: THREE.Vector3): string {
    return [
        direction.z > 0 ? 'Top' : direction.z < 0 ? 'Bottom' : '',
        direction.y < 0 ? 'Front' : direction.y > 0 ? 'Back' : '',
        direction.x < 0 ? 'Left' : direction.x > 0 ? 'Right' : '',
    ]
        .filter(Boolean)
        .join(' / ');
}
/** Camera-aligned cube with six faces, twelve edges and eight corner targets. */
export class AssemblyViewCube {
    private renderer: THREE.WebGLRenderer;
    private scene = new THREE.Scene();
    private camera = new THREE.OrthographicCamera(-1.65, 1.65, 1.65, -1.65, 0.1, 20);
    private cube: THREE.Mesh;
    private handles: THREE.Mesh[] = [];
    private raycaster = new THREE.Raycaster();
    private hover?: THREE.Mesh;
    constructor(
        private canvas: HTMLCanvasElement,
        private choose: (direction: THREE.Vector3) => void,
    ) {
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            alpha: true,
            antialias: true,
        });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.setSize(144, 144, false);
        const materials = CUBE_FACES.map(({ name }) => {
            const label = document.createElement('canvas');
            label.width = 256;
            label.height = 256;
            const context = label.getContext('2d')!;
            context.fillStyle = '#304253';
            context.fillRect(0, 0, 256, 256);
            context.strokeStyle = '#9db3c5';
            context.lineWidth = 5;
            context.strokeRect(3, 3, 250, 250);
            context.fillStyle = '#eef6fc';
            context.font = 'bold 44px system-ui';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(name.toUpperCase(), 128, 128);
            const texture = new THREE.CanvasTexture(label);
            texture.colorSpace = THREE.SRGBColorSpace;
            return new THREE.MeshBasicMaterial({ map: texture });
        });
        this.cube = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), materials);
        this.scene.add(this.cube);
        for (const x of [-1, 0, 1])
            for (const y of [-1, 0, 1])
                for (const z of [-1, 0, 1]) {
                    const direction = new THREE.Vector3(x, y, z);
                    if ([x, y, z].filter(Boolean).length < 2) continue;
                    const mesh = new THREE.Mesh(
                        new THREE.BoxGeometry(
                            x === 0 ? 1.35 : 0.2,
                            y === 0 ? 1.35 : 0.2,
                            z === 0 ? 1.35 : 0.2,
                        ),
                        new THREE.MeshBasicMaterial({ color: '#7390a7' }),
                    );
                    mesh.position.copy(direction).multiplyScalar(0.8);
                    mesh.userData.direction = direction;
                    this.handles.push(mesh);
                    this.scene.add(mesh);
                }
        canvas.onpointermove = (event) => {
            const hit = this.hit(event),
                direction =
                    hit?.object === this.cube
                        ? new THREE.Vector3(...CUBE_FACES[hit.face!.materialIndex].direction)
                        : hit?.object.userData.direction;
            if (this.hover) (this.hover.material as THREE.MeshBasicMaterial).color.set('#7390a7');
            this.hover = hit?.object !== this.cube ? (hit?.object as THREE.Mesh) : undefined;
            if (this.hover) (this.hover.material as THREE.MeshBasicMaterial).color.set('#78ddc5');
            canvas.title = direction
                ? `${cubeViewName(direction)} view`
                : 'Click a face, edge or corner';
            canvas.style.cursor = hit ? 'pointer' : 'default';
            this.render();
        };
        canvas.onpointerleave = () => {
            if (this.hover) (this.hover.material as THREE.MeshBasicMaterial).color.set('#7390a7');
            this.hover = undefined;
            this.render();
        };
        canvas.onclick = (event) => {
            const hit = this.hit(event);
            if (!hit) return;
            const direction =
                hit.object === this.cube
                    ? new THREE.Vector3(...CUBE_FACES[hit.face!.materialIndex].direction)
                    : hit.object.userData.direction.clone();
            this.choose(direction.normalize());
        };
        canvas.onkeydown = (event) => {
            const face = ({ t: 4, f: 3, l: 1, r: 0, b: 2, d: 5 } as Record<string, number>)[
                event.key.toLowerCase()
            ];
            if (face !== undefined) {
                event.preventDefault();
                this.choose(new THREE.Vector3(...CUBE_FACES[face].direction));
            }
        };
    }
    private hit(event: MouseEvent) {
        const box = this.canvas.getBoundingClientRect();
        this.raycaster.setFromCamera(
            new THREE.Vector2(
                ((event.clientX - box.left) / box.width) * 2 - 1,
                1 - ((event.clientY - box.top) / box.height) * 2,
            ),
            this.camera,
        );
        return this.raycaster.intersectObjects([this.cube, ...this.handles], false)[0];
    }
    update(main: THREE.Camera, target: THREE.Vector3) {
        this.camera.position.copy(main.position).sub(target).normalize().multiplyScalar(5);
        this.camera.quaternion.copy(main.quaternion);
        this.camera.updateMatrixWorld(true);
        this.render();
    }
    private render() {
        this.renderer.render(this.scene, this.camera);
    }
}
