import assert from 'node:assert/strict';
import * as T from '../content/static-sites/zannenin/manzokukyo-preview/vendor/three.module.js';
import { mountGalleryDecor } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-decor.js';
import { mountGallerySpatial } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-spatial.js';

const context = new Proxy({}, { get: (_, key) => key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const scene = new T.Scene(), exitGroup = new T.Group(), extension = new T.Group(); scene.add(exitGroup, extension);
const geometry = new Set(), textures = new Set(), materials = new Set();
const cube = new T.BoxGeometry(), plane = new T.PlaneGeometry(); geometry.add(cube); geometry.add(plane);
const material = options => { const m = new T.MeshStandardMaterial(options); materials.add(m); return m; };
const basic = options => { const m = new T.MeshBasicMaterial(options); materials.add(m); return m; };
const box = (parent, size, at, m) => { const mesh = new T.Mesh(cube, m); mesh.scale.set(...size); mesh.position.set(...at); parent.add(mesh); return mesh; };
const decor = mountGalleryDecor(T, { scene, exitGroup, extension, geometry, textures, material, basic, box, plane, gold: material({}), black: material({}) });
const spatial = mountGallerySpatial(T, { frames: [], exitGroup, extension });
const camera = new T.PerspectiveCamera();
spatial.reset(null);
const lights = scene.children.filter(child => child.isPointLight);
assert.equal(lights.length, 2, 'fixture count must not multiply the real light budget');
const initialGeometry = geometry.size;
for (let z = 2; z >= -81; z -= .25) {
  camera.position.set(0, 2.32, z); decor.update(camera);
  for (const light of lights) {
    assert(light.position.z >= -61, 'hidden extension must not illuminate the normal room');
    assert.equal(light.castShadow, false);
    assert(Number.isFinite(light.intensity) && light.intensity >= 0 && light.intensity <= 48);
  }
}
const door = exitGroup.getObjectByName('Brass arched archive door');
scene.updateMatrixWorld(true); const original = new T.Box3().setFromObject(door);
assert(original.max.y < 5.1 && original.min.y >= -.02, 'arch fits below the label and above the floor');
assert(original.max.z < -63.6, 'all door ornaments remain beyond the exit trigger');
spatial.reset({ kind: 'receding-exit' }); camera.position.z = -78; spatial.track(camera); decor.update(camera); scene.updateMatrixWorld(true);
const receded = new T.Box3().setFromObject(door);
assert(Math.abs(receded.min.z - original.min.z + 18) < 1e-6, 'the entire decorated door follows the retreating wall');
assert.equal(decor.snapshot().fixtures, 10); assert(lights.some(light => light.position.z === -77));
spatial.reset(null); decor.update(camera); scene.updateMatrixWorld(true);
assert.equal(decor.snapshot().fixtures, 8); assert(new T.Box3().setFromObject(door).equals(original));
assert.equal(geometry.size, initialGeometry, 'moving and resetting reuse all fixture geometry');
let batches = 0, disposed = 0;
scene.traverse(object => { if (object.isInstancedMesh) { batches++; object.addEventListener('dispose', () => disposed++); } });
decor.dispose(); assert.equal(disposed, batches, 'instance buffers are released with the gallery');
for (const resource of [...geometry, ...textures, ...materials]) resource.dispose();
console.log('Gallery decor passed: fixed light budget, hidden extension, door clearance, receding/reset alignment, resource reuse and disposal.');
