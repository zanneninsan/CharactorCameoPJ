import assert from 'node:assert/strict';
import { newLoop, chooseAnomaly, judgeLoop, loopExit, paintingAppearance, mountGalleryLoop, galleryDebugOptions } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-loop.js';
import { renderGallery3DExperience } from './render-manzokukyo-gallery-3d.mjs';
import { createHarness } from './check-manzokukyo-gallery.mjs';

assert.deepEqual(newLoop(NaN), newLoop());
assert.deepEqual(newLoop(-1), newLoop());
assert.equal(chooseAnomaly(() => 0), null);
for (const [kind, draw] of [['upside-down', .1], ['negative', .2], ['same-image', .35]]) {
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
assert.doesNotMatch(page.body, /data-gallery-loop-mode="gallery"/);
assert.match(page.body.match(/<dialog class="gallery-achievements"[\s\S]*?<\/dialog>/)[0], /data-achievements-viewing[\s\S]*連続正解が 0/);
assert.doesNotMatch(page.body, /いつもは残念院さんと誰念院さん/);
const { records } = JSON.parse(page.body.match(/<script type="application\/json" data-gallery-records>([\s\S]*?)<\/script>/)[1]);
const shared = createHarness({ saved: { 'other-room': 'keep-me' } });
const markup = [...page.body.matchAll(/<[a-z][^>]*\bdata-gallery-loop[^>]*>/g)].map(match => match[0]);
class Element {
  constructor(attributes = []) { this.attributes = new Map(attributes); this.events = new Map(); this.style = {}; this.open = false; this.disabled = false; }
  querySelector(selector) { return nodes.get(selector); }
  querySelectorAll(selector) { return selector === '[data-gallery-loop-slot]' ? slots : modes; }
  getAttribute(name) { return this.attributes.get(name); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, fn) { this.events.set(name, fn); }
  removeEventListener(name) { this.events.delete(name); }
  fire(name, data = {}) { this.events.get(name)?.({ target: this, preventDefault() {}, ...data }); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
}
const nodes = new Map(), modes = [], slots = [];
for (const tag of markup) {
  const attributes = [...tag.matchAll(/(data-gallery-loop[\w-]*)(?:="([^"]*)")?/g)].map(m => [m[1], m[2] || '']);
  const node = new Element(attributes);
  for (const [name] of attributes) { if (name === 'data-gallery-loop-mode') modes.push(node); else if (name === 'data-gallery-loop-slot') slots.push(node); else nodes.set(`[${name}]`, node); }
}
nodes.set('img', new Element()); nodes.set('button', new Element());
const classes = new Set(), storage = new Map([['existing-gallery-seals', 'keep-me']]);
const imageLoads = [], timers = [], sounds = [], preparations = [];
globalThis.document = { querySelector: selector => selector === 'dialog[open]' ? (nodes.get('[data-gallery-loop-inspection]').open || shared.elements.ceremony.open || shared.elements.dialog.open) : nodes.get(selector), baseURI: 'http://local.test/zannenin/manzokukyo/truth/gallery/', body: { classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } } } };
globalThis.window = new Element();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
globalThis.matchMedia = () => ({ matches: false });
globalThis.setTimeout = callback => timers.push(callback);
let imageErrors = false, visitorsReady = false, wakes = 0, throwPreparation = false;
let randomDraw = 0;
const gallery = { state: () => shared.state(), play: name => sounds.push(name), ...Object.fromEntries(['setExpedition', 'confirmSeal', 'celebrateSeals', 'resetGallery'].map(name => [name, (...args) => shared.call(name, ...args)])) };
const ui = mountGalleryLoop({ stage: new Element(), canvas: new Element(), records, assetVersionQuery: 'test', gallery, random: () => visitorsReady ? .84 : [.9, .35, .9][randomDraw++ % 3],
  exhibition: { stop() {}, wake() { wakes++; }, hasVisitors: () => visitorsReady, hasImageErrors: () => imageErrors, prepareLoop(anomaly, round) { if (throwPreparation) throw Error('graphics failure'); preparations.push({ anomaly, round }); return new Promise(resolve => imageLoads.push(resolve)); } } });
async function finish(ready = true) { for (const resolve of imageLoads.splice(0)) resolve(ready); for (const timer of timers.splice(0)) timer(); for (let i = 0; i < 6; i++) await Promise.resolve(); }
await Promise.resolve();
assert.equal(ui.busy, true); assert.equal(await ui.cross('forward'), false);
await finish(); assert.equal(ui.busy, false); assert.ok(classes.has('is-gallery-loop')); assert.equal(wakes, 1);
assert.equal(ui.achievements().encountered, 0, 'preparation cannot reveal a future anomaly');
function inspectSeal(number) {
  assert.equal(ui.inspect(number - 1), true);
  nodes.get('img').naturalWidth = 600; nodes.get('img').fire('load');
}
function close() { nodes.get('[data-gallery-loop-inspection-close]').fire('click'); }
inspectSeal(2); assert.equal(ui.collect(), false, 'the baseline is for observation'); close();
assert.equal(await ui.cross('forward'), true); assert.equal(ui.snapshot().round, 1); assert.equal(ui.busy, true);
assert.equal(await ui.cross('forward'), false, 'held movement cannot count the same exit twice');
await finish();
assert.equal(wakes, 2, 'the next lap resumes animation after the transition without another keypress');
assert.equal(preparations.at(-1).anomaly.kind, 'same-image');
inspectSeal(2);
assert.match(nodes.get('img').src, /assets\/manzokukyo\/gallery\/gallery-22\.png/, 'inspection requests the original image');
nodes.get('img').fire('error'); assert.equal(ui.collect(), false, 'a failed inspection image cannot grant a seal');
nodes.get('img').fire('load'); assert.equal(shared.call('collectSeal'), true, 'the normal collection entry point uses the expedition');
assert.equal(ui.snapshot().heldSeal, 2); assert.equal(shared.state().count, 0, 'a provisional seal is not saved');
assert.equal(ui.collect(), false, 'a seal cannot be picked up twice');
assert.equal(await ui.cross('back'), false, 'the exit cannot judge while a painting is open'); close();
inspectSeal(5); assert.equal(ui.collect(), false, 'only one provisional seal fits in each round'); close();
await ui.cross('forward'); await finish();
assert.equal(ui.snapshot().heldSeal, null); assert.equal(shared.state().count, 0, 'a wrong exit discards the provisional seal');
assert.equal(ui.achievements().encountered, 1); assert.equal(ui.achievements().solved, 0, 'completed encounter is recorded even when the judgment was wrong');
inspectSeal(2); ui.collect(); close();
await ui.cross('back'); await finish(); assert.equal(ui.snapshot().streak, 1); assert.equal(shared.state().count, 1);
assert.equal(ui.achievements().solved, 1, 'a correct retreat upgrades the same achievement');
assert.deepEqual(JSON.parse(shared.store.get('manzokukyo-gallery-seals-v2')), [2], 'the existing saved progress is used');
inspectSeal(2); assert.equal(ui.collect(), false, 'a confirmed seal cannot be collected again'); close();
inspectSeal(5); ui.collect(); close();
await ui.cross('forward'); await finish(); assert.equal(ui.snapshot().streak, 0); assert.equal(ui.snapshot().best, 1);
assert.equal(shared.state().count, 1, 'a mistake keeps seals from previous correct rounds');
assert.ok(sounds.includes('gallery-unseal')); assert.ok(sounds.includes('transmission'));
inspectSeal(5); ui.collect(); close();
const beforeError = ui.snapshot(); imageErrors = true;
assert.equal(await ui.cross('forward'), false); await finish(false);
assert.equal(ui.snapshot().round, beforeError.round); assert.equal(ui.snapshot().streak, beforeError.streak);
assert.equal(ui.snapshot().heldSeal, 5, 'an image retry keeps the provisional seal');
assert.equal(nodes.get('[data-gallery-loop-retry]').hidden, false);
imageErrors = false; nodes.get('[data-gallery-loop-retry]').fire('click'); await finish();
assert.equal(ui.snapshot().round, beforeError.round, 'retrying images does not reroll or judge a round');
await ui.cross('back'); await finish(); assert.equal(shared.state().count, 2);
inspectSeal(9); ui.collect(); close();
const beforeViewing = ui.snapshot(); assert.ok(beforeViewing.streak > 0);
const switching = ui.setMode('gallery'); await finish(); await switching;
assert.equal(ui.snapshot().streak, 0); assert.equal(ui.snapshot().best, beforeViewing.best);
assert.equal(ui.active, false); assert.equal(preparations.at(-1).anomaly, null); assert.ok(!classes.has('is-gallery-loop'));
assert.equal(ui.snapshot().heldSeal, null); assert.equal(shared.state().count, 2, 'changing modes discards only the provisional seal');
shared.call('showRecord', 8); assert.equal(shared.elements.collect.hidden, true);
assert.equal(shared.call('collectSeal'), false, 'the viewing mode cannot bypass anomaly judgments'); shared.call('closeRecord');
const resuming = ui.setMode('loop'); await finish(); await resuming;
await ui.cross('forward'); await finish();
for (const number of [9, 14, 17, 21]) {
  inspectSeal(number); ui.collect(); close(); await ui.cross('back'); await finish();
}
assert.equal(shared.state().count, 6); assert.equal(shared.elements.ceremony.open, true, 'the sixth confirmed seal opens the existing ceremony');
shared.call('closeCeremony'); assert.equal(shared.call('submitWord', 'ちがう').accepted, false);
assert.equal(shared.call('submitWord', 'あかいとびら').accepted, true); shared.run(4600);
assert.equal(shared.state().cleared, true); assert.equal(shared.elements.exit.getAttribute('aria-disabled'), 'false');
nodes.get('[data-gallery-loop-restart]').fire('click'); await finish();
assert.equal(ui.snapshot().round, 0); assert.equal(ui.snapshot().best, 4); assert.equal(preparations.at(-1).anomaly, null);
assert.equal(shared.state().count, 0); assert.equal(shared.state().cleared, false); assert.equal(shared.elements.ceremony.open, false);
visitorsReady = true;
await ui.cross('forward'); await finish();
assert.equal(preparations.at(-1).anomaly.kind, 'darenin-rush', 'only ready character models enter the anomaly draw');
inspectSeal(2); ui.collect(); close();
await ui.cross('back'); await finish();
assert.equal(shared.state().count, 1, 'retreating from the four runners files the provisional seal');
assert.match(nodes.get('[data-gallery-loop-transition-note]').textContent, /4体/);

// Forced exhibitions share the real transition path but must never affect a save.
inspectSeal(5); assert.equal(ui.collect(), true);
assert.equal(ui.startDebug({ kind: 'normal' }), false, 'inspection blocks switching'); close();
const normal = ui.snapshot(), normalExhibition = structuredClone(preparations.at(-1));
const saves = [...shared.store], bestSave = [...storage];
const achievementsBeforeDebug = ui.achievements();
for (const selection of [null, { kind: 'unknown' }, ...[-1, 24, NaN, .5, '1'].map(index => ({ kind: 'frame-hand', index }))]) {
  assert.equal(ui.startDebug(selection), false); assert.deepEqual(ui.snapshot(), normal);
}
visitorsReady = false;
assert.equal(ui.startDebug({ kind: 'giant-darenin' }), false, 'unavailable models cannot become invisible anomalies');
visitorsReady = true;
let applying = ui.startDebug({ kind: 'frame-hand', index: 4 });
assert.equal(ui.busy, true); assert.equal(ui.snapshot().heldSeal, null);
assert.equal(ui.startDebug({ kind: 'normal' }), false, 'double apply is rejected synchronously');
assert.equal(ui.stopDebug(), false); assert.equal(await ui.cross('back'), false);
assert.equal(await ui.setMode('gallery'), false, 'mode switches cannot race a pending debug load');
await finish(); assert.equal(await applying, true);
assert.deepEqual(ui.snapshot().debug, { kind: 'frame-hand', index: 4 });
const selected = structuredClone(preparations.at(-1));
for (const direction of ['back', 'forward']) {
  inspectSeal(5); ui.collect(); close();
  await ui.cross(direction); await finish();
  assert.deepEqual(preparations.at(-1), selected, 'both judgments replay the chosen anomaly');
  assert.equal(ui.snapshot().heldSeal, null); assert.equal(ui.snapshot().streak, 0);
  assert.deepEqual([...shared.store], saves); assert.deepEqual([...storage], bestSave);
  assert.equal(shared.elements.ceremony.open, false);
}
inspectSeal(5); ui.collect(); close();
shared.call('resetGallery'); await finish();
assert.equal(ui.snapshot().heldSeal, null); assert.deepEqual(preparations.at(-1), selected);
assert.deepEqual([...shared.store], saves, 'debug reset preserves the real seals and clear state');
assert.equal(shared.call('submitWord', 'あかいとびら').unavailable, true);
assert.deepEqual([...shared.store], saves);
for (const option of galleryDebugOptions) {
  applying = ui.startDebug({ kind: option.kind, index: 23 }); await finish(); assert.equal(await applying, true);
  assert.deepEqual(preparations.at(-1).anomaly, option.kind === 'normal' ? null : option.record ? { kind: option.kind, index: 23 } : { kind: option.kind });
}
applying = ui.startDebug({ kind: 'negative', index: 0 }); await finish(false); assert.equal(await applying, false);
assert.equal(ui.canDebug(), true, 'failed loads permit choosing a different exhibit or leaving');
throwPreparation = true;
assert.equal(await ui.startDebug({ kind: 'normal' }), false, 'synchronous renderer failure is contained');
throwPreparation = false;
applying = ui.startDebug({ kind: 'upside-down', index: 1 }); await finish(); assert.equal(await applying, true);
let leaving = ui.stopDebug(); await finish(); assert.equal(await leaving, true);
assert.deepEqual(ui.snapshot(), { ...normal, heldSeal: null }, 'original lap and score resume without provisional pickup');
assert.deepEqual(preparations.at(-1), normalExhibition, 'the original randomly drawn anomaly is restored');
assert.deepEqual([...shared.store], saves); assert.deepEqual([...storage], bestSave);
assert.deepEqual(ui.achievements(), achievementsBeforeDebug, 'all debug selections and judgments leave the achievement board unchanged');
let changing = ui.setMode('gallery'); await finish(); await changing;
applying = ui.startDebug({ kind: 'normal' }); await finish(); await applying;
leaving = ui.stopDebug(); await finish(); await leaving;
assert.equal(ui.active, false, 'leaving debug restores viewing mode when entered there');
applying = ui.startDebug({ kind: 'satisfaction' }); await finish(); await applying;
changing = ui.setMode('loop'); await finish(); await changing;
assert.equal(ui.debug, false); assert.equal(ui.snapshot().round, 0, 'explicit play mode ends debug with the normal learning lap');
nodes.get('[data-gallery-loop-restart]').fire('click'); await finish();
assert.equal(preparations.at(-1).anomaly, null, 'reset clears the running-row anomaly');
const returning = ui.startDebug({ kind: 'giant-darenin' }); await Promise.resolve(); ui.fallback(); await finish(); await returning;
assert.equal(ui.active, false, 'late preparation cannot re-enable a failed 3D scene');
assert.equal(ui.debug, false); assert.equal(ui.canDebug(), false, 'graphics fallback clears and disables debug');
assert.equal(storage.get('existing-gallery-seals'), 'keep-me');
assert.equal(shared.store.get('other-room'), 'keep-me');
assert.equal(storage.get('manzokukyo-gallery-loop-best-v1'), '4');
console.log('Gallery loop passed: anomalies, provisional pickup, one seal per round, correct/incorrect exits, saved seals, image retries, no viewing-mode bypass, sixth-seal ceremony, passphrase, reset and late completion.');
