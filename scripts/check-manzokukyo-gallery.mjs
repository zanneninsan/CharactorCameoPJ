import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderGalleryExperience } from './render-manzokukyo-gallery.mjs';

// This checks the actual renderer and executes the shipped state/timing functions.
// Small element stand-ins observe control states; layout and native dialogs are
// deliberately left to browser verification. No gallery source is rewritten.
const source = await readFile(new URL('../content/characters/zannenin/assets/site/manzokukyo-gallery.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../content/characters/zannenin/assets/site/manzokukyo-gallery.css', import.meta.url), 'utf8');
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const rendered = renderGalleryExperience({ id: 'zannenin', theme: {} }, { htmlPage: page => page, escapeHtml, assetVersionQuery: 'v=gallery-regression' });
const recordJson = rendered.body.match(/<script type="application\/json" data-gallery-records>([\s\S]*?)<\/script>/)?.[1];
assert.ok(recordJson, 'renderer exposes the gallery records to the experience module');
const { records, assetVersionQuery } = JSON.parse(recordJson);
const canonicalSeals = [
  { number: 2, order: 4, fragment: 'い' }, { number: 5, order: 1, fragment: 'び' },
  { number: 9, order: 2, fragment: 'あ' }, { number: 14, order: 6, fragment: 'か' },
  { number: 17, order: 3, fragment: 'ら' }, { number: 21, order: 5, fragment: 'と' },
];
assert.equal(records.length, 24, 'all original gallery records survive rendering');
assert.deepEqual(records.map(record => record.number), Array.from({ length: 24 }, (_, index) => index + 1));
assert.deepEqual(records.map(record => record.id), Array.from({ length: 24 }, (_, index) => String(index + 1).padStart(2, '0')));
assert.deepEqual(records.filter(record => record.seal).map(({ number, seal }) => ({ number, ...seal })), canonicalSeals, 'seal locations, original ordering and fragments remain unchanged');
assert.deepEqual([...rendered.body.matchAll(/data-gallery-index="(\d+)"/g)].map(match => Number(match[1])), Array.from({ length: 24 }, (_, index) => index));
assert.deepEqual([...rendered.body.matchAll(/data-seal-slot="(\d+)"/g)].map(match => Number(match[1])), [1, 2, 3, 4, 5, 6]);
assert.equal((rendered.body.match(/class="gallery-seal"/g) || []).length, 6);
assert.equal(new Set(records.map(record => record.shelf)).size, 4);
for (const record of records) {
  assert.ok(rendered.body.includes(`gallery-${record.id}.avif?${assetVersionQuery}`));
  assert.ok(rendered.body.includes(`gallery-${record.id}.webp?${assetVersionQuery}`));
}
assert.match(rendered.body, /data-gallery-exit/);
assert.match(rendered.body, /\.\.\/red-house\//, 'the existing next room remains the destination');
assert.match(rendered.body, /manzokukyo-gallery\.js\?/);
assert.match(rendered.body, /manzokukyo-gallery\.css\?/);

// Ask JavaScript's parser where the real declaration ends, instead of guessing
// at braces inside Japanese templates, strings or nested callbacks.
function declaration(marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `source declaration exists: ${marker}`);
  let end = source.indexOf('\n', start);
  while (end !== -1) {
    const candidate = source.slice(start, end);
    try { new vm.Script(candidate); return candidate; } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    end = source.indexOf('\n', end + 1);
  }
  throw Error(`Could not isolate complete source declaration: ${marker}`);
}

class Element {
  constructor() {
    this.children = new Map(); this.attributes = new Map(); this.dataset = {}; this.hidden = false;
    this.disabled = false; this.open = false; this.value = ''; this.textContent = '';
    this.offsetWidth = 600; this.href = 'https://example.test/zannenin/manzokukyo/truth/red-house/';
    const classes = new Set();
    this.classList = { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name), toggle: (name, force = !classes.has(name)) => { if (force) classes.add(name); else classes.delete(name); return force; } };
  }
  querySelector(selector) { if (!this.children.has(selector)) this.children.set(selector, new Element()); return this.children.get(selector); }
  querySelectorAll(selector) { if (selector === '.gallery-orbit-seal strong') return Array.from({ length: 6 }, (_, index) => this.querySelector(`${selector}:${index}`)); return []; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  get href() { return this.attributes.get('href') ?? ''; }
  set href(value) { this.attributes.set('href', String(value)); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
}

function createHarness({ saved = {}, blockedStorage = false, reduced = false } = {}) {
  const store = new Map(Object.entries(saved));
  const writes = [], sounds = [], navigation = [], listeners = new Map(), frames = new Map();
  let frameId = 0, now = 1000, soundEnables = 0, soundSilences = 0;
  const elements = Object.fromEntries(['page', 'dialog', 'collect', 'imprint', 'note', 'form', 'answer', 'submit', 'message', 'exit', 'ledger', 'wordTray', 'undo', 'ceremony', 'stage', 'continueButton', 'skipButton'].map(name => [name, new Element()]));
  const root = new Element();
  const document = { hidden: false, body: new Element(), documentElement: new Element(), querySelector: selector => root.querySelector(selector), addEventListener: (type, callback) => listeners.set(`document:${type}`, callback) };
  const sharedSound = { enabled: true, state: () => ({ enabled: true, musicVolume: .37, effectsVolume: .52, consentGiven: true }),
    play(name, options) { const sound = { name, options, cancelled: false }; sounds.push(sound); return () => { sound.cancelled = true; }; },
    enable() { soundEnables++; return Promise.resolve(true); }, silence() { soundSilences++; }, resumeMusic() { return Promise.resolve(true); } };
  const sandbox = {
    console, ...elements, records, assetVersionQuery,
    seals: records.filter(record => record.seal).sort((a, b) => a.seal.order - b.seal.order),
    reducedMotion: { matches: reduced }, document, sound: sharedSound,
    room: { navigate: destination => navigation.push(destination) },
    sessionStorage: { getItem: key => { if (blockedStorage) throw Error('Storage denied'); return store.get(key) ?? null; }, setItem: (key, value) => { if (blockedStorage) throw Error('Storage denied'); writes.push([key, value]); store.set(key, value); } },
    requestAnimationFrame: callback => { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    window: { addEventListener: (type, callback) => listeners.set(`window:${type}`, callback), location: { href: '' } },
  };
  const context = vm.createContext(sandbox);
  const stateStart = source.indexOf('const storageKey =');
  const stateEnd = source.indexOf('const playing =', stateStart);
  assert.ok(stateStart > -1 && stateEnd > stateStart);
  const functionNames = ['play', 'stopSounds', 'stopTimeline', 'syncModalLock', 'tick', 'animate', 'setLedger', 'scrollToArea', 'renderPuzzle', 'showRecord', 'closeRecord', 'collectSeal', 'finishRelease', 'beginCeremony', 'closeCeremony', 'submitWord', 'leaveGallery'];
  const executable = [source.slice(stateStart, stateEnd), declaration('const playing ='), declaration('const solved ='), declaration('const exitHref ='),
    ...functionNames.map(name => declaration(`function ${name}(`)),
    declaration("document.addEventListener('visibilitychange'"), declaration("window.addEventListener('pagehide'"), declaration("window.addEventListener('pageshow'"),
    'globalThis.readState = () => ({found:[...found], count:found.size, cleared, phase, elapsed:timeline?.elapsed ?? null, currentRecord:dialog.open ? records[current].number : null});',
    'renderPuzzle();'].join('\n');
  new vm.Script(executable, { filename: 'gallery-shipped-functions.js' }).runInContext(context);
  const call = (name, ...args) => context[name](...args);
  function run(milliseconds, step = 10) {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += step) {
      now += step;
      const callbacks = [...frames.values()]; frames.clear();
      for (const callback of callbacks) callback(now);
    }
  }
  function visibility(hidden) { document.hidden = hidden; listeners.get('document:visibilitychange')?.({}); }
  function event(type, details = {}) { listeners.get(`window:${type}`)?.(details); }
  function clickExit(modifiers = {}) {
    const event = { button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...modifiers };
    call('leaveGallery', event); return event;
  }
  return { call, run, visibility, event, clickExit, elements, store, writes, sounds, navigation, frames,
    state: () => JSON.parse(JSON.stringify(context.readState())), counters: () => ({ soundEnables, soundSilences }) };
}

const sealsKey = 'manzokukyo-gallery-seals-v2', clearedKey = 'manzokukyo-gallery-cleared-v2';
const sealNumbers = canonicalSeals.map(record => record.number);
const allSeals = { [sealsKey]: JSON.stringify(sealNumbers) };
const fresh = createHarness();
assert.equal(fresh.state().count, 0);
assert.equal(fresh.elements.answer.disabled, true);
assert.equal(fresh.elements.exit.getAttribute('aria-disabled'), 'true');
assert.equal(fresh.elements.exit.getAttribute('href'), null, 'a locked exit has no live link destination');
assert.equal(fresh.call('submitWord', 'あかいとびら').unavailable, true, 'knowing the word never skips collecting the seals');
assert.equal(fresh.clickExit().defaultPrevented, true, 'normal activation cannot use the locked exit');
for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
  assert.equal(fresh.clickExit(modifiers).defaultPrevented, true, 'modified activation cannot bypass a locked exit');
}
assert.equal(fresh.navigation.length, 0);
fresh.call('showRecord', 0);
assert.equal(fresh.call('collectSeal'), false, 'ordinary records never supply a seal');
fresh.call('showRecord', 1);
assert.equal(fresh.call('collectSeal'), true);
assert.equal(fresh.state().count, 1);
assert.equal(fresh.state().phase, 'collecting');
assert.equal(fresh.call('collectSeal'), false, 'a rapid second press cannot duplicate a seal');
fresh.run(1300);
assert.equal(fresh.state().phase, 'idle');
assert.equal(fresh.call('collectSeal'), false, 'a completed seal cannot be collected twice');
assert.deepEqual(JSON.parse(fresh.store.get(sealsKey)), [2]);
assert.equal(fresh.writes.filter(([key]) => key === sealsKey).length, 1);
fresh.call('showRecord', 4); fresh.call('collectSeal'); fresh.run(100); fresh.call('closeRecord');
assert.equal(fresh.frames.size, 0, 'closing a record cancels its pending imprint animation');
fresh.run(5000);
assert.equal(fresh.state().count, 2, 'closing mid-imprint retains the one already collected seal');
assert.equal(fresh.state().phase, 'idle');
assert.equal(fresh.sounds.filter(sound => sound.name === 'gallery-collect').at(-1).cancelled, true);

for (const invalid of ['{broken', 'null', '{}', '"2"']) {
  const harness = createHarness({ saved: { [sealsKey]: invalid } });
  assert.equal(harness.state().count, 0, 'invalid saved collections degrade to an empty set');
  assert.equal(harness.state().cleared, false);
}
const restored = createHarness({ saved: { [sealsKey]: '[2,2,5,1,999,"9",null]', unrelated: 'preserve me' } });
assert.deepEqual(restored.state().found, [2, 5], 'restoration keeps only unique valid numeric seal records');
assert.equal(restored.store.get('unrelated'), 'preserve me');
const unavailableStorage = createHarness({ blockedStorage: true });
unavailableStorage.call('showRecord', 1); assert.equal(unavailableStorage.call('collectSeal'), true);
unavailableStorage.run(1300); assert.equal(unavailableStorage.state().count, 1, 'storage denial does not break the in-memory game');
const previousClear = createHarness({ saved: { ...allSeals, [clearedKey]: '1', unrelated: 'preserve me' } });
assert.equal(previousClear.state().cleared, true, 'the existing session completion key remains compatible');
assert.equal(previousClear.elements.exit.getAttribute('aria-disabled'), 'false');
assert.equal(previousClear.clickExit({ ctrlKey: true }).defaultPrevented, false, 'an unlocked exit preserves modified-click behavior');
assert.equal(previousClear.store.get('unrelated'), 'preserve me');

const finalSeal = createHarness({ saved: { [sealsKey]: JSON.stringify(sealNumbers.slice(0, 5)) } });
finalSeal.call('showRecord', 20); finalSeal.call('collectSeal'); finalSeal.run(1300);
assert.equal(finalSeal.state().count, 6);
assert.equal(finalSeal.state().phase, 'gathering');
assert.equal(finalSeal.state().cleared, false, 'six collected seals alone never unlock the exit');
assert.equal(finalSeal.elements.ceremony.open, true);
finalSeal.call('closeCeremony'); finalSeal.run(6000);
assert.equal(finalSeal.state().cleared, false, 'skipping the gathering ceremony never skips the answer');
assert.equal(finalSeal.elements.answer.disabled, false);
assert.equal(finalSeal.elements.exit.getAttribute('aria-disabled'), 'true');
assert.equal(finalSeal.call('submitWord', 'びあらいとか').accepted, false, 'the collected fragment order is not the solution');
assert.throws(() => finalSeal.call('submitWord', 'あ'.repeat(33)), /at most 32/);
assert.throws(() => finalSeal.call('submitWord', null), /at most 32/);
assert.equal(finalSeal.call('submitWord', ' あ か\nい　と び ら ').accepted, true, 'the original answer accepts whitespace normalization');
assert.equal(finalSeal.state().cleared, false, 'successful input starts the release, without unlocking early');
assert.equal(finalSeal.state().phase, 'releasing');
finalSeal.run(4200); assert.equal(finalSeal.state().cleared, false);
finalSeal.run(300); assert.equal(finalSeal.state().cleared, true);
assert.equal(finalSeal.store.get(clearedKey), '1');
assert.equal(finalSeal.elements.exit.getAttribute('aria-disabled'), 'false');
finalSeal.call('closeCeremony');
assert.equal(finalSeal.clickExit().defaultPrevented, true);
finalSeal.run(1900);
assert.deepEqual(finalSeal.navigation, ['https://example.test/zannenin/manzokukyo/truth/red-house/'], 'the opened door navigates through the existing shared room host');
assert.deepEqual(finalSeal.counters(), { soundEnables: 0, soundSilences: 0 }, 'puzzle and door actions never enable or replace shared audio');

const skipped = createHarness({ saved: allSeals });
skipped.call('submitWord', 'あかいとびら'); skipped.run(100); skipped.call('closeCeremony');
assert.equal(skipped.state().cleared, true, 'skip can finish a release only after the correct answer');
assert.equal(skipped.frames.size, 0);
assert.equal(skipped.sounds.find(sound => sound.name === 'gallery-unseal').cancelled, true);
skipped.run(10000); assert.equal(skipped.writes.filter(([key]) => key === clearedKey).length, 1, 'no stale release callback runs after skip');

const background = createHarness({ saved: allSeals });
background.call('submitWord', 'あかいとびら'); background.run(1000);
const elapsedBeforeHidden = background.state().elapsed;
background.visibility(true); background.run(10000);
assert.equal(background.state().elapsed, elapsedBeforeHidden, 'hidden time never advances the release clock');
assert.equal(background.state().cleared, false);
assert.equal(background.sounds.find(sound => sound.name === 'gallery-unseal').cancelled, true);
assert.deepEqual(background.counters(), { soundEnables: 0, soundSilences: 0 }, 'a hosted gallery leaves context visibility management to its parent');
background.visibility(false); background.run(500); assert.equal(background.state().cleared, false);
background.run(4000); assert.equal(background.state().cleared, true);

const reduced = createHarness({ saved: allSeals, reduced: true });
reduced.call('submitWord', 'あかいとびら'); reduced.run(250);
assert.equal(reduced.state().cleared, true, 'reduced motion uses the short release path');
const reducedImprint = createHarness({ reduced: true });
reducedImprint.call('showRecord', 1); reducedImprint.call('collectSeal'); reducedImprint.run(200);
assert.equal(reducedImprint.state().phase, 'idle', 'reduced motion also shortens the imprint');
const restoredImprint = createHarness();
restoredImprint.call('showRecord', 1); restoredImprint.call('collectSeal'); restoredImprint.run(100);
restoredImprint.event('pagehide'); assert.equal(restoredImprint.frames.size, 0);
restoredImprint.event('pageshow', { persisted: true });
assert.equal(restoredImprint.state().phase, 'idle');
assert.equal(restoredImprint.state().count, 1);
assert.ok(!restoredImprint.elements.dialog.open || (restoredImprint.elements.imprint.dataset.stage === 'collected' && restoredImprint.elements.collect.hidden), 'BFCache restoration settles a cancelled imprint instead of leaving a pressed, disabled control');
const restoredRelease = createHarness({ saved: allSeals });
restoredRelease.call('submitWord', 'あかいとびら'); restoredRelease.run(100);
restoredRelease.event('pagehide'); restoredRelease.event('pageshow', { persisted: true });
assert.equal(restoredRelease.state().cleared, true);
assert.equal(restoredRelease.frames.size, 0);

assert.doesNotMatch(source, /new\s+(?:window\.)?(?:AudioContext|webkitAudioContext)\b/, 'gallery never creates a private audio context');
assert.doesNotMatch(source, /\baudio\.play\(/, 'gallery never starts its own HTML audio element');
assert.match(source, /createSound\(audio,/);
for (const name of ['gallery-reveal', 'gallery-collect', 'gallery-complete', 'gallery-unseal', 'gallery-door']) assert.ok(source.includes(`'${name}'`));
assert.match(css, /\.gallery-paused\s+\.gallery-ceremony\s+\*\s*\{[^}]*animation-play-state:\s*paused/, 'background CSS animations pause with the JavaScript clock');
console.log('PASS: 24 records; original six seals and answer; duplicate/early collection guards; storage recovery; close/skip; timed release; background; reduced motion; BFCache; guarded exit; shared audio.');
