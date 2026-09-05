import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist/anime/manzokukyo-zannenin-cute');
const html = await readFile(path.join(output, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) assert(ids.includes(target), `Missing anchor: ${target}`);
for (const [, target] of html.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g)) {
  for (const id of target.split(' ')) assert(ids.includes(id), `Missing accessible target: ${id}`);
}
for (const [, target] of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) {
  assert((await stat(path.join(output, target))).isFile(), `Missing asset: ${target}`);
}
for (const name of ['zannenin.webp', 'believer-f.webp', 'believer-b.webp', 'title-logo.png', 'emblem.png']) {
  const metadata = await sharp(path.join(output, 'assets', name)).metadata();
  assert(metadata.hasAlpha, `${name} must preserve transparency`);
}

// Small DOM doubles test behavior without requiring a browser or new dependencies.
class Element {
  attrs = {}; listeners = {}; hidden = false; tabIndex = 0; textContent = ''; focused = false;
  classes = new Set();
  classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
  setAttribute(name, value) { this.attrs[name] = value; }
  getAttribute(name) { return this.attrs[name]; }
  addEventListener(name, callback) { (this.listeners[name] ??= []).push(callback); }
  fire(name, event = {}) { this.listeners[name]?.forEach(callback => callback(event)); }
  focus() { this.focused = true; }
}
const menu = new Element(); menu.attrs['aria-expanded'] = 'false';
menu.querySelector = () => new Element();
const nav = new Element(); const links = [new Element(), new Element()];
nav.querySelectorAll = () => links;
const tabs = ['z', 'f', 'b'].map(id => { const tab = new Element(); tab.attrs['aria-controls'] = `panel-${id}`; tab.querySelector = () => ({ textContent: { z: '残念院さん', f: '信者F', b: '信者B' }[id] }); return tab; });
const panels = tabs.map(() => new Element());
const prev = new Element(), next = new Element(), stage = new Element(), count = new Element();
const browser = new Element(); browser.querySelectorAll = () => tabs;
browser.querySelector = selector => ({ '[data-prev]': prev, '[data-next]': next, '.cast-stage': stage, '.cast-count': count })[selector];
const doc = new Element();
doc.querySelector = selector => ({ '.menu-button': menu, '.site-menu': nav, '[data-cast-browser]': browser })[selector];
doc.getElementById = id => panels[tabs.findIndex(tab => tab.attrs['aria-controls'] === id)];
const context = vm.createContext({ document: doc, window: {} });
vm.runInContext(await readFile(path.join(output, 'site.js'), 'utf8'), context);
function assertSelected(index) {
  tabs.forEach((tab, i) => {
    assert.equal(tab.attrs['aria-selected'], String(i === index));
    assert.equal(tab.tabIndex, i === index ? 0 : -1);
    assert.equal(panels[i].hidden, i !== index);
  });
  assert.equal(count.textContent, ['残念院さん', '信者F', '信者B'][index]);
}
tabs[1].fire('click'); assertSelected(1);
next.fire('click'); assertSelected(2);
next.fire('click'); assertSelected(0);
prev.fire('click'); assertSelected(2);
let prevented = false;
tabs[2].fire('keydown', { key: 'Home', preventDefault() { prevented = true; } });
assert(prevented); assertSelected(0); assert(tabs[0].focused);
tabs[0].fire('keydown', { key: 'End', preventDefault() {} }); assertSelected(2);
tabs[2].fire('keydown', { key: 'ArrowRight', preventDefault() {} }); assertSelected(0);
stage.fire('touchstart', { touches: [{ clientX: 220, clientY: 100 }] });
stage.fire('touchend', { changedTouches: [{ clientX: 90, clientY: 105 }] }); assertSelected(1);
stage.fire('touchstart', { touches: [{ clientX: 220, clientY: 100 }] });
stage.fire('touchend', { changedTouches: [{ clientX: 215, clientY: 280 }] }); assertSelected(1);
menu.fire('click'); assert.equal(menu.attrs['aria-expanded'], 'true'); assert(nav.classes.has('is-open'));
links[0].fire('click'); assert.equal(menu.attrs['aria-expanded'], 'false');
menu.fire('click'); doc.fire('keydown', { key: 'Escape' }); assert.equal(menu.attrs['aria-expanded'], 'false'); assert(menu.focused);
menu.fire('click'); doc.fire('click', { target: { closest: () => null } }); assert.equal(menu.attrs['aria-expanded'], 'false');
console.log('Cute teaser checks passed: links, images, alpha channels, tabs, keyboard, swipe, menu.');
