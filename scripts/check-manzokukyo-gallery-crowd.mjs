import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../content/static-sites/zannenin/manzokukyo-preview/vendor/three.module.js';
import { GLTFLoader, cloneSkeleton } from '../content/static-sites/zannenin/manzokukyo-preview/vendor/GLTFLoader.js';
import { loadGalleryVisitors, rushLanes, createRushState, advanceRush } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-visitor.js';
import { chooseAnomaly, judgeLoop, paintingAppearance, newLoop, describeAnomaly, satisfactionLabel } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-loop.js';
import { renderGallery3DExperience } from './render-manzokukyo-gallery-3d.mjs';

const html = renderGallery3DExperience({ id: 'zannenin', theme: {} }, { htmlPage: page => page, escapeHtml: String, assetVersionQuery: 'test' }).body;
assert.ok(!html.includes('data-gallery-visitor-model') && !html.includes('data-gallery-visitor-toggle'), 'both characters are always present without a selector or a way to hide the anomaly');

const anomaly = chooseAnomaly(() => .74, { visitorsReady: true });
assert.equal(anomaly.kind, 'darenin-rush');
assert.notEqual(chooseAnomaly(() => .9, { visitorsReady: false }).kind, 'darenin-rush', 'unloaded actors cannot create an invisible anomaly');
for (const direction of ['back', 'forward']) assert.equal(judgeLoop({ ...newLoop(), round: 1, anomaly }, direction).correct, direction === 'back');
assert.match(describeAnomaly(anomaly), /4体/);
for (const visitorsReady of [false, true]) {
  const allowed = visitorsReady ? ['upside-down', 'negative', 'same-image', 'satisfaction', 'frame-hand', 'darenin-rush', 'giant-darenin'] : ['upside-down', 'negative', 'same-image', 'satisfaction', 'frame-hand'];
  for (let i = 0; i < allowed.length; i++) {
    const values = [.8, (i + .5) / allowed.length, .3];
    const picked = chooseAnomaly(() => values.shift(), { visitorsReady });
    assert.equal(picked.kind, allowed[i]);
    assert.equal(judgeLoop({ ...newLoop(), round: 1, anomaly: picked }, 'back').correct, true);
    assert.equal(judgeLoop({ ...newLoop(), round: 1, anomaly: picked }, 'forward').correct, false);
  }
}
assert.equal(satisfactionLabel(null), '100％');
assert.equal(satisfactionLabel({ kind: 'satisfaction' }), 'あなた以外 100％');
assert.equal(satisfactionLabel({ kind: 'giant-darenin' }), '100％');
assert.match(describeAnomaly({ kind: 'satisfaction' }), /あなた以外/);
assert.match(describeAnomaly({ kind: 'giant-darenin' }), /巨大/);
for (let n = 0; n < 24; n++) assert.deepEqual(paintingAppearance(n, anomaly), paintingAppearance(n, null), 'the running row is the only changed exhibit');
const frozen = createRushState();
for (const mode of [{ paused: true }, { inspecting: true }]) {
  const before = structuredClone(frozen); advanceRush(frozen, .05, { z: .8 }, mode); assert.deepEqual(frozen, before);
}
advanceRush(frozen, NaN, { z: .8 }); assert.ok(Object.values(frozen).every(Number.isFinite));
advanceRush(frozen, .05, { z: .8 }, { reduced: true }); assert.equal(frozen.z, -8); assert.equal(frozen.speed, 0);

let downloads = 0, closed = 0;
class TestLoader extends GLTFLoader {
  constructor() {
    super();
    // Image decoding only is stubbed in Node; use the actual shipped skin loader.
    this.register(parser => { parser.loadTextureImage = async () => new T.Texture({ close() { closed++; } }); return { name: 'TestImageDecoder' }; });
  }
  loadAsync(...args) { downloads++; return super.loadAsync(...args); }
}
globalThis.ProgressEvent ??= class extends Event { constructor(type, detail) { super(type); Object.assign(this, detail); } };
const urls = {};
for (const [kind, file] of [['zannenin', 'zannenin-v11-gallery.glb'], ['darenin', 'darenin-gallery.glb']]) {
  const bytes = await readFile(new URL(`../content/characters/zannenin/assets/models/${file}`, import.meta.url));
  urls[kind] = new URL(`data:model/gltf-binary;base64,${bytes.toString('base64')}`);
}
const scene = new T.Scene(), steps = [];
const crowd = await loadGalleryVisitors(T, { scene, urls, Loader: TestLoader, cloneSkeleton, onStep: (...args) => steps.push(args) });
assert.equal(downloads, 2, 'four copies do not download four VRMs');
assert.equal(crowd.snapshot().count, 2);
assert.deepEqual(crowd.snapshot().people.map(actor => actor.kind), ['zannenin', 'darenin']);
assert.notDeepEqual(...crowd.snapshot().people.map(actor => actor.position));
const clones = scene.children.filter(object => object.name === 'Darenin gallery visitor');
const skins = clones.map(root => { let skin; root.traverse(object => { if (object.isSkinnedMesh) skin = object; }); return skin; });
assert.equal(skins.length, 4);
assert.equal(new Set(skins.map(mesh => mesh.geometry)).size, 1, 'all four share one geometry allocation');
assert.equal(new Set(skins.map(mesh => mesh.material)).size, 1);
assert.equal(new Set(skins.map(mesh => mesh.skeleton.bones[0])).size, 4, 'each clone has independent bones');
for (let i = 0; i < 200; i++) crowd.update(.05, { x: 0, z: .8 });
assert.ok(crowd.snapshot().people.every(actor => actor.decisions > 0));
assert.equal(steps.length, 0, 'normal visitors do not trigger the running sound');
crowd.setAnomaly(anomaly);
for (let i = 0; i < 260; i++) {
  crowd.update(.05, { x: 0, z: .8 });
  const state = crowd.snapshot();
  assert.equal(state.count, 4);
  assert.ok(state.people.every(actor => actor.kind === 'darenin'));
  assert.deepEqual(state.people.map(actor => actor.position[0]), rushLanes);
  assert.equal(new Set(state.people.map(actor => actor.position[1])).size, 1, 'row remains perfectly aligned');
  assert.ok(state.formation.z <= -4.5 && state.formation.z >= -58, 'stops ahead of the player');
  if (i === 160) {
    scene.updateMatrixWorld(true);
    for (const mesh of skins) { mesh.skeleton.update(); mesh.computeBoundingBox(); }
    for (const root of clones) {
      const size = new T.Box3().setFromObject(root).getSize(new T.Vector3());
      assert.ok(size.y > 1.7 && size.y < 2.2 && size.z < 2, 'running gait preserves skin bounds');
    }
  }
}
assert.ok(crowd.snapshot().formation.z > -4.6);
assert.ok(steps.length > 5, 'running sound follows the visible approach');
const stopped = JSON.stringify(crowd.snapshot()), soundCount = steps.length;
for (let i = 0; i < 200; i++) crowd.update(.05, { x: 0, z: .8 }, { paused: true });
assert.equal(JSON.stringify(crowd.snapshot()), stopped); assert.equal(steps.length, soundCount);
crowd.setAnomaly(anomaly); crowd.update(.05, { x: 0, z: .8 }, { reduced: true });
assert.equal(crowd.snapshot().formation.z, -8, 'reduced-motion still has a visible four-person anomaly');
assert.ok(crowd.snapshot().people.every(actor => actor.behavior === 'watching'));
crowd.setAnomaly(anomaly);
const mobile = new T.PerspectiveCamera(49, .65, .1, 100);
for (let i = 0; i < 300; i++) crowd.update(.05, { x: 0, z: .8 }, { camera: mobile });
assert.ok(crowd.snapshot().formation.z < -10, 'narrow view keeps all four within the viewing angle');
crowd.setAnomaly(null); crowd.update(.05, { x: 0, z: .8 });
assert.equal(crowd.snapshot().count, 2, 'new lap restores both usual visitors');
assert.equal(scene.children.filter(object => object.visible).length, 2);
const giant = scene.getObjectByName('Giant Darenin head');
assert.ok(giant && !giant.visible);
assert.ok(giant.geometry.attributes.position.count > 300 && giant.geometry.attributes.position.count < 9000, 'head is real model geometry and stays lightweight');
assert.equal(giant.isSkinnedMesh, undefined, 'the giant uses no extra skinning');
crowd.setAnomaly({ kind: 'giant-darenin' });
crowd.update(.05, { x: 0, z: -30 });
assert.equal(crowd.snapshot().count, 3); assert.equal(giant.visible, true);
assert.deepEqual(crowd.snapshot().people.map(actor => actor.kind), ['zannenin', 'darenin'], 'the two ordinary walkers remain');
assert.ok(giant.position.z < -47 && giant.position.z > -63, 'peeks from behind the distant arch');
scene.updateMatrixWorld(true);
const giantBounds = new T.Box3().setFromObject(giant);
assert.ok(giantBounds.max.y < 6.4 && giantBounds.min.y > 1.9 && giantBounds.min.x > -5.2, 'face is inside the visible arch opening');
const still = giant.matrixWorld.clone();
for (let i = 0; i < 20; i++) crowd.update(.05, { x: 0, z: -30 }, { paused: true });
scene.updateMatrixWorld(true); assert.ok(giant.matrixWorld.equals(still), 'modal pauses the giant');
crowd.setAnomaly({ kind: 'giant-darenin' });
crowd.update(.05, { x: 0, z: -30 }, { reduced: true }); scene.updateMatrixWorld(true);
const reducedPose = giant.matrixWorld.clone();
for (let i = 0; i < 20; i++) crowd.update(.05, { x: 0, z: -30 }, { reduced: true });
scene.updateMatrixWorld(true); assert.ok(giant.visible && giant.matrixWorld.equals(reducedPose), 'reduced motion retains the clue without swaying');
crowd.setAnomaly(null); assert.equal(giant.visible, false); assert.equal(crowd.snapshot().count, 2);
assert.equal(downloads, 2, 'giant reuses the loaded model');
let geometryDisposals = 0, finishDisposals = 0;
skins[0].geometry.addEventListener('dispose', () => geometryDisposals++);
skins[0].material.addEventListener('dispose', () => finishDisposals++);
crowd.dispose(); crowd.dispose();
assert.equal(scene.children.length, 0); assert.equal(geometryDisposals, 1); assert.equal(finishDisposals, 1); assert.equal(closed, 22);
assert.equal(crowd.update(.05, { x: 0, z: .8 }), false);
class FailingLoader extends TestLoader {
  loadAsync(url) { return url === urls.darenin.href ? Promise.reject(Error('missing rough model')) : super.loadAsync(url); }
}
await assert.rejects(loadGalleryVisitors(T, { scene, urls, Loader: FailingLoader, cloneSkeleton }), /missing rough model/);
assert.equal(scene.children.length, 0);
assert.equal(closed, 44, 'partially successful loading also releases decoded images');
console.log('Gallery crowd: two normal visitors; four shared-mesh runners; anomaly judgment, loading guard, alignment, sound, pause, reduced motion, restoration and disposal passed.');
