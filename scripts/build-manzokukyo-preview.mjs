import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const relativeUrl = (from, to) => path.relative(from, to).split(path.sep).join('/') || '.';

function renderRoomShell({ title, assets, fallback, version, description }) {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#121922">
  <meta name="robots" content="noindex, nofollow">
  ${description || ''}
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${escapeHtml(assets)}app.css">
  <script type="module" src="${escapeHtml(assets)}app.js?v=${version}"></script>
</head>
<body>
  <main id="room-host" aria-label="満足教の部屋"></main>
  <p id="room-loading" role="status">次の部屋を開いています。</p>
  <section id="room-error" hidden aria-labelledby="room-error-title">
    <h1 id="room-error-title">部屋を開けませんでした。</h1>
    <p>もう一度試すか、従来のページへお進みください。</p>
    <button type="button" data-retry>もう一度開く</button>
    <a href="${escapeHtml(fallback)}" data-fallback>従来のページへ</a>
  </section>
  <p id="room-announcement" class="sr-only" aria-live="polite" aria-atomic="true"></p>
  <noscript><style>#room-loading,#room-host{display:none}</style><p>部屋の切り替えにはJavaScriptが必要です。<a href="${escapeHtml(fallback)}">従来のページへ</a></p></noscript>
</body>
</html>
`;
}

function renderRoomView(html, { base, legacy = false, novelScript, version }) {
  if (!/<head\b[^>]*>/i.test(html) || !/<body\b[^>]*>/i.test(html)) throw Error('Room view must be a complete HTML document');
  // Resolve the bridge against views/ before the original page's base takes effect.
  let view = html.replace(/<head\b[^>]*>/i, match => `${match}\n  <script src="../room-bridge.js?v=${version}"></script>\n  <base href="${escapeHtml(base)}">\n  <meta name="robots" content="noindex, nofollow">`);
  view = view.replace(/<meta\b(?=[^>]*\bname=["']robots["'])[^>]*>/gi, '<meta name="robots" content="noindex, nofollow">');
  if (legacy) {
    view = view.replace(/<body\b([^>]*)>/i, '<body$1 data-session-legacy>\n<noscript><p>この部屋の操作にはJavaScriptが必要です。<a href="./" target="_top">従来のページへ</a></p></noscript>');
    view = view.replaceAll('window.location.href=exit.href', 'window.ManzokukyoRoom.navigate(exit.href)');
  }
  if (novelScript) {
    const scriptPattern = /(<script\b[^>]*\bsrc=)(["'])[^"']*manzokukyo-novel\.js(?:\?[^"']*)?\2/i;
    if (!scriptPattern.test(view)) throw Error('Novel room script was not found');
    view = view.replace(scriptPattern, (_, prefix, quote) => `${prefix}${quote}${escapeHtml(novelScript)}${quote}`);
  }
  view = view.replace(/(<script\b[^>]*\bsrc=["'])([^"']*\/(?:site|novel-view)\.js)(?:\?[^"']*)?(["'])/g, `$1$2?v=${version}$3`);
  return view;
}

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
  const sourceNames = ['styles.css', 'site.js', 'corridor.js', 'audio.js', 'route.js', 'guestbook-adapter.js', 'offering.js', 'offering.css', 'app.js', 'app.css', 'rooms.js', 'room-bridge.js', 'audio-session.js', 'novel-view.js', 'truth/styles.css', 'truth/site.js', 'truth/chamber.js'];
  const sourceFiles = await Promise.all(sourceNames.map(name => readFile(path.join(source, name), 'utf8')));
  const version = createHash('sha256').update(sourceFiles.join('\n')).digest('hex').slice(0, 12);
  await mkdir(path.join(output, 'truth'), { recursive: true });
  for (const [index, name] of sourceNames.entries()) {
    const text = name.endsWith('.js') ? sourceFiles[index].replace(/(["'])(\.\.?\/[^"'\n]+\.js)\1/g, `$1$2?v=${version}$1`) : sourceFiles[index];
    await writeFile(path.join(output, name), text, 'utf8');
  }
  const canonical = path.join(root, 'dist/zannenin/manzokukyo');
  const views = path.join(output, 'views');
  await mkdir(views, { recursive: true });
  const rooms = [
    { id: 'corridor', route: '', title: '満足教｜回廊', html, original: output, fallback: canonical },
    { id: 'truth', route: 'truth', title: '真理の扉｜満足教', html: await readFile(path.join(source, 'truth/index.html'), 'utf8'), original: path.join(output, 'truth'), fallback: path.join(canonical, 'truth') },
    { id: 'gallery', route: 'truth/gallery', title: '記憶の画廊｜満足教', legacy: true },
    { id: 'red-house', route: 'truth/red-house', title: '赤い懺悔室｜満足教', legacy: true },
    { id: 'archive', route: 'truth/red-house/archive', title: '記憶保管庫｜満足教', legacy: true, novel: true },
    { id: 'novel', route: 'novel', title: '満足教異聞録', legacy: true, novel: true }
  ];
  for (const room of rooms) {
    const original = room.original || path.join(canonical, room.route);
    const shellDirectory = path.join(output, room.route);
    let roomHtml = room.html;
    if (roomHtml === undefined) {
      try { roomHtml = await readFile(path.join(original, 'index.html'), 'utf8'); }
      catch (error) { throw Error(`Build the canonical Manzokukyo pages before preview room ${room.id}`, { cause: error }); }
    }
    const view = renderRoomView(roomHtml, {
      base: `${relativeUrl(views, original)}/`,
      legacy: room.legacy,
      novelScript: room.novel ? relativeUrl(original, path.join(output, 'novel-view.js')) : undefined,
      version
    });
    await writeFile(path.join(views, `${room.id}.html`), view, 'utf8');
    await mkdir(shellDirectory, { recursive: true });
    await writeFile(path.join(shellDirectory, 'index.html'), renderRoomShell({
      title: room.title,
      version,
      description: roomHtml.match(/<meta\b(?=[^>]*\bname=["']description["'])[^>]*>/i)?.[0],
      assets: `${relativeUrl(shellDirectory, output)}/`,
      fallback: `${relativeUrl(shellDirectory, room.fallback || original)}/`
    }), 'utf8');
  }
  await mkdir(path.join(output, 'music'), { recursive: true });
  for (const name of ['truth-chamber-bgm.flac', 'truth-chamber-bgm.mp3']) await cp(path.join(source, 'music', name), path.join(output, 'music', name));
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
