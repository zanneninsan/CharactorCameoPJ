import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderGallery3DExperience } from './render-manzokukyo-gallery-3d.mjs';

// Exercise the shipped DOM listeners and navigation functions, with actual
// renderer attributes. Rendering and camera interpolation remain browser checks.
const source = await readFile(new URL('../content/characters/zannenin/assets/site/manzokukyo-gallery-3d.js', import.meta.url), 'utf8');
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const { body } = renderGallery3DExperience({ id: 'zannenin', theme: {} }, { htmlPage: page => page, escapeHtml, assetVersionQuery: 'v=3d-regression' });
const { records } = JSON.parse(body.match(/<script type="application\/json" data-gallery-records>([\s\S]*?)<\/script>/)[1]);
const tags = [...body.matchAll(/<[a-z][^>]*\bdata-gallery[^>]*>/g)].map(match => match[0]);

function attributes(tag) {
  return new Map([...tag.matchAll(/\s([a-z][\w-]*)(?:="([^"]*)")?/g)].map(match => [match[1], match[2] ?? '']));
}

class Element {
  constructor(tag) {
    this.attributes = attributes(tag);
    this.textContent = ''; this.hidden = false; this.listeners = new Map();
    const classes = new Set();
    this.classList = { contains: name => classes.has(name), toggle: (name, force = !classes.has(name)) => { if (force) classes.add(name); else classes.delete(name); return force; } };
  }
  get dataset() {
    // DOMStringMap only removes a dash followed by an ASCII lowercase letter.
    // data-gallery-3d-room-jump therefore becomes gallery-3dRoomJump.
    return Object.fromEntries([...this.attributes].filter(([name]) => name.startsWith('data-')).map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(type, handler) { const handlers = this.listeners.get(type) ?? []; handlers.push(handler); this.listeners.set(type, handlers); }
  dispatch(type, extra = {}) { const event = { target: this, currentTarget: this, preventDefault() { this.defaultPrevented = true; }, ...extra }; for (const handler of this.listeners.get(type) ?? []) handler(event); return event; }
  scrollIntoView() { this.scrolled = true; }
  focus() { this.focused = true; }
}

function declaration(text, marker) {
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `actual declaration exists: ${marker}`);
  let end = text.indexOf('\n', start);
  while (end !== -1) {
    const candidate = text.slice(start, end);
    try { new vm.Script(candidate); return candidate; } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    end = text.indexOf('\n', end + 1);
  }
  throw Error(`Cannot isolate actual declaration: ${marker}`);
}

function createHarness(text = source) {
  const elements = tags.map(tag => new Element(tag));
  const queryAll = selector => {
    const name = selector.match(/^\[([\w-]+)\]$/)?.[1];
    assert.ok(name, `supported attribute selector: ${selector}`);
    return elements.filter(element => element.attributes.has(name));
  };
  const query = selector => { const matches = queryAll(selector); assert.equal(matches.length, 1, `rendered control exists once: ${selector}`); return matches[0]; };
  const stage = { querySelector: query, querySelectorAll: queryAll };
  const catalog = { querySelectorAll: queryAll, hidden: false, scrollIntoView() { this.scrolled = true; } };
  const canvas = query('[data-gallery-3d-canvas]');
  const jumps = queryAll('[data-gallery-3d-room-jump]');
  const cards = queryAll('[data-gallery-index]');
  const loads = [], destinations = [], sounds = [], inspections = [];
  const camera = { fov: 49, aspect: 1.6 };
  const frames = records.map((record, index) => ({ roomIndex: Math.floor(index / 6), side: index % 2 === 0 ? -1 : 1, z: -3 - Math.floor((index % 6) / 2) * 4.5 - Math.floor(index / 6) * 16, width: 2.12, height: 2.12 * 1080 / 768 }));
  class Vector3 { constructor(x, y, z) { Object.assign(this, { x, y, z }); } }
  const context = vm.createContext({ stage, catalog, canvas, records, frames, camera,
    document: { querySelectorAll: queryAll }, motion: { matches: false },
    listButton: query('[data-gallery-3d-list]'),
    gallery: { play: (name, options) => sounds.push({ name, options }), showRecord: index => { inspections.push(index); return true; } },
    T: { Vector3, MathUtils: { degToRad: degrees => degrees * Math.PI / 180 } },
    loadRoom: room => { assert.ok(Number.isInteger(room) && room >= 0 && room < 4, 'only finite room IDs can load textures'); loads.push(room); },
    destination: (position, target, immediate) => { assert.ok([...Object.values(position), ...Object.values(target)].every(Number.isFinite), 'camera destination stays finite'); destinations.push({ position, target, immediate }); },
  });
  const markers = [
    'function setCatalog(', 'function updateSelection(', 'function inspect(', 'function select(', 'function overview(',
    "stage.querySelector('[data-gallery-3d-prev]').addEventListener",
    "stage.querySelector('[data-gallery-3d-next]').addEventListener",
    "stage.querySelector('[data-gallery-3d-inspect]').addEventListener",
    "stage.querySelector('[data-gallery-3d-overview]').addEventListener",
    "listButton.addEventListener('click'",
    "for (const button of stage.querySelectorAll('[data-gallery-3d-room-jump]')) button.addEventListener",
    "for (const button of catalog.querySelectorAll('[data-gallery-index]')) button.addEventListener",
    "for (const button of document.querySelectorAll('[data-gallery-restart]')) button.addEventListener",
    "canvas.addEventListener('keydown'",
  ];
  vm.runInContext(`let selected = 0, selectedIndex = 0, mode = 'overview';\nconst exhibition = { select, overview };\n${markers.map(marker => declaration(text, marker)).join('\n')}\nupdateSelection(0);`, context);
  const state = () => JSON.parse(vm.runInContext('JSON.stringify({ selected, selectedIndex, mode })', context));
  const snapshot = () => JSON.stringify({ ...state(), loads, destinations, labels: ['room', 'record', 'inspect'].map(name => query(`[data-gallery-3d-${name}]`).textContent), pressed: jumps.map(button => button.getAttribute('aria-pressed')), current: cards.map(button => button.classList.contains('is-current')) });
  return { context, query, queryAll, jumps, cards, canvas, catalog, loads, destinations, sounds, inspections, state, snapshot };
}

// Every literal 3D data selector in the scene resolves to actual renderer markup.
for (const name of new Set([...source.matchAll(/\[(data-gallery-3d-[a-z-]+)\]/g)].map(match => match[1]))) {
  assert.ok(tags.some(tag => attributes(tag).has(name)), `renderer supplies ${name}`);
}

function checkRoomButtons(harness) {
  const { jumps, state, loads, destinations, cards, query } = harness;
  assert.deepEqual(jumps.map(button => button.getAttribute('data-gallery-3d-room-jump')), ['0', '1', '2', '3']);
  for (const [index, button] of jumps.entries()) {
    assert.equal(button.dataset['gallery-3dRoomJump'], String(index));
    assert.equal(button.dataset.gallery3dRoomJump, undefined, 'the mock must not invent a nonexistent dataset alias');
  }
  for (const room of [1, 2, 3, 0, 3, 1, 2, 0]) {
    const before = loads.length;
    jumps[room].dispatch('click');
    assert.equal(loads.length, before + 1, 'actual room button initiates navigation');
    assert.equal(loads.at(-1), room);
    assert.deepEqual(state(), { selected: room * 6, selectedIndex: room * 6, mode: 'overview' });
    assert.equal(destinations.at(-1).position.z, 2 - room * 16);
    assert.equal(destinations.at(-1).target.z, -10 - room * 16);
    assert.deepEqual(jumps.map(button => button.getAttribute('aria-pressed')), jumps.map((_, index) => String(index === room)), 'actual button attributes drive active-room display');
    assert.equal(query('[data-gallery-3d-room]').textContent, `展示室 ${['I', 'II', 'III', 'IV'][room]} / IV`);
    assert.equal(query('[data-gallery-3d-record]').textContent, `記録 ${String(room * 6 + 1).padStart(2, '0')} / 24`);
    assert.deepEqual(cards.filter(button => button.classList.contains('is-current')).map(button => Number(button.dataset.galleryIndex)), [room * 6]);
  }
}

const harness = createHarness();
checkRoomButtons(harness);
assert.equal(harness.cards.length, 24);
for (const index of [0, 5, 6, 11, 12, 17, 18, 23]) {
  harness.cards[index].dispatch('click');
  assert.deepEqual(harness.state(), { selected: index, selectedIndex: index, mode: 'artwork' });
  assert.equal(harness.loads.at(-1), Math.floor(index / 6));
}
harness.query('[data-gallery-3d-next]').dispatch('click');
assert.equal(harness.state().selected, 0, 'next wraps from the last record');
harness.query('[data-gallery-3d-prev]').dispatch('click');
assert.equal(harness.state().selected, 23, 'previous wraps from the first record');
assert.equal(harness.canvas.dispatch('keydown', { key: 'ArrowRight' }).defaultPrevented, true);
assert.equal(harness.state().selected, 0, 'actual canvas keyboard handler wraps');
harness.query('[data-gallery-3d-inspect]').dispatch('click');
assert.equal(harness.inspections.at(-1), 0, 'inspect uses the selected record');
harness.cards[20].dispatch('click');
harness.query('[data-gallery-3d-overview]').dispatch('click');
assert.deepEqual(harness.state(), { selected: 18, selectedIndex: 18, mode: 'overview' });
harness.query('[data-gallery-3d-list]').dispatch('click');
assert.equal(harness.catalog.hidden, true);
assert.equal(harness.query('[data-gallery-3d-list]').getAttribute('aria-expanded'), 'false');
harness.query('[data-gallery-3d-list]').dispatch('click');
assert.equal(harness.catalog.hidden, false);

// Invalid direct navigation or corrupt button attributes must leave both camera
// destinations and selected UI untouched, even after visiting the final room.
const invalidCommon = [NaN, undefined, Infinity, -Infinity, -1, .5, '2', null];
for (const [name, invalid] of [['overview', [...invalidCommon, 4]], ['select', [...invalidCommon, 24]], ['updateSelection', [...invalidCommon, 24]]]) {
  for (const value of invalid) {
    const before = harness.snapshot();
    harness.context.invalidValue = value;
    vm.runInContext(`${name}(invalidValue)`, harness.context);
    assert.equal(harness.snapshot(), before, `${name} rejects ${String(value)} without corrupting navigation`);
  }
}
for (const value of ['not-a-room', 'NaN', '-1', '4', '1.5', 'Infinity']) {
  const before = harness.snapshot();
  harness.jumps[0].setAttribute('data-gallery-3d-room-jump', value);
  harness.jumps[0].dispatch('click');
  assert.equal(harness.snapshot(), before, `actual room click rejects malformed attribute ${value}`);
}
harness.jumps[0].setAttribute('data-gallery-3d-room-jump', '0');

// Sensitivity check: reintroducing the reported dataset read in memory must
// fail the same real-button regression. No source file is modified.
const legacyRead = source.replaceAll("button.getAttribute('data-gallery-3d-room-jump')", 'button.dataset.gallery3dRoomJump');
assert.notEqual(legacyRead, source, 'legacy mutation targets the shipped attribute reads');
assert.throws(() => checkRoomButtons(createHarness(legacyRead)), { name: 'AssertionError' }, 'room-button regression detects the original browser bug');

console.log('Gallery 3D checks passed: real room buttons and active labels, 24-record navigation, keyboard/list controls, invalid-input camera guards, legacy dataset regression.');
