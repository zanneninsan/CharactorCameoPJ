import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2];
if (!input) throw new Error('Provide the user-approved retouched character sheet path.');
const assets = path.join(root, 'content/inbox/_series/untitled-short-anime/website-assets/manzokukyo-zannenin-cute');
await mkdir(assets, { recursive: true });
await cp(input, path.join(assets, 'zannenin-retouched-sheet.png'), { errorOnExist: true, force: false });
await sharp(input).extract({ left: 0, top: 0, width: 1040, height: 2560 })
  .png().toFile(path.join(assets, 'zannenin-retouched-front.png'));
console.log(assets);
