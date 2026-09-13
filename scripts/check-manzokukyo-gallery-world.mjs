import assert from 'node:assert/strict';
import * as T from '../content/static-sites/zannenin/manzokukyo-preview/vendor/three.module.js';
import { mountGalleryWorld, worldWindowCamera } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-world.js';
import { galleryDebugOptions, chooseAnomaly, judgeLoop, newLoop } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-loop.js';

const shot = new T.PerspectiveCamera(), width = 2.12, height = width * 1080 / 768;
const projected = [];
for (const eye of [new T.Vector3(-1, .2, 4), new T.Vector3(1, -.4, 4), new T.Vector3(0, 0, .15)]) {
  worldWindowCamera(T, shot, eye, width, height);
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const edge = new T.Vector3(x * width / 2, y * height / 2, 0).project(shot);
    assert(Math.abs(edge.x - x) < 1e-6 && Math.abs(edge.y - y) < 1e-6, 'portal edges stay fixed instead of sliding with the landscape');
  }
  projected.push(new T.Vector3(0, 0, -8).project(shot).x);
}
assert(Math.abs(projected[0] - projected[1]) > .5, 'objects beyond the aperture show actual lateral parallax');
const root = new T.Scene();
const frames = [-1, 1].map((side, index) => {
  const group = new T.Group(); group.position.set(side * 5.13, 2.82, -6); group.rotation.y = -side * Math.PI / 2; root.add(group);
  return { group, index, width, height };
});
const targets = [], requests = [], stops = [];
let sound = { enabled: false, effectsVolume: .65 };
const portal = mountGalleryWorld(T, { frames, targets, gallery: { state: () => ({ sound }), play: (name, options) => { requests.push({ name, options }); return () => stops.push(name); } } });
const viewer = new T.PerspectiveCamera(49, 1, .1, 100);
function face(frame, distance = 4) {
  root.updateMatrixWorld(true); viewer.position.copy(frame.group.localToWorld(new T.Vector3(0, 0, distance))); viewer.lookAt(frame.group.position); viewer.updateMatrixWorld(true);
}
const drawTargets = [], views = [];
let currentTarget = null;
const renderer = { getRenderTarget: () => currentTarget, setRenderTarget: t => { currentTarget = t; }, render: (scene, camera) => { drawTargets.push(currentTarget); views.push(camera.projectionMatrix.clone()); } };
for (const frame of frames) {
  portal.setAnomaly({ kind: 'other-world', index: frame.index }); face(frame);
  assert.equal(targets.length, 1); assert.equal(targets[0].parent, frame.group);
  assert.equal(portal.update(.05, viewer), true); portal.render(renderer, viewer);
  assert.equal(currentTarget, null, 'offscreen drawing restores the main target');
  root.updateMatrixWorld(true);
  const ray = new T.Raycaster(viewer.position, frame.group.position.clone().sub(viewer.position).normalize());
  assert.equal(ray.intersectObjects(targets)[0].object.userData.index, frame.index, 'the window retains the correct inspection/seal target on either wall');
}
assert.equal(new Set(drawTargets).size, 1, 'switching walls reuses the same render target');
assert.equal(requests.length, 0, 'sound off never starts a gust');
sound.enabled = true; portal.update(.05, viewer); assert.equal(requests.length, 1); assert.equal(requests[0].name, 'gallery-world-wind');
portal.update(.05, viewer, { paused: true }); assert.equal(stops.length, 1, 'inspection pauses the breeze');
const beforePause = drawTargets.length;
portal.update(.05, viewer, { reduced: true }); portal.render(renderer, viewer); const still = drawTargets.length;
portal.update(.05, viewer, { reduced: true }); portal.render(renderer, viewer); assert.equal(drawTargets.length, still, 'reduced motion does not redraw a static landscape');
assert(still >= beforePause);
sound.enabled = false; portal.update(.05, viewer); assert.equal(portal.snapshot().windPlaying, false);
sound.enabled = true; face(frames[1], 20); assert.equal(portal.update(.05, viewer), false, 'distant windows stop animation and sound');
face(frames[1]); portal.update(.05, viewer); viewer.lookAt(viewer.position.clone().add(new T.Vector3(-1, 0, 0))); viewer.updateMatrixWorld(true);
portal.update(.05, viewer); assert.equal(portal.snapshot().visible, false); assert.equal(portal.snapshot().windPlaying, false, 'looking away stops the breeze');
portal.setAnomaly(null); assert.equal(targets.length, 0); assert.equal(portal.snapshot().record, null);
portal.setAnomaly({ kind: 'other-world', index: 0 }); portal.dispose(); assert.equal(targets.length, 0); portal.dispose();
const total = galleryDebugOptions.filter(option => !option.visitors && option.kind !== 'normal').length;
const draws = [.8, (total - .5) / total, .4], anomaly = chooseAnomaly(() => draws.shift());
assert.equal(anomaly.kind, 'other-world'); assert.equal(anomaly.index, 9);
assert.equal(judgeLoop({ ...newLoop(), round: 1, anomaly }, 'back').correct, true);
console.log('Framed world passed: off-axis parallax, both walls, raycast identity, bounded target reuse, consent/nearby sound, pause/reduced motion, cleanup and anomaly judgment.');
