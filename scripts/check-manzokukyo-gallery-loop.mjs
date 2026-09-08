import assert from 'node:assert/strict';
import { newLoop, chooseAnomaly, judgeLoop, loopExit, paintingAppearance, mountGalleryLoop } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-loop.js';
import { renderGallery3DExperience } from './render-manzokukyo-gallery-3d.mjs';

assert.deepEqual(newLoop(NaN), newLoop());
assert.deepEqual(newLoop(-1), newLoop());
assert.equal(chooseAnomaly(() => 0), null);
for (const [kind, draw] of [['upside-down', .1], ['negative', .5], ['same-image', .9]]) {
  const sequence = [.8, draw, .54];
  const anomaly = chooseAnomaly(() => sequence.shift());
  assert.equal(anomaly.kind, kind); assert.equal(anomaly.index, 12);
  assert.equal(judgeLoop({ ...newLoop(), round: 1, anomaly }, 'back', () => 0).correct, true);
  assert.equal(judgeLoop({ ...newLoop(), round: 1, anomaly }, 'forward', () => 0).correct, false);
  const appearances = Array.from({ length: 24 }, (_, index) => paintingAppearance(index, anomaly));
  assert.equal(appearances.filter(a => a.upsideDown).length, kind === 'upside-down' ? 1 : 0);
  assert.equal(appearances.filter(a => a.negative).length, kind === 'negative' ? 1 : 0);
  assert.equal(new Set(appearances.map(a => a.imageIndex)).size, kind === 'same-image' ? 1 : 24);
}
let state = newLoop();
state = judgeLoop(state, 'forward', () => 0).next;
assert.equal(state.streak, 0, 'the learning lap is not scored');
for (let n = 0; n < 1000; n++) state = judgeLoop(state, 'forward', () => 0).next;
assert.equal(state.streak, 1000, 'the corridor has no forced last round');
state = judgeLoop(state, 'back', () => 0).next;
assert.equal(state.streak, 0); assert.equal(state.best, 1000);
assert.equal(loopExit({ x: 0, z: -62.2 }), 'forward');
assert.equal(loopExit({ x: 0, z: 2.8 }), 'back');
assert.equal(loopExit({ x: 2, z: 3 }), null, 'touching the side wall is not a decision');
assert.equal(loopExit({ x: 0, z: .8 }), null, 'respawning cannot immediately retrigger a portal');
assert.throws(() => judgeLoop(state, 'left'));

// Exercise the actual round controller with deferred image readiness and time.
const page = renderGallery3DExperience({ id: 'zannenin', theme: {} }, { htmlPage: value => value, escapeHtml: String, assetVersionQuery: 'test' });
const markup = [...page.body.matchAll(/<[a-z][^>]*\bdata-gallery-loop[^>]*>/g)].map(match => match[0]);
class Element {
  constructor(attributes = []) { this.attributes = new Map(attributes); this.events = new Map(); this.style = {}; this.open = false; this.disabled = false; }
  querySelector(selector) { return nodes.get(selector); }
  querySelectorAll() { return modes; }
  getAttribute(name) { return this.attributes.get(name); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, fn) { this.events.set(name, fn); }
  fire(name, data = {}) { this.events.get(name)?.({ target: this, preventDefault() {}, ...data }); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
}
const nodes = new Map(), modes = [];
for (const tag of markup) {
  const attributes = [...tag.matchAll(/(data-gallery-loop[\w-]*)(?:="([^"]*)")?/g)].map(m => [m[1], m[2] || '']);
  const node = new Element(attributes);
  for (const [name] of attributes) { if (name === 'data-gallery-loop-mode') modes.push(node); else nodes.set(`[${name}]`, node); }
}
nodes.set('img', new Element()); nodes.set('button', new Element());
const classes = new Set(), storage = new Map([['existing-gallery-seals', 'keep-me']]);
const imageLoads = [], timers = [], sounds = [], preparations = [];
globalThis.document = { querySelector: selector => nodes.get(selector), baseURI: 'http://local.test/zannenin/manzokukyo/truth/gallery/', body: { classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } } } };
globalThis.window = new Element();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
globalThis.matchMedia = () => ({ matches: false });
globalThis.setTimeout = callback => timers.push(callback);
let imageErrors = false;
const ui = mountGalleryLoop({ stage: new Element(), canvas: new Element(), records: Array.from({ length: 24 }, (_, i) => ({ id: String(i + 1).padStart(2, '0') })), assetVersionQuery: 'test', gallery: { play: name => sounds.push(name) }, random: () => .9,
  exhibition: { stop() {}, hasImageErrors: () => imageErrors, prepareLoop(anomaly, round) { preparations.push({ anomaly, round }); return new Promise(resolve => imageLoads.push(resolve)); } } });
async function finish(ready = true) { for (const resolve of imageLoads.splice(0)) resolve(ready); for (const timer of timers.splice(0)) timer(); for (let i = 0; i < 6; i++) await Promise.resolve(); }
await Promise.resolve();
assert.equal(ui.busy, true); assert.equal(await ui.cross('forward'), false);
await finish(); assert.equal(ui.busy, false); assert.ok(classes.has('is-gallery-loop'));
assert.equal(await ui.cross('forward'), true); assert.equal(ui.snapshot().round, 1); assert.equal(ui.busy, true);
assert.equal(await ui.cross('forward'), false, 'held movement cannot count the same exit twice');
await finish();
assert.equal(preparations.at(-1).anomaly.kind, 'same-image');
assert.equal(ui.inspect(0), true);
assert.match(nodes.get('img').src, /gallery-22\.webp/);
nodes.get('button').fire('click'); assert.equal(ui.snapshot().inspectionOpen, false);
await ui.cross('back'); await finish(); assert.equal(ui.snapshot().streak, 1);
await ui.cross('forward'); await finish(); assert.equal(ui.snapshot().streak, 0); assert.equal(ui.snapshot().best, 1);
assert.ok(sounds.includes('gallery-unseal')); assert.ok(sounds.includes('transmission'));
const beforeError = ui.snapshot(); imageErrors = true;
assert.equal(await ui.cross('forward'), false); await finish(false);
assert.equal(ui.snapshot().round, beforeError.round); assert.equal(ui.snapshot().streak, beforeError.streak);
assert.equal(nodes.get('[data-gallery-loop-retry]').hidden, false);
imageErrors = false; nodes.get('[data-gallery-loop-retry]').fire('click'); await finish();
assert.equal(ui.snapshot().round, beforeError.round, 'retrying images does not reroll or judge a round');
nodes.get('[data-gallery-loop-restart]').fire('click'); await finish();
assert.equal(ui.snapshot().round, 0); assert.equal(ui.snapshot().best, 1); assert.equal(preparations.at(-1).anomaly, null);
const switching = ui.setMode('gallery'); await finish(); await switching;
assert.equal(ui.active, false); assert.equal(preparations.at(-1).anomaly, null); assert.ok(!classes.has('is-gallery-loop'));
const returning = ui.setMode('loop'); await Promise.resolve(); ui.fallback(); await finish(); await returning;
assert.equal(ui.active, false, 'late preparation cannot re-enable a failed 3D scene');
assert.equal(storage.get('existing-gallery-seals'), 'keep-me');
assert.equal(storage.get('manzokukyo-gallery-loop-best-v1'), '1');
console.log('Gallery loop passed: all three anomalies, both decisions, unlimited rounds, baseline, score/best, portal boundaries, input latch, inspection, missing-image retries, restart, mode switching and late completion.');
