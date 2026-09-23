import { galleryMemeImages, galleryImagePath } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-artworks.js';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Check real build output, including every published entry route. Run after
// the full build or the focused gallery build, not against hand-made fixtures.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = path.join(root, 'dist/zannenin/assets/generated/manzokukyo/gallery');
let oldBytes = 0, roomBytes = 0, originalPixels = 0, roomPixels = 0;
for (let n = 1; n <= 24; n++) {
  const base = `gallery-${String(n).padStart(2, '0')}`;
  const source = await readFile(path.join(root, 'content/characters/zannenin/assets/manzokukyo/gallery', `${base}.png`));
  const original = await readFile(path.join(root, 'dist/zannenin/assets/manzokukyo/gallery', `${base}.png`));
  assert.ok(source.equals(original), `${base}: full-resolution original is untouched`);
  const full = await sharp(original).metadata();
  const small = await sharp(path.join(generated, `${base}-room.webp`)).metadata();
  assert.ok(Math.max(small.width, small.height) <= 512, `${base}: bounded GPU texture`);
  assert.ok(Math.abs(small.width / small.height - full.width / full.height) < .003, `${base}: aspect ratio preserved without cropping`);
  originalPixels += full.width * full.height; roomPixels += small.width * small.height;
  oldBytes += (await stat(path.join(generated, `${base}.webp`))).size;
  roomBytes += (await stat(path.join(generated, `${base}-room.webp`))).size;
}
for (const route of ['manzokukyo/old/truth/gallery/index.html', 'manzokukyo/old/truth/gallery-3d/index.html', 'manzokukyo/views/gallery.html', 'manzokukyo/views/gallery-3d.html']) {
  const html = await readFile(path.join(root, 'dist/zannenin', route), 'utf8');
  const images = [...html.matchAll(/<img\b[^>]*src="[^"]*gallery-(\d+)-room\.webp[^>]*>/g)];
  assert.equal(images.length, 24, `${route}: catalogue uses small images too`);
  assert.doesNotMatch(html, /<(?:img|source)\b[^>]*(?:src|srcset)="[^"]*gallery-\d+\.(?:png|webp|avif)/, 'original images only load after inspection');
}
assert.ok(roomBytes < oldBytes * .4, 'room images substantially reduce transfer size');
assert.ok(roomPixels < originalPixels * .3, 'room images substantially reduce GPU texture pixels');
console.log(`Gallery images passed: 24 uncropped small textures; originals byte-identical; all published catalogues use thumbnails. ${oldBytes} → ${roomBytes} bytes (${Math.round((1 - roomBytes / oldBytes) * 100)}% smaller), ${Math.round((1 - roomPixels / originalPixels) * 100)}% fewer pixels.`);

let memeBytes = 0;
for (const [i, item] of galleryMemeImages.entries()) {
  execFileSync('git', ['ls-files', '--error-unmatch', `content/characters/zannenin/assets/${item.path}`], { cwd: root });
  const source = await readFile(path.join(root, 'content/characters/zannenin/assets', item.path));
  const original = await readFile(path.join(root, 'dist/zannenin/assets', item.path));
  assert.ok(source.equals(original), 'meme original remains untouched');
  const thumbnail = path.join(generated, `meme-${String(i + 1).padStart(2, '0')}-room.webp`);
  const full = await sharp(source).metadata(), small = await sharp(thumbnail).metadata();
  assert.ok(Math.max(small.width, small.height) <= 512);
  assert.ok(Math.abs(small.width / small.height - full.width / full.height) < .005, 'memes fit without cropping');
  memeBytes += (await stat(thumbnail)).size;
}
const records = Array.from({ length: 24 }, (_, i) => ({ id: String(i + 1).padStart(2, '0') }));
assert.equal(new Set(records.map((_, i) => galleryImagePath(i, { kind: 'meme-gallery' }, records))).size, 12);
for (let i = 0; i < 24; i++) {
  assert.match(galleryImagePath(i, { kind: 'meme-gallery' }, records), /assets\/drive-visuals\//);
  assert.match(galleryImagePath(i, { kind: 'meme-gallery' }, records, true), /meme-\d+-room\.webp$/);
  assert.match(galleryImagePath(i, null, records), new RegExp(`gallery-${records[i].id}\\.png$`));
  assert.match(galleryImagePath(i, { kind: 'same-image', index: 8 }, records), /gallery-09\.png$/);
}
console.log(`Meme exhibition: 12 tracked originals, 24 mapped frames, uncropped thumbnails total ${memeBytes} bytes; ordinary and same-image routing preserved.`);
