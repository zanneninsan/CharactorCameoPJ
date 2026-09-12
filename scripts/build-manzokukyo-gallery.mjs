import { readFile, writeFile, cp, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderGallery3DExperience } from './render-manzokukyo-gallery-3d.mjs';
import { buildManzokukyoPreview } from './build-manzokukyo-preview.mjs';
import { buildGalleryRoomImages } from './build-manzokukyo-gallery-images.mjs';

// Reuse an existing site's shared head/footer for a focused local gallery build.
// The full build continues to render this same body through htmlPage().
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const galleryImages = path.join(root, 'content/characters/zannenin/assets/manzokukyo/gallery');
await buildGalleryRoomImages(galleryImages, path.join(root, 'dist/zannenin/assets/generated/manzokukyo/gallery'));
await cp(galleryImages, path.join(root, 'dist/zannenin/assets/manzokukyo/gallery'), { recursive: true });
const source = path.join(root, 'content/characters/zannenin/assets/site');
const target = path.join(root, 'dist/zannenin/assets/site');
const filename = path.join(root, 'dist/zannenin/manzokukyo/truth/gallery/index.html');
const previous = await readFile(filename, 'utf8');
const character = JSON.parse(await readFile(path.join(root, 'content/characters/zannenin/character.json'), 'utf8'));
const files = ['manzokukyo-gallery-image.js', 'manzokukyo-gallery.css', 'manzokukyo-gallery.js', 'manzokukyo-gallery-3d.css', 'manzokukyo-gallery-3d.js', 'manzokukyo-gallery-walk.js', 'manzokukyo-gallery-loop.js', 'manzokukyo-gallery-hand.js', 'manzokukyo-gallery-visitor.js', 'manzokukyo-gallery-spatial.js', 'manzokukyo-gallery-achievements.js'];
const texts = await Promise.all(files.map(file => readFile(path.join(source, file), 'utf8')));
const renderers = await Promise.all(['render-manzokukyo-gallery.mjs', 'render-manzokukyo-gallery-3d.mjs'].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
const version = createHash('sha256').update([...texts, ...renderers].join('\n')).digest('hex').slice(0, 12);
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const bodyStart = previous.match(/<body\b[^>]*>/);
const footerStart = previous.indexOf('<small\n      class="site-build-version"');
const footerStartCRLF = previous.indexOf('<small\r\n      class="site-build-version"');
const footer = Math.max(footerStart, footerStartCRLF);
if (!bodyStart || footer < bodyStart.index) throw Error('Run the full build first: shared gallery page chrome is missing.');
const originalHead = previous.slice(0, bodyStart.index + bodyStart[0].length);
const originalCanonical = originalHead.match(/<link\b(?=[^>]*\brel="canonical")[^>]*\bhref="([^"]+)"/)?.[1];
if (!originalCanonical) throw Error('Run the full build first: canonical gallery URL is missing.');
const deploymentRoot = new URL('../../../../', originalCanonical);
function setMeta(head, attribute, name, content) {
  const pattern = new RegExp(`<meta\\b(?=[^>]*\\b${attribute}="${name}")[^>]*>`, 'i');
  return head.replace(pattern, `<meta ${attribute}="${name}" content="${escapeHtml(content)}">`);
}
for (const route of ['gallery', 'gallery-3d']) {
  const options = renderGallery3DExperience(character, { htmlPage: value => value, escapeHtml, assetVersionQuery: `gallery=${version}`, alias: route === 'gallery-3d' });
  const canonical = new URL(options.urlPath, deploymentRoot).href;
  let head = originalHead.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(options.title)} | Character Canon</title>`);
  head = head.replace(/<link\b(?=[^>]*\brel="canonical")[^>]*>/i, `<link rel="canonical" href="${escapeHtml(canonical)}">`);
  head = setMeta(head, 'name', 'robots', options.robots || 'index,follow,max-image-preview:large');
  head = setMeta(head, 'name', 'description', options.description);
  head = setMeta(head, 'property', 'og:title', options.title);
  head = setMeta(head, 'property', 'og:description', options.description);
  head = setMeta(head, 'property', 'og:url', canonical);
  head = setMeta(head, 'name', 'twitter:title', options.title);
  head = setMeta(head, 'name', 'twitter:description', options.description);
  const output = path.join(root, 'dist/zannenin/manzokukyo/truth', route, 'index.html');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, head + '\n' + options.body + '\n' + previous.slice(footer), 'utf8');
}
await mkdir(target, { recursive: true });
for (const file of files) await cp(path.join(source, file), path.join(target, file));
await mkdir(path.join(root, 'dist/zannenin/assets/models'), { recursive: true });
for (const file of ['darenin-gallery.glb', 'zannenin-v11-gallery.glb']) await cp(path.join(root, 'content/characters/zannenin/assets/models', file), path.join(root, 'dist/zannenin/assets/models', file));
await buildManzokukyoPreview();
console.log('Walking gallery: primary page, compatibility URL and persistent-audio views updated.');
