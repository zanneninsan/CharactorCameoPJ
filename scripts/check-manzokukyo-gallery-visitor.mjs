import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVisitorState, advanceVisitor, visitorBounds, loadGalleryVisitor } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-visitor.js';
import * as T from '../content/static-sites/zannenin/manzokukyo-preview/vendor/three.module.js';
import { GLTFLoader } from '../content/static-sites/zannenin/manzokukyo-preview/vendor/GLTFLoader.js';

const bytes = await readFile(new URL('../content/characters/zannenin/assets/models/darenin-gallery.glb', import.meta.url));
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const scene = gltf.scene;
scene.updateMatrixWorld(true);
const meshes = [], bones = [];
scene.traverse(object => { if (object.isMesh) meshes.push(object); if (object.isBone) bones.push(object); });
assert.equal(meshes.length, 1, 'one skinned drawing instead of 63');
assert.ok(meshes[0].isSkinnedMesh, 'walking rig survives compression');
assert.ok(bytes.length < 140000, 'committed model stays below 140 KB');
assert.ok(meshes[0].geometry.attributes.color, 'all face and clothing colors survive material merging');
assert.equal(meshes[0].material.map, null, 'no image texture or decoder download');
meshes[0].skeleton.update();
const restBounds = new T.Box3().setFromObject(scene);
assert.ok(restBounds.max.y - restBounds.min.y > 1.6 && restBounds.max.y - restBounds.min.y < 1.8, 'quantized skin keeps original height');
assert.ok(restBounds.max.x - restBounds.min.x > .5 && restBounds.max.x - restBounds.min.x < .8, 'quantized skin keeps original width');
for (const name of ['J_Bip_C_Head', 'J_Bip_L_UpperLeg', 'J_Bip_R_UpperLeg', 'J_Bip_L_UpperArm', 'J_Bip_R_UpperArm']) assert.ok(bones.some(b => b.name === name), `${name} can animate`);
scene.getObjectByName('J_Bip_L_UpperLeg').rotation.x = .3;
scene.updateMatrixWorld(true); meshes[0].skeleton.update(); meshes[0].computeBoundingBox();
const animatedBounds = new T.Box3().setFromObject(scene);
assert.ok([...animatedBounds.min.toArray(), ...animatedBounds.max.toArray()].every(Number.isFinite));
assert.ok(animatedBounds.max.y < 1.8 && animatedBounds.min.y > -.1, 'animated quantization does not explode the skin');

let totalDecisions = 0;
for (let seed = 1; seed <= 24; seed++) {
  let rng = seed;
  const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
  const state = createVisitorState();
  for (let step = 0; step < 18000; step++) {
    advanceVisitor(state, 1 / 30, { x: Math.sin(step / 700) * 3, z: -30 }, random);
    assert.ok([state.x, state.z, state.yaw, state.speed].every(Number.isFinite));
    assert.ok(state.x >= visitorBounds.left && state.x <= visitorBounds.right, 'stays clear of frames and pillars');
    assert.ok(state.z >= visitorBounds.back && state.z <= visitorBounds.front, 'does not walk through end doors');
  }
  assert.ok(state.decisions > 5, 'does not get stuck at one destination');
  totalDecisions += state.decisions;
}
const paused = createVisitorState(), before = JSON.stringify(paused);
advanceVisitor(paused, NaN, { x: 0, z: 0 });
assert.equal(JSON.stringify(paused), before, 'invalid time cannot poison positions');
const yielding = createVisitorState(); yielding.wait = 0; yielding.targetX = 3; yielding.targetZ = -10;
advanceVisitor(yielding, .05, { x: yielding.x, z: yielding.z });
assert.equal(yielding.behavior, 'yielding');
assert.equal(yielding.x, 1.65); assert.equal(yielding.z, -5.4);
// Exercise the actual loader/controller, including GPU-resource cleanup, with
// an in-memory URL so this test needs neither a browser nor a running server.
globalThis.ProgressEvent ??= class extends Event { constructor(type, detail) { super(type); Object.assign(this, detail); } };
const visitorScene = new T.Scene();
const visitor = await loadGalleryVisitor(T, { scene: visitorScene, Loader: GLTFLoader, url: new URL(`data:model/gltf-binary;base64,${bytes.toString('base64')}`) });
const camera = new T.PerspectiveCamera(49, 16 / 9, .1, 100); camera.position.set(0, 2.32, .8);
for (const mode of [{ paused: true }, { reduced: true }, { inspecting: true }]) {
  const before = visitor.snapshot().position;
  for (let i = 0; i < 200; i++) visitor.update(.05, camera.position, mode);
  assert.deepEqual(visitor.snapshot().position, before, 'overlays and reduced motion pause wandering');
}
visitor.update(.05, camera.position, { camera }); assert.equal(visitor.isVisible(), true);
camera.rotation.y = Math.PI; visitor.update(.05, camera.position, { camera }); assert.equal(visitor.isVisible(), false, 'looking away stops drawing the model');
visitor.setEnabled(false); const disabled = visitor.snapshot().position;
for (let i = 0; i < 200; i++) visitor.update(.05, camera.position);
assert.equal(visitor.isVisible(), false); assert.deepEqual(visitor.snapshot().position, disabled);
visitor.setEnabled(true);
for (let i = 0; i < 500; i++) visitor.update(.05, camera.position);
assert.ok(visitor.snapshot().decisions > 0);
visitor.reset(); assert.deepEqual(visitor.snapshot().position, [1.65, -5.4]);
visitor.dispose(); assert.equal(visitorScene.children.length, 0, 'leaving the page removes model and shadow');
assert.equal(visitor.update(.05, camera.position), false, 'disposed character cannot restart');
console.log(`Gallery visitor: model/rig/bounds valid; 24 ten-minute walks, ${totalDecisions} decisions, no wall crossings or stalls.`);
