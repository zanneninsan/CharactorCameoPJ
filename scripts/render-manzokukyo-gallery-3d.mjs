import { renderGalleryExperience } from './render-manzokukyo-gallery.mjs';
import { galleryDebugOptions } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-loop.js';

// Keep the record data, lightbox, seals and puzzle controller identical to the
// archived flat gallery source. Only the 3D experience is published now.
export function renderGallery3DExperience(character, { htmlPage, escapeHtml, assetVersionQuery, alias = false }) {
  const original = renderGalleryExperience(character, { htmlPage: options => options, escapeHtml, assetVersionQuery });
  const frames = [...original.body.matchAll(/<button\b[^>]*\bdata-gallery-index="\d+"[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]
    .replace(/<source\b[^>]*>/g, '')
    .replace(/(gallery-\d+)\.webp/g, '$1-room.webp'));
  const introStart = original.body.indexOf('<section class="gallery-intro">');
  const puzzleStart = original.body.indexOf('<section id="gallery-puzzle"');
  if (frames.length !== 24 || introStart < 0 || puzzleStart <= introStart) throw Error('The 3D gallery requires the original 24 records and puzzle.');
  const indexValues = frames.map(frame => Number(frame.match(/data-gallery-index="(\d+)"/)[1]));
  if (new Set(indexValues).size !== 24 || indexValues.some((value, index) => value !== index)) throw Error('The original gallery record order changed.');
  const sealRecords = JSON.parse(original.body.match(/<script type="application\/json" data-gallery-records>([\s\S]*?)<\/script>/)[1]).records.filter(record => record.seal).sort((a, b) => a.seal.order - b.seal.order);
  const stage = `<section class="gallery-3d-stage" id="gallery-3d-exhibition" aria-labelledby="gallery-3d-title">
        <div class="gallery-3d-heading"><span class="gallery-eyebrow">Gallery of unfiled images</span><h1 id="gallery-3d-title">記憶の画廊</h1><p>四つの展示室を歩き、額縁に残された六つの検印を探す。気になる一枚の前で、足を止めてください。</p><nav class="gallery-3d-room-jumps" aria-label="展示室を選ぶ">${['I', 'II', 'III', 'IV'].map((label, index) => `<button type="button" data-gallery-3d-room-jump="${index}" aria-label="第${index + 1}展示室へ">${label}</button>`).join('')}</nav></div>
        <div class="gallery-3d-viewport"><canvas data-gallery-3d-canvas tabindex="0" role="group" aria-roledescription="歩ける展示室" aria-label="3D展示室" aria-describedby="gallery-walk-help"></canvas><p class="gallery-3d-loading" role="status">展示室を開いています。下の一覧からも記録を選べます。</p><span class="gallery-3d-reticle" aria-hidden="true"></span><p class="gallery-3d-help" id="gallery-walk-help"><span>画面をクリックして <kbd>W A S D</kbd> 移動 · <kbd>Q E</kbd> 旋回 · <kbd>Shift</kbd> ダッシュ</span><span>ドラッグで見回す · 絵をタップ / <kbd>Enter</kbd> で拡大</span></p><div class="gallery-3d-walk-pad" role="group" aria-label="移動と旋回">${[['turnLeft', 'Q', '左に旋回'], ['forward', 'W', '前に歩く'], ['turnRight', 'E', '右に旋回'], ['left', 'A', '左に歩く'], ['back', 'S', '後ろに歩く'], ['right', 'D', '右に歩く']].map(([action, key, label]) => `<button type="button" data-gallery-3d-walk="${action}" aria-label="${label}" aria-keyshortcuts="${key.toLowerCase()}"><b aria-hidden="true">${{ turnLeft: '↶', forward: '↑', turnRight: '↷', left: '←', back: '↓', right: '→' }[action]}</b><small>${key}</small></button>`).join('')}<button type="button" class="gallery-3d-sprint" data-gallery-3d-sprint aria-pressed="false" title="ダッシュを切り替える。PCではShiftを押している間も走れます">ダッシュ OFF</button></div></div>
        <p class="gallery-visitor-note" data-gallery-visitor-note role="status">いつもは残念院さんと誰念院さんが、一人ずつ散策しています。人数や様子もよく見て。</p>
        <div class="gallery-3d-controls" aria-label="画廊を歩く"><button type="button" data-gallery-3d-prev aria-label="前の記録へ">← 前へ</button><div class="gallery-3d-position" aria-live="polite"><small data-gallery-3d-room>展示室 I</small><strong data-gallery-3d-record>ARCHIVE 01</strong></div><button type="button" data-gallery-3d-next aria-label="次の記録へ">次へ →</button><button type="button" data-gallery-3d-inspect>この記録を開く</button><button type="button" data-gallery-3d-overview>展示室を見渡す</button><button type="button" data-gallery-3d-list aria-controls="gallery-3d-catalog" aria-expanded="true">一覧を閉じる</button></div>
      </section>
      <section class="gallery-3d-catalog" id="gallery-3d-catalog" aria-label="24枚の記録一覧">${frames.join('')}</section>
      `;
  const loopPanel = `<div class="gallery-loop-ui" data-gallery-loop-ui hidden>
        <div class="gallery-loop-modes" role="group" aria-label="画廊の遊び方"><button type="button" data-gallery-loop-mode="loop" aria-pressed="true">異変と検印の回廊</button><button type="button" data-gallery-loop-mode="gallery" aria-pressed="false" title="鑑賞だけのモード。切り替えると仮押しは消えます。持ち帰った検印は残ります">作品鑑賞</button></div>
        <div class="gallery-loop-panel" data-gallery-loop-panel><details class="gallery-loop-rule"><summary>遊び方</summary><div><strong>異変があれば、引き返せ。</strong><p data-gallery-loop-hint>まずは正常な24枚を覚えて、奥の扉へ。</p><p>左のボタンで移動、ドラッグで見回す。絵をタップして拡大・検印。いつもは残念院さんと誰念院さんが一人ずつ散策しています。</p></div></details><div class="gallery-loop-count"><small data-gallery-loop-round>初回 / 正常な展示</small><span>連続正解 <b data-gallery-loop-streak>00</b><small>最高 <b data-gallery-loop-best>00</b></small></span></div><button type="button" data-gallery-loop-restart title="検印と連続正解をリセットして最初から遊ぶ">最初から</button></div>
        <div class="gallery-loop-bag" data-gallery-loop-bag><div class="gallery-loop-slots" aria-label="持ち帰った検印と仮押し">${sealRecords.map(record => `<span data-gallery-loop-slot="${record.number}" data-status="empty">—</span>`).join('')}</div><p data-gallery-loop-carry role="status"></p><button type="button" data-gallery-loop-ledger>検印帳 <b data-gallery-loop-filed>0 / 6</b></button></div>
      </div>`;
  const transition = `<div class="gallery-loop-transition" data-gallery-loop-transition role="status" hidden><div class="gallery-loop-eye" aria-hidden="true"><i></i></div><span>MANZOKUKYO / RECURSION</span><strong data-gallery-loop-transition-title></strong><p data-gallery-loop-transition-note></p><button type="button" data-gallery-loop-retry hidden>展示を読み込み直す</button></div>`;
  const exhibition = stage.replace('<div class="gallery-3d-viewport">', '<div class="gallery-3d-viewport">' + loopPanel + transition);
  let body = original.body.slice(0, introStart) + exhibition + original.body.slice(puzzleStart);
  body = body.replace('金色の検印が付いた記録を開き、照合していく。集まった六つの文字を並べ替えれば、次の扉を呼ぶ言葉になる。', '金色の印を1周に1枚仮押しし、異変の判断に正解すると検印帳に残る。間違えた周回の仮押しは消える。6枚を持ち帰ったら、文字を並べ替えて次の扉を呼ぼう。');
  body = body.replace('<main class="gallery-page" data-gallery-experience>', '<main class="gallery-page gallery-3d-page" data-gallery-experience data-gallery-3d>');
  body = body.replace('<main class="gallery-page gallery-3d-page"', `<link rel="stylesheet" href="../../../assets/site/manzokukyo-gallery-3d.css?${assetVersionQuery}">\n      <main class="gallery-page gallery-3d-page"`);
  body += `\n      <script type="module" src="../../../assets/site/manzokukyo-gallery-3d.js?${assetVersionQuery}"></script>\n`;
  body += `<dialog class="gallery-loop-inspection" data-gallery-loop-inspection aria-labelledby="gallery-loop-inspection-title"><div><img alt="展示中の記録"><footer><strong id="gallery-loop-inspection-title" data-gallery-loop-inspection-title></strong><button type="button" data-gallery-loop-collect hidden>⊹ 検印を仮押しする</button><button type="button" data-gallery-loop-inspection-close>展示室へ戻る</button><p data-gallery-loop-seal-note role="status"></p></footer></div></dialog>`;
  body = body.replace('</div></details><div class="gallery-loop-count">', '<button type="button" data-debug-open>異変デバッグ（P）</button></div></details><div class="gallery-loop-count">');
  body = body.replace('<div class="gallery-loop-bag"', '<button type="button" class="gallery-debug-active" data-debug-active data-debug-open hidden>DEBUG · 異変を選ぶ（P）</button><div class="gallery-loop-bag"');
  body += `<dialog class="gallery-debug" data-gallery-debug aria-labelledby="gallery-debug-title"><header><span>GALLERY / DEBUG</span><h2 id="gallery-debug-title">体験する異変を選ぶ</h2></header><label>異変<select data-debug-kind>${galleryDebugOptions.map(option => `<option value="${option.kind}">${option.label}</option>`).join('')}</select></label><label>対象の記録（「全部同じ絵」では使用する画像）<select data-debug-record>${Array.from({ length: 24 }, (_, index) => `<option value="${index + 1}">記録 ${String(index + 1).padStart(2, '0')}</option>`).join('')}</select></label><p>切り替えは入口から。仮押しは破棄します。デバッグ中は検印・最高記録を保存しません。終了すると元のモード・周回へ、入口から戻ります。</p><p data-debug-status role="status"></p><footer><button type="button" data-debug-apply>この展示を体験</button><button type="button" data-debug-exit hidden>デバッグを終了</button><button type="button" data-debug-close>閉じる</button></footer><small>通常プレイ中に P で開く / Esc で閉じる</small></dialog>`;
  const options = {
    ...original,
    title: '記憶の画廊 | 満足教',
    description: '異変があれば引き返す、終わりのない「記憶の画廊」。24枚の絵を観察して検印を仮押しし、正しい判断で6枚を持ち帰って次の扉へ。',
    urlPath: `${character.id}/manzokukyo/truth/gallery/`,
    robots: alias ? 'noindex,follow' : 'index,follow,max-image-preview:large',
    body,
  };
  const rendered = htmlPage(options);
  return typeof rendered === 'string'
    ? rendered.replace(/<meta\b(?=[^>]*\bname=["']robots["'])[^>]*>/gi, `<meta name="robots" content="${options.robots}">`)
    : rendered;
}
