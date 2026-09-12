import assert from 'node:assert/strict';
import { createGalleryAchievements, achievementKey, mountAchievementBoard } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-achievements.js';
import { galleryDebugOptions } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-loop.js';
const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
const book = createGalleryAchievements(galleryDebugOptions, storage);
assert.equal(book.snapshot().total, 9); assert.ok(book.snapshot().entries.every(entry => entry.label === '？？？'));
book.record('receding-exit', true, true); book.record('normal', true); book.record('unknown', true);
assert.equal(values.size, 0, 'debug, normal and unknown exhibitions never unlock achievements');
book.record('negative', false); assert.equal(book.snapshot().encountered, 1); assert.equal(book.snapshot().solved, 0);
assert.equal(book.snapshot().entries[1].label, '絵の色が反転'); assert.equal(book.snapshot().entries[0].label, '？？？');
book.record('negative', true); book.record('negative', false); assert.equal(book.snapshot().solved, 1, 'later mistakes cannot downgrade a solved anomaly');
const second = createGalleryAchievements(galleryDebugOptions, storage); second.record('frame-hand', true); book.record('satisfaction', true);
assert.equal(second.snapshot().solved, 3, 'reloaded/other boards merge progress without losing earlier discoveries');
values.set(achievementKey, '{broken'); assert.equal(createGalleryAchievements(galleryDebugOptions, storage).snapshot().encountered, 0);
values.set(achievementKey, JSON.stringify({ unknown: 2, negative: 900, 'frame-hand': 2 }));
assert.equal(createGalleryAchievements(galleryDebugOptions, storage).snapshot().encountered, 1, 'invalid saved fields cannot inflate completion');
const blocked = createGalleryAchievements(galleryDebugOptions, { getItem() { throw Error(); }, setItem() { throw Error(); } });
blocked.record('satisfaction', true); assert.equal(blocked.snapshot().solved, 1, 'storage denial does not break play');

// Exercise the displayed cards: unrevealed labels never enter DOM text.
class Element {
  events = {}; textContent = ''; hidden = false; open = false;
  addEventListener(name, fn) { this.events[name] = fn; }
  removeEventListener(name) { delete this.events[name]; }
  setAttribute(name, value) { this[name] = value; }
  querySelector(name) { return this.children[name]; }
  querySelectorAll() { return cards; }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
}
const cards = galleryDebugOptions.slice(1).map(() => Object.assign(new Element(), { children: { strong: new Element(), small: new Element() } }));
const dialog = Object.assign(new Element(), { children: Object.fromEntries(['[data-achievement-count]', '[data-achievement-complete]', '[data-achievements-close]', '[data-achievements-viewing]', '[data-viewing-confirm]', '[data-viewing-accept]', '[data-viewing-cancel]'].map(key => [key, new Element()])) });
const trigger = new Element(); let busy = false, stopped = 0, viewing = false, switches = 0;
globalThis.document = { querySelector: selector => selector === '[data-gallery-achievements]' ? dialog : dialog.open ? dialog : null, querySelectorAll: () => [trigger] };
values.clear(); const displayBook = createGalleryAchievements(galleryDebugOptions, storage);
const board = mountAchievementBoard({ achievements: displayBook, canvas: { focus() {} }, exhibition: { stop() { stopped++; } }, canOpen: () => !busy, isViewing: () => viewing, enterViewing: () => { switches++; viewing = true; } });
assert.equal(trigger.textContent, '実績 0 / 9'); assert.ok(cards.every(card => card.children.strong.textContent === '？？？'));
busy = true; trigger.events.click(); assert.equal(dialog.open, false); busy = false; trigger.events.click(); assert.equal(dialog.open, true); assert.equal(stopped, 1);
displayBook.record('receding-exit', true); board.render(); assert.equal(cards.filter(card => card.children.strong.textContent !== '？？？').length, 1);
assert.equal(dialog.children['[data-achievement-complete]'].hidden, true);
for (const option of galleryDebugOptions.slice(1)) displayBook.record(option.kind, true);
board.render(); assert.equal(dialog.children['[data-achievement-complete]'].hidden, false);
const node = key => dialog.children[`[${key}]`];
node('data-achievements-viewing').events.click(); assert.equal(node('data-viewing-confirm').hidden, false); assert.equal(switches, 0);
node('data-viewing-cancel').events.click(); assert.equal(node('data-viewing-confirm').hidden, true); assert.equal(switches, 0);
node('data-achievements-viewing').events.click(); dialog.events.cancel({ preventDefault() {} });
assert.equal(dialog.open, true); assert.equal(node('data-viewing-confirm').hidden, true); assert.equal(switches, 0);
node('data-viewing-accept').events.click(); assert.equal(switches, 0, 'hidden confirmation cannot switch modes');
node('data-achievements-viewing').events.click(); busy = true; node('data-viewing-accept').events.click(); assert.equal(switches, 0);
busy = false; node('data-viewing-accept').events.click(); assert.equal(switches, 1); assert.equal(dialog.open, false);
node('data-viewing-accept').events.click(); assert.equal(switches, 1, 'double confirmation cannot reset twice');
trigger.events.click(); assert.equal(node('data-achievements-viewing').disabled, true); assert.equal(node('data-viewing-confirm').hidden, true);
board.dispose(); assert.equal(dialog.open, false); assert.equal(trigger.events.click, undefined);
console.log('Achievements passed: all nine hidden slots, encounter/solve, persistence/merge/corruption/storage denial, debug exclusion, visible completion and modal teardown.');
