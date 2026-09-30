// 公式サイト（GitHub Pages）用の公開版を書き出す。サーバーなしでデモを自動再生する閲覧用ページ
// scripts/build.mjs から呼ばれ、dist/zannenin/stream-world/ に出力する
import { cp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '../..');
const pub = path.join(appDir, 'public');

// 公開版に含めない（操作パネル・顔トラッキング・開発用）
const PRIVATE_SCRIPTS = new Set(['control.js', 'facetrack.js']);

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// GitHub Pages はファイルを約10分キャッシュさせるので、公開を更新した直後に
// 新しいHTMLと古いCSS・JSが混ざらないよう、中身から作った版を参照に付ける
function withVersion(url, version) {
  return `${url}${url.includes('?') ? '&' : '?'}v=${version}`;
}

// JS 同士の相対 import（静的・動的）に版を付ける
function versionImports(code, version) {
  return code
    .replace(/(from\s+['"])(\.{1,2}\/[^'"?]+\.js)(['"])/g, (_, a, spec, b) => `${a}${withVersion(spec, version)}${b}`)
    .replace(/(import\(\s*['"])(\.{1,2}\/[^'"?]+\.js)(['"]\s*\))/g, (_, a, spec, b) => `${a}${withVersion(spec, version)}${b}`);
}

export async function buildStreamWorld(outDir, { pageUrl, imageUrl } = {}) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, 'js'), { recursive: true });
  await mkdir(path.join(outDir, 'assets'), { recursive: true });

  const scripts = (await readdir(path.join(pub, 'js'))).filter((name) => name.endsWith('.js') && !PRIVATE_SCRIPTS.has(name)).sort();
  // three / three-vrm（static-vendor）も版の元に含める。three を更新したら版も変わるように
  const vendorDir = path.join(appDir, 'static-vendor');
  const vendorFiles = (await readdir(vendorDir, { recursive: true, withFileTypes: true }))
    .filter((d) => d.isFile())
    .map((d) => path.relative(vendorDir, path.join(d.parentPath ?? d.path, d.name)).split(path.sep).join('/'))
    .sort();
  const vendor = Object.fromEntries(await Promise.all(vendorFiles.map(async (rel) => [rel, await readFile(path.join(vendorDir, rel))])));
  const sources = {
    html: await readFile(path.join(pub, 'stage.html'), 'utf8'),
    css: await readFile(path.join(pub, 'stage.css'), 'utf8'),
    js: Object.fromEntries(await Promise.all(scripts.map(async (name) => [name, await readFile(path.join(pub, 'js', name), 'utf8')]))),
  };
  const digest = crypto.createHash('sha1').update(JSON.stringify(sources));
  for (const rel of vendorFiles) digest.update(rel).update(vendor[rel]);
  const version = digest.digest('hex').slice(0, 10);

  const title = '満足教大聖堂・懺悔室 | 残念院さん';
  const description = '満足教の教祖・残念院さんが、大聖堂の懺悔室からお送りする配信ワールドの見本。懺悔・お布施・神託・聖歌はすべて見本です。';
  const head = [
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    pageUrl ? `<meta property="og:url" content="${escapeHtml(pageUrl)}">` : '',
    imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<script>window.STREAM_WORLD_STATIC = true;</script>`,
  ].filter(Boolean).join('\n  ');

  const replaceOnce = (text, from, to) => {
    if (!text.includes(from)) throw new Error(`stage.html に ${from} が見つかりません`);
    return text.replace(from, to);
  };
  let html = sources.html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  html = replaceOnce(html, '<link rel="stylesheet" href="stage.css">', `<link rel="stylesheet" href="${withVersion('stage.css', version)}">\n  ${head}`);
  html = replaceOnce(html, 'src="js/stage.js"', `src="${withVersion('js/stage.js', version)}"`);
  // importmap: three / three-vrm と、three の追加モジュール（three/addons/…）すべてに版付きのURLを割り当てる。
  // 「three/addons/」のような前方一致の割り当てには版を付けられないので、ファイルごとに登録する
  html = html.replace(/(<script type="importmap">)([\s\S]*?)(<\/script>)/, (_, open, json, close) => {
    const map = JSON.parse(json);
    for (const [spec, url] of Object.entries(map.imports)) {
      if (url.endsWith('.js')) map.imports[spec] = withVersion(url, version);
    }
    const addonsBase = map.imports['three/addons/'];
    if (addonsBase) {
      const prefix = 'three/examples/jsm/';
      for (const rel of vendorFiles) {
        if (rel.startsWith(prefix) && rel.endsWith('.js')) {
          const sub = rel.slice(prefix.length);
          map.imports[`three/addons/${sub}`] = withVersion(`${addonsBase}${sub}`, version);
        }
      }
    }
    return `${open}\n    ${JSON.stringify(map, null, 2).split('\n').join('\n    ')}\n  ${close}`;
  });
  await writeFile(path.join(outDir, 'index.html'), html, 'utf8');
  await writeFile(path.join(outDir, 'stage.css'), sources.css, 'utf8');
  for (const [name, code] of Object.entries(sources.js)) await writeFile(path.join(outDir, 'js', name), versionImports(code, version), 'utf8');

  await cp(path.join(pub, 'assets/emblem.png'), path.join(outDir, 'assets/emblem.png'));
  // デモ台本のセリフを事前生成した声（tools/generate-demo-voice.mjs）。ファイル名が文から決まるので版は不要
  await cp(path.join(pub, 'voice'), path.join(outDir, 'voice'), { recursive: true });
  await cp(path.join(appDir, 'static/og.png'), path.join(outDir, 'og.png'));
  // three の追加モジュール同士の相対 import（./Pass.js、../shaders/… など）にも版を付けて書き出す
  for (const rel of vendorFiles) {
    const out = path.join(outDir, 'vendor', rel);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, rel.endsWith('.js') ? versionImports(vendor[rel].toString('utf8'), version) : vendor[rel]);
  }
  await cp(path.join(repoRoot, 'content/characters/zannenin/assets/manzokukyo/satisfaction-bgm.m4a'), path.join(outDir, 'assets/satisfaction-bgm.m4a'));
  // 公開用に軽量化したVRM（tools/optimize-vrm.mjs で生成）。原本はリポジトリに入れない
  await cp(path.join(repoRoot, 'content/characters/zannenin/assets/models/zannenin-stream-world.vrm'), path.join(outDir, 'model.vrm'));
  return { version };
}
