import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// GPU textures and catalogue thumbnails share a small image. The lightboxes
// request the untouched source PNG only when a visitor opens an artwork.
export async function buildGalleryRoomImages(sourceDir, outputDir) {
  await mkdir(outputDir, { recursive: true });
  const files = (await readdir(sourceDir)).filter(file => /^gallery-\d+\.png$/i.test(file)).sort();
  for (const file of files) {
    await sharp(path.join(sourceDir, file))
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 74, effort: 5 })
      .toFile(path.join(outputDir, `${path.parse(file).name}-room.webp`));
  }
}
