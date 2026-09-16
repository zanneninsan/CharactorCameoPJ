import assert from 'node:assert/strict';
import { mountGalleryFeedback } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-feedback.js';
let now = 0, id = 0;
const timers = new Map(), sounds = [], cancelled = [];
globalThis.setTimeout = (fn, delay) => { const key = ++id; timers.set(key, { fn, at: now + delay }); return key; };
globalThis.clearTimeout = key => timers.delete(key);
const advance = duration => {
  const end = now + duration;
  while (true) {
    const entry = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!entry) break;
    const [key, value] = entry; timers.delete(key); now = value.at; value.fn();
  }
  now = end;
};
class Node {
  hidden = true; phase = ''; textContent = '';
  children = new Map();
  setAttribute(name, value) { if (name === 'data-phase') this.phase = value; }
  querySelector(name) { if (!this.children.has(name)) this.children.set(name, new Node()); return this.children.get(name); }
}
const stage = new Node(), modal = new Node(), reduced = { matches: false };
const ui = mountGalleryFeedback({ stage, modal, reduced, play(name) { const index = sounds.length; sounds.push(name); return () => cancelled.push(index); } });
const seal = modal.querySelector('[data-gallery-loop-imprint]'), hand = stage.querySelector('[data-gallery-loop-touch]');
const record = { number: 5, seal: { fragment: 'か', order: 1 } };
ui.imprint(record); assert.equal(seal.hidden, false); assert.equal(seal.phase, 'gather');
assert.equal(seal.querySelector('[data-gallery-loop-imprint-fragment]').textContent, 'か');
advance(380); assert.equal(seal.phase, 'press'); advance(160); assert.equal(seal.phase, 'bloom');
assert.deepEqual(sounds, ['gallery-reveal', 'gallery-collect', 'gallery-unseal']);
ui.closeSeal(); const count = sounds.length; advance(5000);
assert.equal(sounds.length, count, 'closing the painting cancels pending chimes'); assert.equal(seal.hidden, true);
ui.imprint(record); advance(100); ui.imprint({ ...record, seal: { fragment: 'ら', order: 5 } });
advance(2900); assert.equal(seal.hidden, true); assert.equal(seal.phase, 'idle'); assert.equal(timers.size, 0);
assert.equal(seal.querySelector('[data-gallery-loop-imprint-fragment]').textContent, 'ら');
ui.hand(-.5); assert.equal(hand.hidden, false); advance(240); assert.equal(hand.phase, 'held');
ui.imprint(record); ui.cancel(); const stopped = sounds.length;
advance(6000); assert.equal(sounds.length, stopped); assert.equal(hand.hidden, true); assert.equal(seal.hidden, true);
reduced.matches = true; ui.imprint(record); assert.equal(seal.phase, 'press'); advance(1800); assert.equal(seal.hidden, true);
ui.cancel(); ui.cancel(); assert.equal(timers.size, 0);
assert.equal(cancelled.length, sounds.length, 'every sound handle is released exactly once');
console.log('Feedback passed: strike timing, correct fragment, early close, replace/reset, reduced motion, no delayed audio or leaked handles.');
