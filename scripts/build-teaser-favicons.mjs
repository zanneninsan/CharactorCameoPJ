import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const sourceRoot = new URL('../content/shared/teaser-favicons/', import.meta.url);
export function teaserFaviconLinks(base, version = '1') {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const href = name => escape(`${base}${name}?v=${encodeURIComponent(version)}`);
  return `<link rel="icon" href="${href('favicon.ico')}" sizes="16x16 32x32 48x48">
  <link rel="icon" href="${href('favicon-32.png')}" type="image/png" sizes="32x32">
  <link rel="icon" href="${href('favicon.svg')}" type="image/svg+xml" sizes="any">
  <link rel="apple-touch-icon" href="${href('apple-touch-icon.png')}" sizes="180x180">`;
}

export async function buildTeaserFavicons(kind, output) {
  if (!['manzokukyo', 'anime-cute'].includes(kind)) throw Error('Unknown teaser favicon');
  const svg = await readFile(new URL(`${kind}.svg`, sourceRoot));
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'favicon.svg'), svg);
  const sizes = [16, 32, 48], images = [];
  for (const size of sizes) images.push(await sharp(svg).resize(size, size).png().toBuffer());
  await writeFile(path.join(output, 'favicon-32.png'), images[1]);
  await sharp(svg).resize(180, 180).flatten({ background: kind === 'manzokukyo' ? '#153d35' : '#f3a9b9' }).png().toFile(path.join(output, 'apple-touch-icon.png'));
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
  await writeFile(path.join(output, 'favicon.ico'), Buffer.concat([directory, ...images]));
}
