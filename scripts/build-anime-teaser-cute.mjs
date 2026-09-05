import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildAnimeTeaserCute() {
  const source = path.join(root, 'content/static-sites/series/manzokukyo-zannenin-cute');
  const output = path.join(root, 'dist/anime/manzokukyo-zannenin-cute');
  const base = path.join(root, 'content/inbox/_series/untitled-short-anime');
  const shared = path.join(base, 'website-assets/manzokukyo-zannenin');
  const artwork = path.join(base, 'website-assets/manzokukyo-zannenin-cute');
  const files = [
    [path.join(artwork, 'cutouts/zannenin-retouched-front.png'), 'zannenin.webp', 1800],
    [path.join(shared, 'believer-f-cutout.png'), 'believer-f.webp', 1800],
    [path.join(shared, 'believer-b-cutout.png'), 'believer-b.webp', 1800],
  ];
  await Promise.all([...files.map(([input]) => stat(input)), stat(path.join(artwork, 'keyvisual-retouched.png'))]);
  await mkdir(path.join(output, 'assets'), { recursive: true });
  await Promise.all(['index.html', 'styles.css', 'site.js'].map(name => cp(path.join(source, name), path.join(output, name))));
  for (const [input, name, height] of files) {
    await sharp(input).resize({ height, withoutEnlargement: true }).webp({ quality: 95, alphaQuality: 100 }).toFile(path.join(output, 'assets', name));
  }
  await sharp(path.join(artwork, 'keyvisual-retouched.png')).resize({ width: 1920, withoutEnlargement: true }).webp({ quality: 94 }).toFile(path.join(output, 'assets/keyvisual.webp'));
  await cp(path.join(shared, 'zannenin-title-logo.png'), path.join(output, 'assets/title-logo.png'));
  await sharp(path.join(base, 'world-setting-assets/manzokukyo-emblem-v2.png')).resize({ width: 400 }).png().toFile(path.join(output, 'assets/emblem.png'));
  console.log('Cute teaser: /anime/manzokukyo-zannenin-cute/');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildAnimeTeaserCute();
