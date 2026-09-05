import { readFile, writeFile, cp, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderGalleryExperience } from './render-manzokukyo-gallery.mjs';
import { buildManzokukyoPreview } from './build-manzokukyo-preview.mjs';

// Reuse an existing site's shared head/footer for a focused local gallery build.
// The full build continues to render this same body through htmlPage().
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'content/characters/zannenin/assets/site');
const target = path.join(root, 'dist/zannenin/assets/site');
const filename = path.join(root, 'dist/zannenin/manzokukyo/truth/gallery/index.html');
const previous = await readFile(filename, 'utf8');
const character = JSON.parse(await readFile(path.join(root, 'content/characters/zannenin/character.json'), 'utf8'));
const files = ['manzokukyo-gallery.css', 'manzokukyo-gallery.js'];
const texts = await Promise.all(files.map(file => readFile(path.join(source, file), 'utf8')));
const version = createHash('sha256').update(texts.join('\n')).digest('hex').slice(0, 12);
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const { body } = renderGalleryExperience(character, { htmlPage: options => options, escapeHtml, assetVersionQuery: `gallery=${version}` });
const bodyStart = previous.match(/<body\b[^>]*>/);
const footerStart = previous.indexOf('<small\n      class="site-build-version"');
const footerStartCRLF = previous.indexOf('<small\r\n      class="site-build-version"');
const footer = Math.max(footerStart, footerStartCRLF);
if (!bodyStart || footer < bodyStart.index) throw Error('Run the full build first: shared gallery page chrome is missing.');
await writeFile(filename, previous.slice(0, bodyStart.index + bodyStart[0].length) + '\n' + body + '\n' + previous.slice(footer), 'utf8');
await mkdir(target, { recursive: true });
for (const file of files) await cp(path.join(source, file), path.join(target, file));
await buildManzokukyoPreview();
console.log('Gallery experience: canonical and persistent-audio preview updated.');
