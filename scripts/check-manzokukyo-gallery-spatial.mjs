import assert from 'node:assert/strict';
import * as T from '../content/static-sites/zannenin/manzokukyo-preview/vendor/three.module.js';
import { mountGallerySpatial } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-spatial.js';
import { galleryFrameZ, advanceWalk } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-walk.js';
import { loopExit, chooseAnomaly, judgeLoop, newLoop } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-loop.js';

assert.equal(galleryFrameZ(0), -4.8); assert.equal(galleryFrameZ(1), -4.8);
assert.equal(galleryFrameZ(4), -12); assert.equal(galleryFrameZ(6), -19);
for (let i = 0; i < 22; i += 2) assert.ok(galleryFrameZ(i) - galleryFrameZ(i + 2) > 3.5, 'full frames do not overlap after making entrance space');
const scene = new T.Scene(), exitGroup = new T.Group(), extension = new T.Group(); scene.add(exitGroup, extension);
const frames = Array.from({ length: 24 }, (_, index) => {
  const side = index % 2 ? 1 : -1, group = new T.Group(); group.position.set(side * 5.13, 2.82, galleryFrameZ(index)); group.rotation.y = -side * Math.PI / 2; scene.add(group);
  const surface = new T.MeshBasicMaterial(); surface.map = new T.Texture();
  const painting = new T.Mesh(new T.PlaneGeometry(2.12, 2.98), surface); painting.userData.index = index; group.add(painting);
  return { index, group, painting, surface };
});
const spatial = mountGallerySpatial(T, { frames, exitGroup, extension }), camera = new T.PerspectiveCamera(); camera.position.set(0, 2.32, .8);
spatial.reset({ kind: 'receding-exit' });
let oldOffset = 0, grew = false, reached = false;
for (let i = 0; i < 700; i++) {
  const next = advanceWalk(camera.position, 0, new Set(['forward', 'sprint']), .05, spatial.walkLimit);
  camera.position.x = next.x; camera.position.z = next.z; spatial.track(camera);
  assert.ok(spatial.exitOffset >= oldOffset && spatial.exitOffset <= 18); oldOffset = spatial.exitOffset;
  if (camera.position.z < -44 && camera.position.z > -52) grew ||= 64.07 + spatial.exitOffset + camera.position.z > 20.1;
  if (camera.position.z > -80.1) assert.notEqual(loopExit(camera.position, spatial.exitOffset), 'forward', 'the former exit position cannot finish the extended corridor');
  if (loopExit(camera.position, spatial.exitOffset) === 'forward') { reached = true; break; }
}
assert.ok(grew && reached, 'the exit visibly retreats but remains reachable even when the player chooses wrongly');
camera.position.z = -30; spatial.track(camera); assert.equal(spatial.exitOffset, 18, 'retreat does not pull the wall toward the player');
camera.position.z = 2.8; assert.equal(loopExit(camera.position, spatial.exitOffset), 'back');
spatial.reset(null); assert.equal(exitGroup.position.z, 0); assert.equal(extension.visible, false); assert.equal(spatial.walkLimit, 0);

for (const index of [0, 1, 22, 23]) {
  const frame = frames[index], base = frame.group.position.clone(), originalRotation = frame.group.quaternion.clone();
  camera.position.set(0, 2.32, galleryFrameZ(index) + 4);
  spatial.reset({ kind: 'approaching-portrait', index });
  frame.surface.map = null; spatial.update(.05, camera); assert.ok(frame.group.position.equals(base)); frame.surface.map = new T.Texture();
  for (let i = 0; i < 200; i++) spatial.update(.05, camera);
  const distance = frame.group.position.distanceTo(base); assert.ok(distance > 2.5 && distance <= 2.601, 'the selected portrait advances a bounded distance');
  assert.ok(frame.group.position.distanceTo(camera.position) < base.distanceTo(camera.position) - 2);
  scene.updateMatrixWorld(true);
  const ray = new T.Raycaster(camera.position, frame.group.position.clone().sub(camera.position).normalize());
  assert.equal(ray.intersectObject(frame.painting)[0]?.object.userData.index, index, 'the moving painting retains its actual clickable target');
  const frozen = frame.group.matrixWorld.clone(); camera.position.x = 1;
  spatial.update(1, camera, { paused: true }); scene.updateMatrixWorld(true); assert.ok(frame.group.matrixWorld.equals(frozen));
  spatial.reset(null); assert.ok(frame.group.position.equals(base)); assert.ok(frame.group.quaternion.equals(originalRotation));
  spatial.reset({ kind: 'approaching-portrait', index }); spatial.update(.05, camera, { reduced: true });
  assert.ok(frame.group.position.distanceTo(base) > 2, 'reduced motion retains a static visible clue');
  spatial.reset(null);
}
for (const [kind, draw] of [['receding-exit', 5.5 / 7], ['approaching-portrait', 6.5 / 7]]) {
  const values = [.8, draw, .2], anomaly = chooseAnomaly(() => values.shift()); assert.equal(anomaly.kind, kind);
  assert.ok(judgeLoop({ ...newLoop(), round: 1, anomaly }, 'back').correct);
}
console.log('Spatial anomalies passed: entrance spacing, receding exit and reachable boundaries, portrait motion/raycast/pause/reduced motion, and full reset.');
