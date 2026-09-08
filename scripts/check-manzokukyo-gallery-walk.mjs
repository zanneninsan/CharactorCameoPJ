import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { advanceWalk, walkKeys, walkRoom } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-walk.js';
import { renderGallery3DExperience } from './render-manzokukyo-gallery-3d.mjs';

function travel(actions, yaw = 0, frames = 60, dt = 1 / 60, start = { x: 0, z: 0 }) {
  let pose = { ...start, yaw };
  for (let frame = 0; frame < frames; frame++) pose = advanceWalk(pose, pose.yaw, new Set(actions), dt);
  return pose;
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} matches ${b}`);
close(travel(['forward']).z, -4.2);
close(travel(['back']).z, 3);
close(travel(['left']).x, -4.2);
close(travel(['right']).x, 4.2);
close(travel(['forward'], Math.PI / 2).x, -4.2);
close(travel(['forward'], -Math.PI / 2).x, 4.2);
close(travel(['turnLeft']).yaw, 1.45);
close(travel(['turnRight']).yaw, -1.45);
close(travel(['forward', 'back']).z, 0);
const diagonal = travel(['forward', 'right']);
close(Math.hypot(diagonal.x, diagonal.z), 4.2);
close(travel(['forward', 'sprint']).z, -8.4);
close(travel(['sprint']).z, 0);
close(travel(['turnLeft', 'sprint']).yaw, 1.45);
const runningDiagonal = travel(['forward', 'right', 'sprint'], 0, 20);
close(Math.hypot(runningDiagonal.x, runningDiagonal.z), 2.8);
close(travel(['forward', 'sprint'], 0, 30, 1 / 30).z, travel(['forward', 'sprint'], 0, 144, 1 / 144).z);
assert.equal(travel(['forward', 'sprint'], 0, 2400).z, -62.5);
close(travel(['forward'], 0, 30, 1 / 30).z, travel(['forward'], 0, 144, 1 / 144).z);
assert.equal(travel(['forward'], 0, 2400).z, -62.5);
assert.equal(travel(['left'], 0, 2400).x, -4.3);
assert.equal(travel(['right'], 0, 2400).x, 4.3);
assert.ok(Math.abs(advanceWalk({ x: 0, z: 0 }, 0, new Set(['forward']), 100).z) <= .210001, 'a suspended tab cannot jump through the room');
assert.deepEqual([2, -13.9, -14.1, -30.1, -46.1, -62.5].map(walkRoom), [0, 0, 1, 2, 3, 3]);

// Run the actual input handlers with controlled focus/visibility/modal state.
// This catches missing DOM wiring that pure movement math cannot detect.
const source = await readFile(new URL('../content/characters/zannenin/assets/site/manzokukyo-gallery-3d.js', import.meta.url), 'utf8');
function declaration(marker) {
  const start = source.indexOf(marker); assert.ok(start >= 0, marker);
  for (let end = source.indexOf('\n', start); end >= 0; end = source.indexOf('\n', end + 1)) {
    const candidate = source.slice(start, end);
    try { new vm.Script(candidate); return candidate; } catch {}
  }
  throw Error(marker);
}
const cacheContext = vm.createContext({ activeRoom: 1, roomCache: [1, 2], loaded: new Map(), frames: [], ambience: { position: {} }, refreshLoading() {} });
vm.runInContext(declaration('function loadRoom('), cacheContext);
for (const neighbor of [0, 2, 0, 2]) {
  vm.runInContext(`loadRoom(${neighbor}, true)`, cacheContext);
  assert.equal(cacheContext.activeRoom, 1);
  assert.ok(cacheContext.roomCache.includes(1), 'turning toward another neighbor never evicts paintings in the current room');
  assert.ok(cacheContext.roomCache.includes(neighbor));
  assert.equal(cacheContext.roomCache.length, 2);
}

class Control {
  constructor(action) { this.action = action; this.events = new Map(); this.classes = new Set(); this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name) }; }
  addEventListener(name, callback) { const listeners = this.events.get(name) || []; listeners.push(callback); this.events.set(name, listeners); }
  fire(name, data = {}) { const event = { code: '', target: { closest: () => null }, preventDefault() { this.prevented = true; }, ...data }; for (const callback of this.events.get(name) || []) callback(event); return event; }
  getAttribute() { return this.action; }
  setAttribute(name, value) { this[name] = value; }
  setPointerCapture() {}
  focus() {}
  contains(target) { return target === this; }
}
const stage = new Control(), canvas = new Control(), window = new Control();
const sprintButton = new Control('sprint');
const buttons = Object.values(walkKeys).map(action => new Control(action));
const document = { hidden: false, modal: false, querySelector: () => document.modal };
const heldKeys = new Set(), heldPointers = new Map(), steps = [];
const context = vm.createContext({ sprintButton, sprintLatched: false, loop: null, stage, canvas, window, document, walkKeys, heldKeys, heldPointers, walkButtons: buttons, disposed: false, lost: false, inView: true, down: null, walked: 0, wake() {}, applyWalk: (dt, actions) => steps.push(actions || new Set([...heldKeys].map(key => walkKeys[key]).concat([...heldPointers.values()], context.sprintLatched ? ['sprint'] : []))) });
vm.runInContext([
  declaration('function canWalk('), declaration('function stopWalk('),
  'function startWalk() { return canWalk(); }',
  declaration("stage.addEventListener('keydown'"), declaration("window.addEventListener('keyup'"),
  declaration("stage.addEventListener('focusout'"), declaration('for (const button of walkButtons) {'),
  declaration("window.addEventListener('blur'"),
  declaration("sprintButton.addEventListener('click'"),
].join('\n'), context);
for (const code of Object.keys(walkKeys)) {
  assert.equal(stage.fire('keydown', { code }).prevented, true, `${code} controls walking`);
  assert.ok(steps.at(-1).has(walkKeys[code]));
  window.fire('keyup', { code }); assert.equal(heldKeys.size, 0);
}
stage.fire('keydown', { code: 'KeyW' }); stage.fire('keydown', { code: 'KeyD' });
assert.equal(heldKeys.size, 2); window.fire('blur'); assert.equal(heldKeys.size, 0, 'focus loss releases held keys');
for (const reason of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { target: { closest: () => ({ tagName: 'INPUT' }) } }]) {
  const before = steps.length; stage.fire('keydown', { code: 'KeyW', ...reason }); assert.equal(steps.length, before, 'typing, IME and shortcuts do not walk');
}
for (const kind of ['modal', 'hidden']) {
  document[kind] = true;
  const before = steps.length; stage.fire('keydown', { code: 'KeyW' }); assert.equal(steps.length, before, `${kind} pauses input`);
  document[kind] = false;
}
for (const [pointerId, button] of buttons.entries()) {
  button.fire('pointerdown', { pointerId, button: 0 }); assert.equal(heldPointers.get(pointerId), button.action);
  button.fire(pointerId % 2 ? 'pointercancel' : 'lostpointercapture', { pointerId }); assert.equal(heldPointers.size, 0);
}
buttons[0].fire('click', { detail: 0 }); assert.ok(steps.at(-1).has(buttons[0].action), 'keyboard activation of touch buttons also moves');
stage.fire('keydown', { code: 'KeyW' }); stage.fire('focusout', { relatedTarget: null }); assert.equal(heldKeys.size, 0);
sprintButton.fire('click'); assert.equal(context.sprintLatched, true);
buttons.find(button => button.action === 'forward').fire('pointerdown', { pointerId: 100, button: 0 });
assert.ok(steps.at(-1).has('sprint')); assert.ok(steps.at(-1).has('forward'));
window.fire('blur'); assert.equal(context.sprintLatched, false); assert.equal(sprintButton['aria-pressed'], 'false');
sprintButton.fire('click'); sprintButton.fire('click'); assert.equal(context.sprintLatched, false);

const options = { htmlPage: value => value, escapeHtml: String, assetVersionQuery: 'v=test' };
const primary = renderGallery3DExperience({ id: 'zannenin', theme: {} }, options);
const alias = renderGallery3DExperience({ id: 'zannenin', theme: {} }, { ...options, alias: true });
assert.equal(primary.urlPath, 'zannenin/manzokukyo/truth/gallery/'); assert.equal(alias.urlPath, primary.urlPath);
assert.match(primary.robots, /^index,/); assert.match(alias.robots, /^noindex,/);
assert.doesNotMatch(primary.body, /通常の画廊へ|3D preview|class="gallery-mode-link"|href="\.\.\/gallery\//);
assert.equal([...primary.body.matchAll(/data-gallery-3d-walk="/g)].length, 6);
assert.equal([...primary.body.matchAll(/data-gallery-3d-sprint/g)].length, 1);
assert.equal([...primary.body.matchAll(/data-gallery-index="/g)].length, 24);
console.log('Gallery walking passed: six camera-relative controls, diagonal/refresh-rate consistency, boundaries, room crossings, actual key/touch handlers, blur/modal/IME guards and primary/alias routes.');
