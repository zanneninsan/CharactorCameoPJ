import assert from 'node:assert/strict';
import { mountGalleryDebugPanel, galleryDebugOptions } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-loop.js';

// Keyboard/modal behavior uses the real panel, independent of WebGL readiness.
class Element {
  events = new Map(); open = false; disabled = false; hidden = false; value = '';
  addEventListener(name, fn) { this.events.set(name, fn); }
  removeEventListener(name, fn) { if (this.events.get(name) === fn) this.events.delete(name); }
  fire(name, data = {}) { let prevented = false; this.events.get(name)?.({ target: this, preventDefault() { prevented = true; }, ...data }); return prevented; }
  querySelector(selector) { return nodes.get(selector); }
  querySelectorAll() { return options; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { focused = this; }
}
const names = ['gallery-debug', 'debug-kind', 'debug-record', 'debug-apply', 'debug-exit', 'debug-status', 'debug-active', 'debug-close'];
const nodes = new Map(names.map(name => [`[data-${name}]`, new Element()]));
const q = name => nodes.get(`[data-${name}]`), dialog = q('gallery-debug');
const options = galleryDebugOptions.map(item => Object.assign(new Element(), { value: item.kind }));
const trigger = new Element(), canvas = new Element();
let focused, ready = false, busy = false, anotherModal = false, debug = null, stopped = 0, woken = 0, applied = 0;
q('debug-kind').value = 'normal'; q('debug-record').value = '1';
globalThis.document = { querySelector: selector => nodes.get(selector), querySelectorAll: () => [trigger, q('debug-active')] };
globalThis.window = new Element();
const controller = {
  get debug() { return Boolean(debug); }, canDebug: () => !busy && !anotherModal, snapshot: () => ({ debug }),
  startDebug(value) { if (!this.canDebug()) return false; busy = true; debug = value; applied++; return Promise.resolve(true); },
  stopDebug() { if (!this.canDebug()) return false; busy = true; debug = null; return Promise.resolve(true); },
};
const panel = mountGalleryDebugPanel({ controller, canvas, exhibition: { hasVisitors: () => ready, stop() { stopped++; }, wake() { woken++; } } });
const press = data => window.fire('keydown', { key: 'p', code: 'KeyP', ...data });
assert.equal(options.find(option => option.value === 'giant-darenin').disabled, true);
for (const data of [{ repeat: true }, { isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { target: { closest: () => ({}) } }, { key: 'w', code: 'KeyW' }]) {
  assert.equal(press(data), false); assert.equal(dialog.open, false);
}
busy = true; assert.equal(press(), false); busy = false;
anotherModal = true; assert.equal(press(), false); anotherModal = false;
assert.equal(press(), true); assert.equal(dialog.open, true); assert.equal(focused, q('debug-kind')); assert.equal(stopped, 1);
q('debug-kind').value = 'giant-darenin'; q('debug-kind').fire('change');
assert.equal(q('debug-apply').disabled, true);
ready = true; panel.render(); assert.equal(q('debug-apply').disabled, false);
q('debug-kind').value = 'frame-hand'; q('debug-kind').fire('change'); assert.equal(q('debug-record').disabled, false);
q('debug-record').value = '24'; q('debug-apply').fire('click');
assert.equal(dialog.open, false); assert.deepEqual(debug, { kind: 'frame-hand', index: 23 });
q('debug-apply').fire('click'); assert.equal(applied, 1, 'a second click while preparing cannot reapply');
panel.render(); assert.equal(q('debug-active').hidden, false); assert.equal(q('debug-active').disabled, true);
busy = false; panel.render(); trigger.fire('click');
assert.equal(dialog.open, true); assert.equal(q('debug-record').value, '24'); assert.equal(q('debug-exit').hidden, false);
assert.equal(dialog.fire('cancel'), true); assert.equal(dialog.open, false); assert.equal(focused, canvas); assert.equal(woken, 1);
press(); q('debug-exit').fire('click'); assert.equal(dialog.open, false); assert.equal(debug, null);
busy = false; panel.render(); press(); panel.dispose();
assert.equal(dialog.open, false); assert.equal(press(), false); trigger.fire('click'); assert.equal(dialog.open, false);
assert.equal(window.events.has('keydown'), false, 'navigation removes the shortcut');
console.log('Gallery debug passed: P/input/IME guards, model readiness, record selector, double click, restore, Escape and teardown.');
