import assert from 'node:assert/strict';
import * as T from '../content/static-sites/zannenin/manzokukyo-preview/vendor/three.module.js';
import { mountGallerySpatial } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-spatial.js';
import { mountGallerySand } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-sand.js';
import { galleryFrameZ } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-walk.js';
import { galleryDebugOptions, validateDebugSelection, judgeLoop, newLoop } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-loop.js';

const scene = new T.Scene(), exitGroup = new T.Group(), extension = new T.Group(); scene.add(exitGroup, extension);
const frames = Array.from({ length: 24 }, (_, index) => {
  const group = new T.Group(), side = index % 2 ? 1 : -1;
  group.position.set(side * 5.13, 2.82, galleryFrameZ(index)); group.rotation.y = -side * Math.PI / 2; scene.add(group);
  const surface = new T.MeshBasicMaterial({ map: new T.Texture() });
  const painting = new T.Mesh(new T.PlaneGeometry(2.12, 2.98), surface); painting.userData.index = index; group.add(painting);
  return { index, group, painting, surface, width: 2.12, height: 2.98, erosion: { value: 0 } };
});
const original = frames.map(f => ({ position: f.group.position.clone(), rotation: f.group.quaternion.clone() }));
const spatial = mountGallerySpatial(T, { frames, exitGroup, extension }), camera = new T.PerspectiveCamera(49, 1.5, .1, 100);
spatial.reset({ kind: 'facing-frames' });
for (const eye of [[0, 2.32, .8], [3.4, 2.32, -27], [-3.4, 2.32, -55]]) {
  camera.position.set(...eye);
  for (let i = 0; i < 150; i++) spatial.update(.05, camera);
  scene.updateMatrixWorld(true);
  for (const frame of frames) {
    const facing = new T.Vector3(0, 0, 1).applyQuaternion(frame.group.quaternion);
    const toViewer = camera.position.clone().sub(frame.group.position); toViewer.y = 0; toViewer.normalize();
    assert(facing.dot(toViewer) > .999, 'all 24 frames face the viewer, including frames already passed');
    const ray = new T.Raycaster(camera.position, frame.group.localToWorld(new T.Vector3(.1, .1, 0)).sub(camera.position).normalize());
    assert.equal(ray.intersectObject(frame.painting)[0]?.object.userData.index, frame.index);
    for (const corner of [-1.31, 1.31]) {
      const p = frame.group.localToWorld(new T.Vector3(corner, 0, -.115));
      assert(Math.abs(p.x) < 5.39, 'the entire frame remains in front of either wall');
    }
  }
}
const frozen = frames.map(f => f.group.quaternion.clone()); camera.position.z = .8;
spatial.update(.05, camera, { paused: true }); assert(frames.every((f, i) => f.group.quaternion.equals(frozen[i])));
assert.equal(spatial.update(.05, camera, { reduced: true }), false);
spatial.reset(null); assert.equal(spatial.snapshot().facingFrames, 0);
assert(frames.every((f, i) => f.group.position.equals(original[i].position) && f.group.quaternion.equals(original[i].rotation)));

const sand = mountGallerySand(T, { frames }); let group, disposedResources = 0;
for (const index of [0, 1, 22, 23]) {
  sand.setAnomaly({ kind: 'sand-painting', index });
  const nextGroup = frames[index].group.getObjectByName('Sand falling from artwork');
  if (group) assert.equal(nextGroup, group, 'switching targets reuses the particle and pile resources');
  group = nextGroup;
  assert.equal(frames.filter(f => f.erosion.value === 1).length, 1);
  camera.position.set(0, 2.32, galleryFrameZ(index)); camera.lookAt(frames[index].group.position);
  assert(sand.update(.05, camera)); const before = sand.snapshot().time;
  for (const options of [{ paused: true }, { reduced: true }]) {
    assert.equal(sand.update(.05, camera, options), false); assert.equal(sand.snapshot().time, before);
    assert.equal(group.visible, true, 'paused and reduced motion retain the pile and damaged painting');
  }
  camera.position.z = 40; sand.update(.05, camera); assert.equal(sand.snapshot().animated, false);
  assert.equal(sand.snapshot().time, before, 'distant sand stops animating');
  sand.setAnomaly(null); assert(frames.every(f => f.erosion.value === 0)); assert.equal(group.parent, null);
}
group.traverse(o => { o.geometry?.addEventListener('dispose', () => disposedResources++); o.material?.addEventListener('dispose', () => disposedResources++); });
sand.setAnomaly({ kind: 'sand-painting', index: 0 }); sand.dispose(); sand.dispose();
assert.equal(disposedResources, 6); assert.equal(group.parent, null); assert.equal(frames[0].erosion.value, 0);
assert.equal(sand.update(.05, camera), false);
for (const kind of ['ceiling-visitor', 'facing-frames', 'sand-painting']) {
  const option = galleryDebugOptions.find(o => o.kind === kind), anomaly = option.record ? { kind, index: 1 } : { kind };
  assert.deepEqual(validateDebugSelection(anomaly), anomaly);
  assert.equal(judgeLoop({ ...newLoop(), round: 1, anomaly }, 'back').correct, true);
  assert.equal(judgeLoop({ ...newLoop(), round: 1, anomaly }, 'forward').correct, false);
}
assert.equal(galleryDebugOptions.at(-3).visitors, true);
console.log('Facing frames and sand passed: all frames/both walls, raycasts, wall clearance, paused/reduced motion, bounded/reused particles, restoration, disposal, debug and judgments.');
