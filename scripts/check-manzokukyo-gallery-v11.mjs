import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../content/static-sites/zannenin/manzokukyo-preview/vendor/three.module.js';
import { GLTFLoader } from '../content/static-sites/zannenin/manzokukyo-preview/vendor/GLTFLoader.js';
import { loadGalleryVisitor } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-visitor.js';

const bytes = await readFile(new URL('../content/characters/zannenin/assets/models/zannenin-v11-gallery.glb', import.meta.url));
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
assert.ok(bytes.length < 2300000, 'model remains under 2.3 MB');
assert.equal(json.asset.extras.sourceSha256, '4f81cbd4785ef31e683816f3f560aa2c9a9634dfe514145b6de00603921f96c6');
assert.ok(json.asset.extras.vrmMeta.author, 'source attribution survives conversion');
assert.ok(json.extensionsRequired.includes('EXT_texture_webp'));
assert.equal(json.images.length, 22);
assert.ok(json.images.every(image => image.mimeType === 'image/webp'));
assert.ok(json.materials.every(material => material.extensions.KHR_materials_unlit));
assert.ok(json.materials.some(material => material.alphaMode === 'BLEND'), 'eye transparency survives');
assert.equal(json.meshes.length, 23);
assert.ok(json.meshes.filter(mesh => mesh.weights).every(mesh => mesh.extras.targetNames.join() === 'Blink' && mesh.primitives.every(p => p.targets.length === 1)));

// Node has no browser image decoder. Replace only image decoding; all GLB
// geometry, quantization, skins, materials and Blink are parsed by the shipped
// GLTFLoader. Texture appearance is separately checked in the real browser.
let closed = 0;
class TestLoader extends GLTFLoader {
  constructor() {
    super();
    this.register(parser => {
      parser.loadTextureImage = async () => new T.Texture({ close() { closed++; } });
      return { name: 'TestImageDecoder' };
    });
  }
}
globalThis.ProgressEvent ??= class extends Event { constructor(type, detail) { super(type); Object.assign(this, detail); } };
const scene = new T.Scene();
const visitor = await loadGalleryVisitor(T, { scene, Loader: TestLoader, kind: 'zannenin', url: new URL(`data:model/gltf-binary;base64,${bytes.toString('base64')}`) });
const root = scene.getObjectByName('Zannenin gallery visitor');
const meshes = [], resources = new Set();
root.traverse(object => {
  if (object.isSkinnedMesh) meshes.push(object);
  if (object.geometry) resources.add(object.geometry);
  if (object.material) for (const material of [object.material].flat()) {
    resources.add(material);
    for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
  }
});
assert.equal(meshes.length, 23);
assert.equal(visitor.snapshot().draws, 23);
assert.ok(visitor.snapshot().blink);
assert.ok(meshes.every(mesh => mesh.material.isMeshBasicMaterial));
assert.equal(meshes.filter(mesh => mesh.material.map).length, 22, 'only the solid-color bare legs lack a texture');
assert.ok(root.getObjectByName('J_Bip_L_UpperArm').rotation.z > 1, 'left arm lowered from T-pose');
assert.ok(root.getObjectByName('J_Bip_R_UpperArm').rotation.z < -1, 'right arm lowered from T-pose');
const face = meshes.find(mesh => mesh.morphTargetDictionary?.Blink !== undefined);
let blinkSeen = false, maxSpan = 0;
for (let i = 0; i < 360; i++) {
  visitor.update(1 / 30, { x: 0, z: .8 });
  blinkSeen ||= face.morphTargetInfluences[0] > .9;
  if (i % 30) continue;
  root.updateMatrixWorld(true);
  for (const mesh of meshes) { mesh.skeleton.update(); mesh.computeBoundingBox(); }
  const bounds = new T.Box3().setFromObject(root), size = bounds.getSize(new T.Vector3());
  assert.ok([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite));
  assert.ok(size.y > 1.8 && size.y < 2.1, 'walking and blinking preserve body height');
  assert.ok(bounds.min.y > -.12 && bounds.min.y < .15, 'feet stay close to the floor');
  assert.ok(size.x < 2.4 && size.z < 2.4, 'posed rig does not explode');
  maxSpan = Math.max(maxSpan, size.x, size.z);
}
assert.ok(blinkSeen, 'real Blink morph animates');
const before = visitor.snapshot().position, blinkBefore = face.morphTargetInfluences[0];
visitor.update(.05, { x: 0, z: .8 }, { inspecting: true });
assert.deepEqual(visitor.snapshot().position, before);
assert.equal(face.morphTargetInfluences[0], blinkBefore);
assert.equal(visitor.isVisible(), false, 'viewing a painting hides the model');
let disposed = 0;
for (const resource of resources) resource.addEventListener('dispose', () => disposed++);
visitor.dispose(); visitor.dispose();
assert.equal(disposed, resources.size, 'switching away frees each GPU resource exactly once');
assert.equal(closed, 22, 'all decoded texture bitmaps are released');
assert.equal(scene.children.length, 0);
assert.equal(visitor.update(.05, { x: 0, z: .8 }), false);
console.log(`V11 visitor: ${(bytes.length / 1e6).toFixed(2)} MB, 23 textured meshes, Blink/posed rig/floor/cleanup valid; max span ${maxSpan.toFixed(2)} m.`);
