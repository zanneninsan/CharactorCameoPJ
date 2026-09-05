import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Run after the site build. These checks protect deployable room URLs and the
// bridge that keeps audio alive; they neither rebuild pages nor decode media.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const previewPath = 'zannenin/manzokukyo-preview/';
const canonicalPath = 'zannenin/manzokukyo/';
const rooms = [
  { id: 'corridor', route: '', legacy: false },
  { id: 'truth', route: 'truth/', legacy: false },
  { id: 'gallery', route: 'truth/gallery/', legacy: true },
  { id: 'red-house', route: 'truth/red-house/', legacy: true },
  { id: 'archive', route: 'truth/red-house/archive/', legacy: true, novel: true },
  { id: 'novel', route: 'novel/', legacy: true, novel: true }
];
const deployments = [new URL('http://local.test/'), new URL('https://pages.test/CharactorCameoPJ/')];
const checkedAssets = new Set();

function decodeHtml(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    return String.fromCodePoint(Number.parseInt(entity.slice(entity[2].toLowerCase() === 'x' ? 3 : 2, -1), entity[2].toLowerCase() === 'x' ? 16 : 10));
  });
}

function attributes(tag) {
  const values = new Map();
  for (const match of tag.matchAll(/\s([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    values.set(match[1].toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return values;
}

function tags(html) {
  // Ignore markup-looking text inside scripts and styles, while keeping each
  // opening tag and its original position for the bridge-before-base check.
  const markup = html.replace(/<!--[\s\S]*?-->|(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (match, opening, _name, body, closing) => opening ? opening + ' '.repeat(body.length) + closing : ' '.repeat(match.length));
  return [...markup.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)].map(match => ({ name: match[1].toLowerCase(), attrs: attributes(match[0]), index: match.index }));
}

function localFile(url, deployment) {
  assert.equal(url.origin, deployment.origin);
  assert.ok(url.pathname.startsWith(deployment.pathname), `Asset escapes deployment prefix: ${url.href}`);
  const relative = decodeURIComponent(url.pathname.slice(deployment.pathname.length));
  const filename = path.resolve(dist, relative);
  assert.ok(filename.startsWith(dist + path.sep), `Asset escapes dist: ${url.href}`);
  return url.pathname.endsWith('/') ? path.join(filename, 'index.html') : filename;
}

async function requireLocalAsset(href, base, deployment, context) {
  if (!href || href.startsWith('#')) return;
  const url = new URL(href, base);
  if (url.origin !== deployment.origin || !['http:', 'https:'].includes(url.protocol)) return;
  const filename = localFile(url, deployment);
  if (checkedAssets.has(filename)) return;
  const entry = await stat(filename).catch(() => null);
  assert.ok(entry?.isFile(), `${context}: missing local asset ${url.pathname}`);
  checkedAssets.add(filename);
}

async function checkAssetReferences(html, elements, documentUrl, deployment, context) {
  let base = documentUrl;
  for (const element of elements) {
    if (element.name === 'base') { base = new URL(element.attrs.get('href'), documentUrl); continue; }
    if (element.attrs.has('src')) await requireLocalAsset(element.attrs.get('src'), base, deployment, context);
    if (element.name === 'link' && element.attrs.has('href')) await requireLocalAsset(element.attrs.get('href'), base, deployment, context);
    if (element.attrs.has('poster')) await requireLocalAsset(element.attrs.get('poster'), base, deployment, context);
    const srcset = element.attrs.get('srcset');
    if (srcset && !srcset.trim().startsWith('data:')) {
      for (const candidate of srcset.split(',')) await requireLocalAsset(candidate.trim().split(/\s+/)[0], base, deployment, context);
    }
  }
  // Backgrounds inside each HTML document also resolve against its final base.
  const inlineStyles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map(match => match[1]);
  inlineStyles.push(...elements.map(element => element.attrs.get('style') || ''));
  for (const css of inlineStyles) {
    for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
      await requireLocalAsset(decodeHtml((match[1] ?? match[2] ?? match[3]).trim()), base, deployment, context);
    }
  }
}

for (const room of rooms) {
  const shell = await readFile(path.join(dist, previewPath, room.route, 'index.html'), 'utf8');
  const view = await readFile(path.join(dist, previewPath, 'views', `${room.id}.html`), 'utf8');
  const shellTags = tags(shell);
  const viewTags = tags(view);
  for (const id of ['room-host', 'room-loading', 'room-error', 'room-announcement']) {
    assert.equal(shellTags.filter(element => element.attrs.get('id') === id).length, 1, `${room.id}: one shell ${id}`);
  }
  assert.equal(shellTags.find(element => element.attrs.get('id') === 'room-loading').attrs.get('role'), 'status');
  assert.equal(shellTags.find(element => element.attrs.get('id') === 'room-announcement').attrs.get('aria-live'), 'polite');
  assert.ok(shellTags.some(element => element.attrs.has('data-retry')), `${room.id}: retry control`);
  assert.ok(shellTags.some(element => element.attrs.has('data-fallback')), `${room.id}: fallback link`);
  assert.ok(shellTags.some(element => element.name === 'noscript'), `${room.id}: no-script fallback`);
  assert.ok(viewTags.some(element => element.name === 'meta' && element.attrs.get('name') === 'robots' && element.attrs.get('content')?.includes('noindex')), `${room.id}: embedded view is noindex`);
  assert.equal(viewTags.find(element => element.name === 'body').attrs.has('data-session-legacy'), room.legacy, `${room.id}: correct room controller`);
  assert.equal(viewTags.filter(element => element.name === 'base').length, 1, `${room.id}: one logical page base`);
  const baseTag = viewTags.find(element => element.name === 'base');
  const bridge = viewTags.find(element => element.name === 'script' && /(?:^|\/)room-bridge\.js(?:\?|$)/.test(element.attrs.get('src') || ''));
  assert.ok(bridge && bridge.index < baseTag.index, `${room.id}: bridge must load before base changes script resolution`);
  assert.ok(!bridge.attrs.has('async') && !bridge.attrs.has('defer') && bridge.attrs.get('type') !== 'module', `${room.id}: bridge must attach before room scripts run`);

  for (const deployment of deployments) {
    const previewUrl = new URL(previewPath, deployment);
    const shellUrl = new URL(room.route, previewUrl);
    const viewUrl = new URL(`views/${room.id}.html`, previewUrl);
    const appScript = shellTags.find(element => element.name === 'script' && element.attrs.get('type') === 'module');
    assert.ok(appScript?.attrs.get('src'), `${room.id}: shell app module`);
    for (const entryUrl of [shellUrl, new URL('index.html', shellUrl)]) {
      assert.equal(new URL(appScript.attrs.get('src'), entryUrl).pathname, new URL('app.js', previewUrl).pathname, `${room.id}: app resolves from direct/deep links`);
    }
    const logicalUrl = new URL(baseTag.attrs.get('href'), viewUrl);
    assert.equal(logicalUrl.href, new URL((room.legacy ? canonicalPath : previewPath) + room.route, deployment).href, `${room.id}: original asset and link base preserved`);
    assert.equal(new URL(bridge.attrs.get('src'), viewUrl).pathname, new URL('room-bridge.js', previewUrl).pathname, `${room.id}: bridge resolves before base`);
    if (room.novel) {
      const scriptUrls = viewTags.filter(element => element.name === 'script' && element.attrs.has('src')).map(element => new URL(element.attrs.get('src'), element.index < baseTag.index ? viewUrl : logicalUrl));
      assert.equal(scriptUrls.filter(url => url.pathname === new URL('novel-view.js', previewUrl).pathname).length, 1, `${room.id}: shared-audio novel controller installed`);
      assert.ok(scriptUrls.every(url => !url.pathname.endsWith('/manzokukyo-novel.js')), `${room.id}: independent novel audio controller removed`);
    }
    await checkAssetReferences(shell, shellTags, shellUrl, deployment, `${room.id} shell`);
    await checkAssetReferences(view, viewTags, viewUrl, deployment, `${room.id} view`);
  }
  if (room.id === 'gallery') {
    assert.match(view, /assets\/site\/manzokukyo-gallery\.js/, 'Gallery must load its shared controller');
    const galleryController = await readFile(path.join(dist, 'zannenin/assets/site/manzokukyo-gallery.js'), 'utf8');
    assert.match(galleryController, /room\.navigate\(destination\)/, 'Gallery delayed door must use the persistent session');
    assert.doesNotMatch(view, /window\.location\.href\s*=\s*exit\.href/, 'Gallery must not discard the audio owner');
  }
}

const scripts = ['app.js', 'rooms.js', 'room-bridge.js', 'audio-session.js', 'audio.js', 'site.js', 'truth/site.js', 'novel-view.js'];
for (const directory of [path.join(root, 'content/static-sites', previewPath), path.join(dist, previewPath)]) {
  for (const script of scripts) {
    const filename = path.join(directory, script);
    const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, `${path.relative(root, filename)}: ${result.error?.message || result.stderr || result.stdout}`);
  }
}
console.log(`Manzokukyo session: 6 shells/views, both deployment prefixes, ${checkedAssets.size} local asset paths, delayed gallery door, novel controllers and 16 JavaScript syntax checks passed.`);
