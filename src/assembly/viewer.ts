/// <reference lib="dom" />
import { AssemblyViewCube, cubeViewName } from './view-cube';
import { measureAssemblyPoints } from './measurement';
import { optimizeAssemblyPart } from './optimize';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLLoader } from 'three/examples/jsm/loaders/VRMLLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import type { AssemblyView } from '../synth/Assembly';
import type { PreparedAssembly, PreparedPart } from './prepare';

const element = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;
const canvas = element<HTMLCanvasElement>('viewport');
const renderQuery = new URLSearchParams(location.search);
if (renderQuery.has('render')) document.body.classList.add('render-only');
element<HTMLSelectElement>('views').disabled = true;
const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    logarithmicDepthBuffer: true,
    preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#111820');
let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = new THREE.PerspectiveCamera(
    45,
    1,
    0.1,
    1e7,
);
camera.up.set(0, 0, 1);
let controls = new OrbitControls<THREE.PerspectiveCamera | THREE.OrthographicCamera>(
    camera,
    canvas,
);
controls.enableDamping = false;
const ambient = new THREE.HemisphereLight(0xffffff, 0x6a7b8b, 2.5);
ambient.position.set(0, 0, 1);
scene.add(ambient);
const light = new THREE.DirectionalLight(0xffffff, 3);
light.position.set(400, -300, 900);
scene.add(light);
const fill = new THREE.DirectionalLight(0x9cbde3, 1.5);
fill.position.set(-500, 400, 300);
scene.add(fill);
const roots = new Map<string, THREE.Group>();
const rows = new Map<string, HTMLElement>();
const parts = new Map<string, PreparedPart>();
let manifest: PreparedAssembly;
let selected: string | undefined;
const editedPlacements = new Set<string>();
let highlight: THREE.Box3Helper | undefined;
let measuring = false;
let points: THREE.Vector3[] = [];
let measurementGroup = new THREE.Group();
scene.add(measurementGroup);
const raycaster = new THREE.Raycaster();
let viewSpan = 500;
let activeView = '';
let drawPending = false;
function updateClip() {
    const box = bounds([...roots.values()], false);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const distance = camera.position.distanceTo(center);
    camera.near = Math.max(0.1, distance - radius * 1.5);
    camera.far = Math.max(camera.near + 1, distance + radius * 3);
    camera.updateProjectionMatrix();
}
function draw() {
    if (drawPending) return;
    drawPending = true;
    requestAnimationFrame(() => {
        drawPending = false;
        updateClip();
        renderer.render(scene, camera);
        if (!renderQuery.has('render')) viewCube.update(camera, controls.target);
    });
}
function bindControls() {
    controls.enableDamping = false;
    controls.addEventListener('change', draw);
    controls.addEventListener('start', clearActiveView);
}
function clearActiveView() {
    activeView = '';
    element<HTMLSelectElement>('views').value = '';
}
function replaceControls(target: THREE.Vector3) {
    controls.dispose();
    controls = new OrbitControls(camera, canvas);
    controls.target.copy(target);
    bindControls();
}
bindControls();
function syncProjection() {
    const ortho = camera instanceof THREE.OrthographicCamera;
    element('projection-label').textContent = ortho ? 'Orthographic' : 'Perspective';
    element('projection').setAttribute(
        'aria-label',
        `Switch to ${ortho ? 'perspective' : 'orthographic'} projection`,
    );
}
const viewCube = new AssemblyViewCube(element<HTMLCanvasElement>('view-cube'), (direction) => {
    const distance = Math.max(camera.position.distanceTo(controls.target), 1),
        target = controls.target.clone();
    camera.up.set(0, 0, 1);
    if (Math.abs(direction.z) > 0.999) camera.up.set(0, direction.z > 0 ? 1 : -1, 0);
    camera.position.copy(target).addScaledVector(direction, distance);
    replaceControls(target);
    camera.lookAt(target);
    controls.update();
    clearActiveView();
    element('cube-status').textContent = `${cubeViewName(direction)} view`;
    draw();
});
element('projection').onclick = () => {
    const target = controls.target.clone(),
        direction = camera.position.clone().sub(target);
    const up = camera.up.clone(),
        distance = Math.max(direction.length(), 1);
    if (camera instanceof THREE.PerspectiveCamera) {
        viewSpan =
            (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / camera.zoom;
        camera = new THREE.OrthographicCamera();
        camera.position.copy(target).add(direction);
    } else {
        const span = viewSpan / camera.zoom;
        camera = new THREE.PerspectiveCamera(45);
        camera.position
            .copy(target)
            .addScaledVector(direction.normalize(), span / (2 * Math.tan(Math.PI / 8)));
    }
    camera.up.copy(up);
    replaceControls(target);
    camera.lookAt(target);
    controls.update();
    clearActiveView();
    syncProjection();
    resize();
};
function resize() {
    const box = canvas.parentElement!.getBoundingClientRect();
    renderer.setSize(box.width, box.height, false);
    if (camera instanceof THREE.PerspectiveCamera) camera.aspect = box.width / box.height;
    else {
        camera.left = (-viewSpan * box.width) / box.height / 2;
        camera.right = -camera.left;
        camera.top = viewSpan / 2;
        camera.bottom = -viewSpan / 2;
    }
    camera.updateProjectionMatrix();
    draw();
}
new ResizeObserver(resize).observe(canvas.parentElement!);
function visibleInScene(object: THREE.Object3D): boolean {
    for (let node: THREE.Object3D | null = object; node; node = node.parent)
        if (!node.visible) return false;
    return true;
}
function bounds(objects: THREE.Object3D[], precise = true) {
    const box = new THREE.Box3();
    const visited = new Set<THREE.Object3D>();
    for (const root of objects)
        root.traverse((object) => {
            if (!(object instanceof THREE.Mesh) || visited.has(object) || !visibleInScene(object))
                return;
            visited.add(object);
            box.union(new THREE.Box3().setFromObject(object, precise));
        });
    return box;
}
function ancestors(id: string): string[] {
    const result: string[] = [];
    let parent = parts.get(id)?.group;
    while (parent) {
        result.push(parent);
        parent = parts.get(parent)?.group;
    }
    return result;
}
function related(id: string, target: string): boolean {
    return id === target || ancestors(id).includes(target) || ancestors(target).includes(id);
}

function fit(objects: THREE.Object3D[]) {
    const box = bounds(objects);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(22.5))) * 1.15;
    if (camera instanceof THREE.OrthographicCamera) {
        viewSpan = radius * 2.3;
        camera.zoom = 1;
        resize();
    }
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 1) direction.set(1, -1.5, 1.1);
    camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
    updateClip();
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
    draw();
}
function setVisible(id: string, visible: boolean) {
    const root = roots.get(id);
    if (root) root.visible = visible;
    parts.get(id)!.visible = visible;
    rows.get(id)!.querySelector<HTMLInputElement>('input')!.checked = visible;
    if (selected) updateSelection();
    for (const [key, row] of rows)
        row.classList.toggle('ancestor-hidden', !visibleInScene(roots.get(key) ?? scene));
    draw();
}
function updateSelection(updateFields = true) {
    if (highlight) {
        scene.remove(highlight);
        highlight.geometry.dispose();
        (highlight.material as THREE.Material).dispose();
        highlight = undefined;
    }
    const root = selected ? roots.get(selected) : undefined;
    const part = selected ? parts.get(selected) : undefined;
    element<HTMLButtonElement>('focus').disabled = !root;
    element<HTMLButtonElement>('isolate').disabled = !root;
    element('placement').hidden = !root;
    if (!root || !part) {
        element('detail').textContent = part
            ? `${part.name}\nModel unavailable.`
            : 'Select a part.';
        draw();
        return;
    }
    root.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(root, true).getSize(new THREE.Vector3());
    element('detail').textContent =
        `${part.name}\nWorld bounds: ${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)} mm`;
    if (visibleInScene(root)) {
        highlight = new THREE.Box3Helper(new THREE.Box3().setFromObject(root, true), 0x6edbc5);
        scene.add(highlight);
    }
    if (!updateFields) {
        draw();
        return;
    }
    for (const key of ['position', 'rotation'] as const) {
        element(key).replaceChildren();
        for (const [axis, label] of ['X', 'Y', 'Z'].entries()) {
            const wrapper = document.createElement('label');
            wrapper.textContent = label;
            const input = document.createElement('input');
            input.type = 'number';
            input.step = '0.1';
            input.setAttribute('aria-label', `${key} ${label}`);
            input.value = String(part[key][axis]);
            const update = () => {
                const value = input.valueAsNumber;
                if (!Number.isFinite(value)) {
                    return;
                }
                editedPlacements.add(part.id);
                part[key][axis] = value;
                applyPlacement(root, part);
                clearMeasurement();
                updateSelection(false);
                draw();
            };
            input.oninput = update;
            input.onchange = update;
            input.onblur = () => {
                input.value = String(part[key][axis]);
            };
            wrapper.append(input);
            element(key).append(wrapper);
        }
    }
    element<HTMLInputElement>('opacity').value = String(root.userData.opacity ?? 1);
    draw();
}
function select(id: string) {
    selected = id;
    for (const [key, row] of rows) row.classList.toggle('selected', key === id);
    updateSelection();
}
function applyPlacement(root: THREE.Group, part: PreparedPart) {
    root.position.fromArray(part.position);
    root.rotation.set(
        ...(part.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]),
        'XYZ',
    );
    root.updateMatrixWorld(true);
}
function clearMeasurement() {
    points = [];
    scene.remove(measurementGroup);
    measurementGroup.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((m) => m.dispose());
        }
    });
    measurementGroup = new THREE.Group();
    scene.add(measurementGroup);
    element('measurement').textContent = 'No points selected.';
    draw();
}
function measurePoint(point: THREE.Vector3) {
    if (points.length === 2) clearMeasurement();
    points.push(point);
    const radius = Math.max(
        bounds([...roots.values()])
            .getSize(new THREE.Vector3())
            .length() / 500,
        0.2,
    );
    const marker = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0x79e2ce, depthTest: false }),
    );
    marker.position.copy(point);
    marker.renderOrder = 10;
    measurementGroup.add(marker);
    if (points.length === 1)
        element('measurement').textContent = `Point 1: ${point
            .toArray()
            .map((v) => v.toFixed(3))
            .join(', ')} mm\nPick a second point.`;
    else {
        const measurement = measureAssemblyPoints(points[0].toArray(), points[1].toArray());
        const delta = new THREE.Vector3().fromArray(measurement.delta);
        const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: 0x79e2ce, depthTest: false }),
        );
        line.renderOrder = 10;
        measurementGroup.add(line);
        element('measurement').textContent =
            `${measurement.distance.toFixed(3)} mm\nΔX ${delta.x.toFixed(3)} · ΔY ${delta.y.toFixed(3)} · ΔZ ${delta.z.toFixed(3)} mm`;
    }
    draw();
}
let pointerDown = new THREE.Vector2();
canvas.addEventListener('pointerdown', (event) => pointerDown.set(event.clientX, event.clientY));
canvas.addEventListener('pointerup', (event) => {
    if (
        event.button !== 0 ||
        pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 4
    )
        return;
    const box = canvas.getBoundingClientRect();
    raycaster.setFromCamera(
        new THREE.Vector2(
            ((event.clientX - box.left) / box.width) * 2 - 1,
            (-(event.clientY - box.top) / box.height) * 2 + 1,
        ),
        camera,
    );
    const hits = raycaster.intersectObjects(
        [...roots.values()].filter((root) => !root.userData.isGroup && visibleInScene(root)),
        true,
    );
    const hit = hits.find((h) => h.object instanceof THREE.Mesh && h.object.visible);
    if (!hit) return;
    if (measuring) {
        let point = hit.point.clone();
        if (event.shiftKey && hit.face && hit.object instanceof THREE.Mesh) {
            const vertices = [hit.face.a, hit.face.b, hit.face.c].map((index) =>
                hit.object.localToWorld(
                    new THREE.Vector3().fromBufferAttribute(
                        (hit.object as THREE.Mesh).geometry.getAttribute('position'),
                        index,
                    ),
                ),
            );
            point = vertices.sort(
                (a, b) => a.distanceToSquared(point) - b.distanceToSquared(point),
            )[0];
        }
        measurePoint(point);
    } else {
        let object: THREE.Object3D | null = hit.object;
        while (object && !object.userData.partId) object = object.parent;
        if (object) select(object.userData.partId);
    }
});
function applyView(view: AssemblyView) {
    camera =
        view.projection === 'orthographic'
            ? new THREE.OrthographicCamera()
            : new THREE.PerspectiveCamera(45);
    camera.up.fromArray(view.up ?? [0, 0, 1]);
    camera.position.fromArray(view.position);
    replaceControls(new THREE.Vector3(...view.target));
    syncProjection();
    viewSpan = view.span ?? 500;
    if (view.visibleParts)
        for (const id of roots.keys())
            setVisible(
                id,
                view.visibleParts.some((target) => related(id, target)),
            );
    camera.lookAt(controls.target);
    controls.update();
    clearMeasurement();
    activeView = view.id;
    element<HTMLSelectElement>('views').value = view.id;
    resize();
}
element<HTMLSelectElement>('views').onchange = (event) => {
    const id = (event.target as HTMLSelectElement).value;
    const view = manifest.views?.find((view) => view.id === id);
    if (view) applyView(view);
    else activeView = '';
};
element('fit').onclick = () => fit([...roots.values()]);
element('show').onclick = () => {
    for (const id of roots.keys()) setVisible(id, true);
};
element('focus').onclick = () => {
    if (selected && roots.has(selected)) fit([roots.get(selected)!]);
};
element('isolate').onclick = () => {
    for (const id of roots.keys()) setVisible(id, selected ? related(id, selected) : false);
};
element('measure').onclick = () => {
    measuring = !measuring;
    element('measure').setAttribute('aria-pressed', String(measuring));
    element('hud').textContent = measuring
        ? 'Click two surfaces · Shift snaps to a triangle vertex'
        : 'Drag to orbit · Right drag to pan · Scroll to zoom';
};
element('clear').onclick = clearMeasurement;
element<HTMLInputElement>('opacity').oninput = (event) => {
    if (!selected) return;
    const opacity = Number((event.target as HTMLInputElement).value);
    const root = roots.get(selected)!;
    root.userData.opacity = opacity;
    root.traverse((object) => {
        if (object instanceof THREE.Mesh) {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
                material.opacity = opacity;
                material.transparent = opacity < 1;
                material.depthWrite = opacity === 1;
            });
        }
    });
    draw();
};
element('save-view').onclick = () => {
    renderer.render(scene, camera);
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${activeView || 'assembly-view'}.png`;
    link.click();
};
element('download').onclick = () => {
    const data = {
        name: manifest.name,
        unit: 'mm',
        parts: [...parts.values()].map(({ id, position, rotation, visible }) => ({
            id,
            position,
            rotation,
            visible,
        })),
    };
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'assembly-placements.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const refreshStateKey = 'pcb-assembly-live-view';
function saveLiveView() {
    sessionStorage.setItem(
        refreshStateKey,
        JSON.stringify({
            position: camera.position.toArray(),
            target: controls.target.toArray(),
            up: camera.up.toArray(),
            projection: camera instanceof THREE.OrthographicCamera ? 'orthographic' : 'perspective',
            span: viewSpan,
            zoom: camera.zoom,
            activeView,
            selected,
            parts: [...parts.values()].map((p) => ({
                id: p.id,
                visible: p.visible,
                opacity: roots.get(p.id)?.userData.opacity,
                ...(editedPlacements.has(p.id)
                    ? { position: p.position, rotation: p.rotation }
                    : {}),
            })),
        }),
    );
}
function restoreLiveView() {
    const saved = sessionStorage.getItem(refreshStateKey);
    sessionStorage.removeItem(refreshStateKey);
    if (!saved) return;
    try {
        const state = JSON.parse(saved);
        for (const placement of state.parts ?? []) {
            const part = parts.get(placement.id),
                root = roots.get(placement.id);
            if (!part || !root) continue;
            if (placement.position && placement.rotation) {
                part.position = placement.position;
                part.rotation = placement.rotation;
                editedPlacements.add(part.id);
                applyPlacement(root, part);
            }
            setVisible(part.id, placement.visible);
            if (Number.isFinite(placement.opacity)) {
                root.userData.opacity = placement.opacity;
                root.traverse((o) => {
                    if (o instanceof THREE.Mesh)
                        for (const material of Array.isArray(o.material)
                            ? o.material
                            : [o.material]) {
                            material.opacity = placement.opacity;
                            material.transparent = placement.opacity < 1;
                        }
                });
            }
        }
        applyView({
            id: state.activeView ?? '',
            position: state.position,
            target: state.target,
            up: state.up,
            projection: state.projection,
            span: state.span,
        });
        camera.zoom = state.zoom;
        camera.updateProjectionMatrix();
        if (state.selected && parts.has(state.selected)) select(state.selected);
    } catch (error) {
        console.warn('Could not restore assembly view', error);
    }
}
async function checkRevision() {
    try {
        const response = await fetch('/revision.json');
        if (!response.ok) return;
        const state = await response.json();
        element<HTMLButtonElement>('refresh').disabled = state.refreshing;
        element('refresh-status').textContent = state.error
            ? `Refresh failed: ${state.error}`
            : state.refreshing
              ? 'Refreshing PCB models and projected panels…'
              : '';
        element('refresh-status').classList.toggle('error', Boolean(state.error));
        if (state.revision !== manifest.revision && !state.refreshing) {
            saveLiveView();
            location.reload();
        }
    } catch {
        element('refresh-status').textContent =
            'Viewer connection unavailable. Current assembly is retained.';
    }
}
element('refresh').onclick = async () => {
    const button = element<HTMLButtonElement>('refresh');
    button.disabled = true;
    element('refresh-status').textContent = 'Refreshing PCB models and projected panels…';
    try {
        const response = await fetch('/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        const state = await response.json();
        if (!response.ok) throw new Error(state.error ?? 'Refresh failed');
        saveLiveView();
        location.reload();
    } catch (error) {
        element('refresh-status').textContent = String(error);
        element('refresh-status').classList.add('error');
        button.disabled = false;
    }
};
async function load(part: PreparedPart): Promise<THREE.Object3D> {
    if (part.format === 'wrl') return new VRMLLoader().loadAsync(part.url);
    if (part.format === 'obj') return new OBJLoader().loadAsync(part.url);
    if (part.format === '3mf') return new ThreeMFLoader().loadAsync(part.url);
    if (['gltf', 'glb'].includes(part.format))
        return (await new GLTFLoader().loadAsync(part.url)).scene;
    const geometry = await new STLLoader().loadAsync(part.url);
    return new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0xa7c3cc, roughness: 0.65 }),
    );
}
async function main() {
    const response = await fetch('/assembly.json');
    if (!response.ok) throw new Error('Assembly manifest could not load');
    manifest = await response.json();
    element('title').textContent = manifest.name;
    document.title = `${manifest.name} / Assembly`;
    for (const view of manifest.views ?? []) {
        const option = document.createElement('option');
        option.value = view.id;
        option.textContent = view.name ?? view.id;
        element('views').append(option);
    }
    // Create group nodes before loading models; parents may appear later in the manifest.
    for (const part of manifest.parts) parts.set(part.id, part);
    for (const part of manifest.parts.filter((p) => p.kind === 'group')) {
        const root = new THREE.Group();
        root.userData.partId = part.id;
        root.userData.isGroup = true;
        root.name = part.name;
        root.visible = part.visible;
        applyPlacement(root, part);
        roots.set(part.id, root);
    }
    for (const part of manifest.parts.filter((p) => p.kind === 'group'))
        (part.group ? roots.get(part.group)! : scene).add(roots.get(part.id)!);
    let failures = 0;
    for (const [index, part] of manifest.parts.entries()) {
        parts.set(part.id, part);
        const row = document.createElement('div');
        row.className = 'part';
        row.style.marginLeft = `${ancestors(part.id).length * 12}px`;
        if (part.kind === 'group') row.classList.add('group');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = part.visible;
        checkbox.setAttribute('aria-label', `Show ${part.name}`);
        checkbox.onchange = () => setVisible(part.id, checkbox.checked);
        const button = document.createElement('button');
        button.textContent = part.name;
        button.onclick = () => select(part.id);
        const status = document.createElement('small');
        status.textContent = `${part.kind} · loading`;
        button.append(status);
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('stroke', 'currentColor');
        icon.setAttribute('stroke-width', '1.5');
        icon.setAttribute('role', 'img');
        const category =
            part.kind === 'group'
                ? 'Assembly group'
                : part.kind === 'board'
                  ? 'Board'
                  : part.kind === 'generated'
                    ? 'Mechanical component'
                    : part.kind === 'front-panel'
                      ? 'Front panel'
                      : 'Other model';
        icon.setAttribute('aria-label', category);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute(
            'd',
            part.kind === 'group'
                ? 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z'
                : part.kind === 'board'
                  ? 'M3 5h18v14H3z M7 9h5v6H7z M15 8v8 M1 8h2 M1 16h2 M21 8h2 M21 16h2'
                  : part.kind === 'front-panel'
                    ? 'M3 4h18v16H3z M7 8h4v8H7z M16 9a2 2 0 1 0 0 4a2 2 0 1 0 0-4'
                    : part.kind === 'generated'
                      ? 'M12 2l9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10'
                      : 'M5 2h9l5 5v15H5z M14 2v6h5 M8 12h8 M8 16h8',
        );
        icon.append(path);
        row.append(checkbox, icon, button);
        rows.set(part.id, row);
        element('parts').append(row);
        try {
            if (part.kind === 'group') {
                status.textContent = 'Group · relative placement';
                continue;
            }
            const model = await load(part);
            model.scale.setScalar(part.unitScale);
            if (part.upAxis === 'y') model.rotation.x = Math.PI / 2;
            const root = new THREE.Group();
            root.name = part.name;
            root.userData.partId = part.id;
            root.add(model);
            root.visible = part.visible;
            applyPlacement(root, part);
            optimizeAssemblyPart(root);
            // Each part owns its opacity settings even when a loader shares materials.
            root.traverse((object) => {
                if (object instanceof THREE.Mesh)
                    object.material = Array.isArray(object.material)
                        ? object.material.map((m) => m.clone())
                        : object.material.clone();
            });
            roots.set(part.id, root);
            (part.group ? roots.get(part.group)! : scene).add(root);
            root.updateWorldMatrix(true, true);
            status.textContent = `${part.kind} · ${part.format.toUpperCase()}`;
        } catch (error) {
            failures++;
            row.classList.add('error');
            checkbox.disabled = true;
            status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
        }
        element('status').textContent = `Loaded ${index + 1} / ${manifest.parts.length} parts`;
        draw();
    }
    element('status').textContent =
        `${manifest.parts.filter((p) => p.kind !== 'group').length - failures} parts loaded${failures ? ` · ${failures} failed` : ''}`;
    const box = bounds([...roots.values()]);
    if (!box.isEmpty()) {
        const size = Math.max(...box.getSize(new THREE.Vector3()).toArray(), 10) * 1.5;
        const grid = new THREE.GridHelper(size, 20, 0x476270, 0x263c49);
        grid.rotation.x = Math.PI / 2;
        grid.position.z = box.min.z - 0.1;
        scene.add(grid);
        const axes = new THREE.AxesHelper(size / 8);
        scene.add(axes);
    }
    camera.position.set(1, -1.5, 1.1);
    fit([...roots.values()]);
    element('hud').textContent = 'Drag to orbit · Right drag to pan · Scroll to zoom';
    element<HTMLSelectElement>('views').disabled = false;
    const requestedView = renderQuery.get('render');
    const view = manifest.views?.find((v) => v.id === requestedView);
    if (requestedView && !view) throw new Error(`Unknown render view: ${requestedView}`);
    if (view) applyView(view);
    if (!renderQuery.has('render')) {
        restoreLiveView();
        setInterval(() => void checkRevision(), 1000);
    }
    resize();
    if (failures) document.body.dataset.renderError = `${failures} models failed to load`;
    else {
        updateClip();
        renderer.render(scene, camera);
        document.body.dataset.renderReady = 'true';
    }
}
main().catch((error) => {
    document.body.dataset.renderError = error.message;
    element('status').textContent = `Viewer failed: ${error.message}`;
    element('hud').textContent = 'Unable to load assembly';
});
