import { renderGalleryExperience } from './render-manzokukyo-gallery.mjs';

// Keep the record data, lightbox, seals and puzzle controller identical to the
// standard gallery. This prototype replaces only the way visitors browse it.
export function renderGallery3DExperience(character, { htmlPage, escapeHtml, assetVersionQuery }) {
  const original = renderGalleryExperience(character, { htmlPage: options => options, escapeHtml, assetVersionQuery });
  const frames = [...original.body.matchAll(/<button\b[^>]*\bdata-gallery-index="\d+"[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);
  const introStart = original.body.indexOf('<section class="gallery-intro">');
  const puzzleStart = original.body.indexOf('<section id="gallery-puzzle"');
  if (frames.length !== 24 || introStart < 0 || puzzleStart <= introStart) throw Error('The 3D gallery requires the original 24 records and puzzle.');
  const indexValues = frames.map(frame => Number(frame.match(/data-gallery-index="(\d+)"/)[1]));
  if (new Set(indexValues).size !== 24 || indexValues.some((value, index) => value !== index)) throw Error('The original gallery record order changed.');
  const stage = `<section class="gallery-3d-stage" id="gallery-3d-exhibition" aria-labelledby="gallery-3d-title">
        <div class="gallery-3d-heading"><span class="gallery-eyebrow">Gallery of unfiled images / 3D preview</span><h1 id="gallery-3d-title">記憶の画廊</h1><p>四つの展示室を歩き、額縁に残された六つの検印を探す。気になる一枚の前で、足を止めてください。</p><a href="../gallery/">← 通常の画廊へ</a><nav class="gallery-3d-room-jumps" aria-label="展示室を選ぶ">${['I', 'II', 'III', 'IV'].map((label, index) => `<button type="button" data-gallery-3d-room-jump="${index}" aria-label="第${index + 1}展示室へ">${label}</button>`).join('')}</nav></div>
        <div class="gallery-3d-viewport"><canvas data-gallery-3d-canvas tabindex="0" role="img" aria-label="3D展示室。左右キーで作品を移動、Enterで拡大"></canvas><p class="gallery-3d-loading" role="status">展示室を開いています。下の一覧からも記録を選べます。</p><p class="gallery-3d-help">額縁をタップすると拡大。左右のボタンで、次の一枚へ。</p></div>
        <div class="gallery-3d-controls" aria-label="画廊を歩く"><button type="button" data-gallery-3d-prev aria-label="前の記録へ">← 前へ</button><div class="gallery-3d-position" aria-live="polite"><small data-gallery-3d-room>展示室 I</small><strong data-gallery-3d-record>ARCHIVE 01</strong></div><button type="button" data-gallery-3d-next aria-label="次の記録へ">次へ →</button><button type="button" data-gallery-3d-inspect>この記録を開く</button><button type="button" data-gallery-3d-overview>展示室を見渡す</button><button type="button" data-gallery-3d-list aria-controls="gallery-3d-catalog" aria-expanded="true">一覧を閉じる</button></div>
      </section>
      <section class="gallery-3d-catalog" id="gallery-3d-catalog" aria-label="24枚の記録一覧">${frames.join('')}</section>
      `;
  let body = original.body.slice(0, introStart) + stage + original.body.slice(puzzleStart);
  body = body.replace('<main class="gallery-page" data-gallery-experience>', '<main class="gallery-page gallery-3d-page" data-gallery-experience data-gallery-3d>');
  body = body.replace('<main class="gallery-page gallery-3d-page"', `<link rel="stylesheet" href="../../../assets/site/manzokukyo-gallery-3d.css?${assetVersionQuery}">\n      <main class="gallery-page gallery-3d-page"`);
  body += `\n      <script type="module" src="../../../assets/site/manzokukyo-gallery-3d.js?${assetVersionQuery}"></script>\n`;
  const options = {
    ...original,
    title: '記憶の画廊 3D | 満足教',
    description: '四つの展示室を立体で巡り、24枚の記録から六つの検印を集める「記憶の画廊」の試作ページです。',
    urlPath: `${character.id}/manzokukyo/truth/gallery-3d/`,
    robots: 'noindex,nofollow',
    body,
  };
  const rendered = htmlPage(options);
  return typeof rendered === 'string'
    ? rendered.replace(/<meta\b(?=[^>]*\bname=["']robots["'])[^>]*>/gi, '<meta name="robots" content="noindex,nofollow">')
    : rendered;
}
