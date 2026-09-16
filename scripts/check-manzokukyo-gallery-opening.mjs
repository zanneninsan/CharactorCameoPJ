import assert from 'node:assert/strict';
import * as T from '../content/static-sites/zannenin/manzokukyo-preview/vendor/three.module.js';
import { arrivalPose, createGalleryArrival, mountGalleryOpening, openingKey } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-opening.js';

// Check the actual door geometry: it opens before the camera crosses the wall.
const scene = new T.Scene(), cube = new T.BoxGeometry(1, 1, 1), material = options => new T.MeshStandardMaterial(options);
const shared = material({}), camera = new T.PerspectiveCamera(49, 1.6, .1, 100);
const arrival = createGalleryArrival(T, { scene, material, basic: material, gold: shared, stone: shared, cornice: shared,
  box(parent, size, at, mat) { const mesh = new T.Mesh(cube, mat); mesh.scale.set(...size); mesh.position.set(...at); parent.add(mesh); return mesh; } });
let previous = 10;
for (let seconds = 0; seconds <= 6; seconds += .025) {
  arrival.update(camera, seconds); scene.updateMatrixWorld(true);
  assert(camera.position.z <= previous); previous = camera.position.z;
  const probe = new T.Raycaster(camera.position, new T.Vector3(0, 0, -1), 0, .15);
  assert.equal(probe.intersectObjects(scene.children, true).length, 0, 'camera never clips the wall or moving leaves');
}
arrival.update(camera, 6); assert(Math.abs(camera.position.z - .8) < 1e-9);
assert.equal(arrivalPose(0).door, 0); assert.equal(arrivalPose(0).title, 0); assert.equal(arrivalPose(4).title, 1); assert.equal(arrivalPose(6).title, 0);
assert.equal(arrivalPose(0, true).lookX, 0);
arrival.close(); scene.updateMatrixWorld(true);
assert(new T.Raycaster(new T.Vector3(.3, 2.32, 3), new T.Vector3(0, 0, 1)).intersectObjects(scene.children, true).length, 'return entrance closes again');
arrival.dispose(); assert.equal(scene.children.length, 0);

function harness({ seen = false, denied = false, reduced = false } = {}) {
  const classes = new Set(), nodes = new Map(), entries = new Map(seen ? [[openingKey, '1']] : []);
  let finishes = 0, sounds = 0, canceled = 0, enabled = false;
  const doc = { body: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } }, querySelector: () => dialog };
  class Element extends EventTarget {
    dataset = {}; style = { values: new Map(), setProperty(key, value) { this.values.set(key, value); } }; attributes = new Map();
    focus() { doc.activeElement = this; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    querySelector(key) { if (!nodes.has(key)) nodes.set(key, new Element()); return nodes.get(key); }
    showModal() { this.open = true; } close() { this.open = false; }
  }
  const dialog = new Element(), motion = { matches: reduced };
  const controller = mountGalleryOpening({ doc, reduced: motion, storage: {
    getItem(key) { if (denied) throw Error('denied'); return entries.get(key); },
    setItem(key, value) { if (denied) throw Error('denied'); entries.set(key, value); },
    removeItem(key) { if (denied) throw Error('denied'); entries.delete(key); },
  }, onFinish() { finishes++; }, gallery: { state: () => ({ sound: { enabled } }),
    async toggleSound() { enabled = !enabled; }, play() { sounds++; return () => canceled++; } } });
  const click = name => nodes.get(`[data-opening-${name}]`).dispatchEvent(new Event('click'));
  const stats = () => ({ finishes, sounds, canceled });
  return { controller, dialog, motion, entries, classes, nodes, click, stats };
}
let h = harness(); assert(h.controller.active); h.click('enter'); assert.equal(h.controller.snapshot().phase, 'waiting');
h.controller.setReady(true); h.click('enter'); h.click('enter'); assert.equal(h.stats().sounds, 1);
for (let i = 0; i < 50; i++) h.controller.advance(.05);
assert(h.controller.active); assert.equal(h.entries.size, 0, 'no marker until arrival completes');
for (let i = 0; i < 80; i++) h.controller.advance(.05);
assert.deepEqual(h.stats(), { finishes: 1, sounds: 1, canceled: 1 }); assert.equal(h.entries.get(openingKey), '1');
assert(!h.dialog.open); assert.equal(h.classes.size, 0);
assert.equal(h.controller.restart(), true);
assert.deepEqual(h.controller.snapshot(), { active: true, ready: false, phase: 'waiting', elapsed: 0 });
assert(h.dialog.open); assert(h.classes.has('is-gallery-opening')); assert(!h.entries.has(openingKey));
assert.equal(h.dialog.dataset.phase, 'waiting'); assert.equal(h.dialog.dataset.ready, 'false');
assert.equal(h.dialog.style.values.get('--opening-title-opacity'), '0');
assert.equal(h.nodes.get('[data-opening-letter]').inert, false);
assert(!h.nodes.get('[data-opening-letter]').attributes.has('aria-hidden'));
assert.equal(h.nodes.get('[data-opening-title]').hidden, true);
assert.equal(h.nodes.get('[data-opening-enter]').disabled, true);
h.click('enter'); assert.equal(h.controller.snapshot().phase, 'waiting', 'replay waits for fresh exhibition preparation');
h.controller.setReady(true); h.click('enter');
for (let i = 0; i < 125; i++) h.controller.advance(.05);
assert.deepEqual(h.stats(), { finishes: 2, sounds: 2, canceled: 2 });
assert.equal(h.entries.get(openingKey), '1'); assert(!h.dialog.open);
h.controller.dispose(); assert.equal(h.stats().finishes, 2);
assert.equal(h.controller.restart(), false, 'disposed opening cannot reopen');
h = harness(); h.click('skip'); assert.equal(h.stats().finishes, 1); assert.equal(h.entries.get(openingKey), '1');
h = harness({ seen: true }); assert(!h.controller.active); assert.equal(h.classes.size, 0);
assert(h.controller.restart()); h.controller.setReady(true); h.click('skip'); assert.equal(h.entries.get(openingKey), '1');
h.controller.restart(); h.controller.setReady(true); h.click('enter'); h.controller.advance(.05);
h.controller.restart(); assert.equal(h.stats().canceled, 1, 'restarting cancels the previous arrival sound');
assert.equal(h.controller.elapsed, 0); h.click('skip');
h = harness({ denied: true }); h.click('skip'); assert(!h.controller.active);
assert(h.controller.restart()); h.controller.setReady(true); h.click('skip'); assert(!h.controller.active);
h = harness({ reduced: true }); h.controller.setReady(true); h.click('enter'); assert.equal(h.stats().sounds, 0); assert(!h.controller.active);
assert(h.controller.restart()); h.controller.setReady(true); h.click('enter'); assert.equal(h.stats().sounds, 0); assert(!h.controller.active);
h = harness(); h.controller.setReady(true); h.click('enter'); h.motion.matches = true; h.controller.advance(.05); assert(!h.controller.active);
h = harness(); h.dialog.dispatchEvent(new Event('cancel', { cancelable: true })); assert(!h.controller.active);
h = harness(); h.controller.fallback(); assert.equal(h.entries.size, 0); assert(!h.controller.active);
h = harness(); h.click('sound'); await Promise.resolve(); assert.equal(h.nodes.get('[data-opening-sound]').textContent, '音：オン');
h.controller.dispose(); assert.equal(h.entries.size, 0);
console.log('Gallery opening: clear camera path, door reset, entry, replay after completion/skip, readiness, session marker, denied storage, sound, reduced motion and fallback passed.');
