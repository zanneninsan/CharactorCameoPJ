import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export async function buildManzokukyoPreview() {
  const source = path.join(root, 'content/static-sites/zannenin/manzokukyo-preview');
  const output = path.join(root, 'dist/zannenin/manzokukyo-preview');
  const artwork = path.join(root, 'content/characters/zannenin/assets/manzokukyo');
  const characterRoot = path.join(root, 'content/characters/zannenin');
  const character = JSON.parse(await readFile(path.join(characterRoot, 'character.json'), 'utf8'));
  const tiktok = character.links.find(link => link.label === 'TikTok');
  const games = character.contentLinks.filter(link => link.category === 'games' || link.type === 'game' || link.type === 'fan-game');
  if (!tiktok?.url || !games.length) throw Error('TikTok and games must be registered in character.json');
  for (const link of [tiktok, ...games]) if (!['https:', 'http:'].includes(new URL(link.url).protocol)) throw Error('Unsupported link protocol');
  await mkdir(path.join(output, 'assets'), { recursive: true });
  const gameLinks = games.map((game, index) => {
    const kind = { game: '公式ゲーム', 'fan-game': 'ファンゲーム', app: 'アプリ' }[game.type] || 'ゲーム';
    const credit = game.creatorLabel ? ` · ${game.creatorLabel}` : '';
    return `<a class="game-card" href="${escapeHtml(game.url)}" target="_blank" rel="noopener noreferrer" data-sfx="tap"><img src="./assets/game-${index}.webp" alt="" width="64" height="64" loading="lazy"><span><strong>${escapeHtml(game.label)} ↗</strong><small>${escapeHtml(kind + credit)}</small><span class="sr-only">（新しいタブ）</span></span></a>`;
  }).join('\n');
  const offeringDialog = await readFile(path.join(source, 'offering.html'), 'utf8');
  const html = (await readFile(path.join(source, 'index.html'), 'utf8')).replaceAll('{{TIKTOK_URL}}', escapeHtml(tiktok.url)).replaceAll('{{GAME_LINKS}}', gameLinks).replace('{{OFFERING_DIALOG}}', offeringDialog);
  await writeFile(path.join(output, 'index.html'), html, 'utf8');
  for (const name of ['styles.css', 'site.js', 'corridor.js', 'audio.js', 'route.js', 'guestbook-adapter.js', 'offering.js', 'offering.css']) await cp(path.join(source, name), path.join(output, name));
  const guestbookOutput = path.join(root, 'dist/assets/guestbook');
  await mkdir(guestbookOutput, { recursive: true });
  for (const name of ['guestbook.css', 'guestbook.js']) await cp(path.join(root, 'content/shared/guestbook', name), path.join(guestbookOutput, name));
  for (const dir of ['vendor', 'sounds']) await cp(path.join(source, dir), path.join(output, dir), { recursive: true });
  for (const [index, game] of games.entries()) {
    await sharp(path.join(characterRoot, game.icon)).resize(128, 128, { fit: 'contain', background: '#15191e' }).flatten({ background: '#15191e' }).webp({ quality: 88 }).toFile(path.join(output, 'assets', `game-${index}.webp`));
  }
  await sharp(path.join(characterRoot, games[0].icon)).resize(970, 650, { fit: 'contain', background: '#15191e' }).flatten({ background: '#15191e' }).webp({ quality: 88 }).toFile(path.join(output, 'assets/game-screen.webp'));
  await sharp(path.join(source, 'assets/tiktok-entry.png')).resize(600, 800, { fit: 'contain', background: '#15191e' }).flatten({ background: '#15191e' }).webp({ quality: 92 }).toFile(path.join(output, 'assets/tiktok-entry.webp'));
  await sharp(path.join(root, 'content/inbox/_series/untitled-short-anime/world-setting-assets/manzokukyo-emblem-v2.png')).resize({ width: 600 }).webp({ quality: 94 }).toFile(path.join(output, 'assets/emblem.webp'));
  for (const [input, outputName] of [
    [path.join(root, 'content/characters/zannenin/assets/brand/hero-profile-transparent.png'), 'profile.webp'],
    [path.join(root, 'content/inbox/_series/untitled-short-anime/website-assets/manzokukyo-zannenin-cute/keyvisual-retouched.png'), 'anime.webp']
  ]) {
    const size = outputName === 'profile.webp'
      ? { width: 1000, height: 1309, fit: 'contain', background: '#15191e' }
      : { width: 1000, withoutEnlargement: true };
    await sharp(input).resize(size).flatten({ background: '#15191e' }).webp({ quality: 88 }).toFile(path.join(output, 'assets', outputName));
  }
  await cp(path.join(artwork, 'satisfaction-bgm.m4a'), path.join(output, 'assets/satisfaction-bgm.m4a'));
  console.log('Manzokukyo preview: /zannenin/manzokukyo-preview/');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildManzokukyoPreview();
