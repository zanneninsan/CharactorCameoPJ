import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const sourceRoot = new URL('../content/inbox/_series/untitled-short-anime/website-assets/manzokukyo-zannenin-cute/', import.meta.url);
// Crop the existing approved illustrations, keeping their original expression and linework.
const portraits = {
  manzokukyo: { file: 'zannenin-retouched-front.png', crop: { left: 280, top: 50, width: 470, height: 470 } },
  'anime-cute': { file: 'keyvisual-retouched.png', crop: { left: 570, top: 90, width: 350, height: 350 } },
};
export function teaserFaviconLinks(base, version = '1') {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const href = name => escape(`${base}${name}?v=${encodeURIComponent(version)}`);
  return `<link rel="icon" href="${href('favicon-portrait-v2.ico')}" sizes="16x16 32x32 48x48">
  <link rel="icon" href="${href('favicon-portrait-v2-32.png')}" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="${href('apple-touch-icon-portrait-v2.png')}" sizes="180x180">`;
}

export async function buildTeaserFavicons(kind, output) {
  const portrait = portraits[kind];
  if (!portrait) throw Error('Unknown teaser favicon');
  const cropped = await sharp(fileURLToPath(new URL(portrait.file, sourceRoot))).extract(portrait.crop).png().toBuffer();
  await mkdir(output, { recursive: true });
  const sizes = [16, 32, 48], images = [];
  for (const size of sizes) images.push(await sharp(cropped).resize(size, size).png().toBuffer());
  await writeFile(path.join(output, 'favicon-portrait-v2-32.png'), images[1]);
  await sharp(cropped).resize(180, 180).png().toFile(path.join(output, 'apple-touch-icon-portrait-v2.png'));
  // ICO directory with three embedded PNG sizes; no extra build dependency.
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(1, 2); directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  for (const [i, image] of images.entries()) {
    const at = 6 + i * 16;
    directory[at] = directory[at + 1] = sizes[i];
    directory.writeUInt16LE(1, at + 4); directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(image.length, at + 8); directory.writeUInt32LE(offset, at + 12);
    offset += image.length;
  }
  await writeFile(path.join(output, 'favicon-portrait-v2.ico'), Buffer.concat([directory, ...images]));
}
