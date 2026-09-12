import assert from 'node:assert/strict';
import { loadGalleryImage, cancelGalleryImage } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-image.js';
const pending = [];
const image = {
  style: {}, naturalWidth: 600, events: {},
  set src(value) { assert.equal(this.style.visibility, 'hidden', 'hide the old bitmap before assigning another URL'); this.url = value; },
  addEventListener(name, fn) { this.events[name] = fn; },
  removeEventListener(name) { delete this.events[name]; },
  decode() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
};
const ready = [], errors = [];
const open = name => loadGalleryImage(image, name, () => ready.push(name), () => errors.push(name));
open('first'); open('second'); pending[0].resolve(); await Promise.resolve();
assert.equal(image.style.visibility, 'hidden'); assert.deepEqual(ready, [], 'old decode cannot reveal the next request');
pending[1].resolve(); await Promise.resolve(); assert.equal(image.style.visibility, 'visible'); assert.deepEqual(ready, ['second']);
open('closed'); cancelGalleryImage(image); pending[2].resolve(); await Promise.resolve();
assert.equal(image.style.visibility, 'hidden'); assert.deepEqual(ready, ['second']);
open('error'); pending[3].reject(Error('network')); await Promise.resolve();
assert.equal(image.style.visibility, 'hidden'); assert.deepEqual(errors, ['error']);
image.decode = () => Promise.resolve(); open('cached'); assert.equal(image.style.visibility, 'hidden');
await Promise.resolve(); assert.equal(image.style.visibility, 'visible'); assert.equal(ready.at(-1), 'cached');
console.log('Inspection image passed: hide before src changes, late decode, close, error and cached decode.');
