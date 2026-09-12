import assert from 'node:assert/strict';
import * as T from '../content/static-sites/zannenin/manzokukyo-preview/vendor/three.module.js';
import { mountFrameHand } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-hand.js';
import { chooseAnomaly, judgeLoop, newLoop, paintingAppearance, describeAnomaly } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-loop.js';
const draws = [.8, .9, .99];
const anomaly = chooseAnomaly(() => draws.shift());
assert.deepEqual(anomaly, { kind: 'frame-hand', index: 23 }, 'does not depend on NPC model loading');
assert.ok(judgeLoop({ ...newLoop(), round: 1, anomaly }, 'back').correct);
assert.ok(!judgeLoop({ ...newLoop(), round: 1, anomaly }, 'forward').correct);
assert.match(describeAnomaly(anomaly), /記録 24.*手/);
for (let i = 0; i < 24; i++) assert.deepEqual(paintingAppearance(i, anomaly), paintingAppearance(i, null), 'original artwork is unchanged');
const scene = new T.Scene(), targets = [];
const frames = Array.from({ length: 24 }, (_, i) => {
  const group = new T.Group(), side = i % 2 ? 1 : -1;
  group.position.set(side * 5.13, 2.82, -3 - Math.floor(i / 2) * 4.5);
  group.rotation.y = -side * Math.PI / 2; scene.add(group); return { group };
});
const hand = mountFrameHand(T, { frames, targets });
const camera = new T.PerspectiveCamera();
for (const index of [0, 1, 22, 23]) {
  hand.setAnomaly({ kind: 'frame-hand', index }); scene.updateMatrixWorld(true);
  assert.equal(hand.root.parent, frames[index].group);
  assert.ok(targets.length > 20 && targets.every(mesh => mesh.userData.index === index));
  const b = new T.Box3().setFromObject(hand.root), side = index % 2 ? 1 : -1;
  assert.ok(side < 0 ? b.max.x > -4.15 : b.min.x < 4.15, 'hand extends a metre out into the corridor on either wall');
  camera.position.copy(frames[index].group.position); camera.position.x = 0;
  assert.equal(hand.update(.05, camera), true);
  const finger = hand.root.children.find(child => child.isGroup);
  const angle = finger.rotation.x;
  hand.update(1, camera, { paused: true }); assert.equal(finger.rotation.x, angle);
  hand.update(1, camera, { reduced: true }); assert.equal(finger.rotation.x, angle);
  scene.updateMatrixWorld(true);
  const palm = targets.find(mesh => mesh.position.y === -.08);
  const at = palm.getWorldPosition(new T.Vector3());
  const ray = new T.Raycaster(camera.position, at.clone().sub(camera.position).normalize());
  assert.equal(ray.intersectObjects(targets)[0].object.userData.index, index, 'the actual hand opens the matching painting');
  hand.setAnomaly(null);
  assert.equal(targets.length, 0); assert.equal(hand.root.parent, null); assert.equal(hand.root.visible, false);
}
for (const index of [NaN, -1, 24, null, '1']) { hand.setAnomaly({ kind: 'frame-hand', index }); assert.equal(hand.root.visible, false); }
hand.setAnomaly(anomaly);
const resources = new Set(targets.flatMap(mesh => [mesh.geometry, mesh.material]));
assert.equal(resources.size, 5, 'all parts share two geometries and three materials');
let disposed = 0; for (const resource of resources) resource.addEventListener('dispose', () => disposed++);
hand.dispose(); hand.dispose(); assert.equal(disposed, 5); assert.equal(targets.length, 0);
assert.equal(hand.update(.05, camera), false);
console.log('Frame hand passed: draw/judgment, 24-record mapping, both wall orientations, real raycast, paused/reduced motion, reset and shared-resource disposal.');
