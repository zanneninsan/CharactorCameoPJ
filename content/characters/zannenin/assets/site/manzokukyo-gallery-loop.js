const kinds = ['upside-down', 'negative', 'same-image'];
export function newLoop(best = 0) {
  return { round: 0, streak: 0, best: Number.isSafeInteger(best) && best >= 0 ? best : 0, anomaly: null };
}
export function chooseAnomaly(random = Math.random, { visitorsReady = false } = {}) {
  if (random() < .45) return null;
  const available = visitorsReady ? [...kinds, 'darenin-rush'] : kinds;
  const kind = available[Math.min(available.length - 1, Math.floor(random() * available.length))];
  return kind === 'darenin-rush' ? { kind } : { kind, index: Math.min(23, Math.floor(random() * 24)) };
}
export function paintingAppearance(index, anomaly) {
  return { imageIndex: anomaly?.kind === 'same-image' ? anomaly.index : index,
    upsideDown: anomaly?.kind === 'upside-down' && anomaly.index === index,
    negative: anomaly?.kind === 'negative' && anomaly.index === index };
}
export function judgeLoop(state, direction, random = Math.random, options) {
  if (!['forward', 'back'].includes(direction)) throw Error('Choose a corridor exit.');
  const correct = Boolean(state.anomaly) === (direction === 'back');
  const streak = correct ? state.streak + (state.round === 0 ? 0 : 1) : 0;
  return { correct, baseline: state.round === 0, previous: state.anomaly,
    next: { round: state.round + 1, streak, best: Math.max(state.best, streak), anomaly: chooseAnomaly(random, options) } };
}
export function loopExit(position) {
  if (Math.abs(position.x) > 1.25) return null;
  return position.z <= -62.1 ? 'forward' : position.z >= 2.65 ? 'back' : null;
}
export function describeAnomaly(anomaly) {
  if (!anomaly) return 'この巡回に異変はありませんでした。';
  if (anomaly.kind === 'darenin-rush') return '残念院さんが姿を消し、誰念院さんが4体、横一列で奥から迫ってきました。';
  if (anomaly.kind === 'same-image') return 'すべての額縁が、同じ絵になっていました。';
  return `記録 ${String(anomaly.index + 1).padStart(2, '0')} の絵が${anomaly.kind === 'negative' ? '色反転' : '逆さま'}になっていました。`;
}

export function mountGalleryLoop({ stage, canvas, records, assetVersionQuery, gallery, exhibition, random = Math.random }) {
  const q = selector => stage.querySelector(selector);
  const panel = q('[data-gallery-loop-panel]'), veil = q('[data-gallery-loop-transition]');
  const modal = document.querySelector('[data-gallery-loop-inspection]');
  const image = modal.querySelector('img');
  const collectButton = modal.querySelector('[data-gallery-loop-collect]');
  const sealNote = modal.querySelector('[data-gallery-loop-seal-note]');
  const choices = [...stage.querySelectorAll('[data-gallery-loop-mode]')];
  const bestKey = 'manzokukyo-gallery-loop-best-v1';
  let savedBest = 0;
  try { savedBest = Number(localStorage.getItem(bestKey)); } catch {}
  let state = newLoop(savedBest), active = true, busy = true, epoch = 0, disposed = false, retry = false;
  let heldSeal = null, inspected = null, imageReady = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  function render() {
    document.body.classList.toggle('is-gallery-loop', active);
    panel.hidden = !active;
    q('[data-gallery-loop-bag]').hidden = !active;
    for (const choice of choices) { choice.setAttribute('aria-pressed', String((choice.getAttribute('data-gallery-loop-mode') === 'loop') === active)); choice.disabled = busy; }
    q('[data-gallery-loop-round]').textContent = state.round === 0 ? '初回 / 正常な展示' : `巡回 ${String(state.round).padStart(2, '0')}`;
    q('[data-gallery-loop-streak]').textContent = String(state.streak).padStart(2, '0');
    q('[data-gallery-loop-best]').textContent = String(state.best).padStart(2, '0');
    q('[data-gallery-loop-restart]').disabled = busy;
    const progress = gallery.state();
    q('[data-gallery-loop-hint]').textContent = state.round === 0 ? 'まずは正常な24枚を覚えて奥へ。次の巡回から、検印を1枚仮押しして持ち帰ろう。' : '金色の印を1周1枚仮押し。異変があれば入口へ、なければ奥へ。正しい判断で検印が確定。';
    q('[data-gallery-loop-carry]').textContent = heldSeal ? `仮押し「${records.find(record => record.number === heldSeal).seal.fragment}」 / 正しい扉で確定` : progress.count === 6 ? '6枚を持ち帰った。検印帳で文字を並べ、赤い扉へ。' : state.round === 0 ? '初回は観察のみ / 次の巡回から回収' : '仮押し なし / 金色の印がある絵を探そう';
    q('[data-gallery-loop-filed]').textContent = `${progress.count} / 6`;
    for (const slot of stage.querySelectorAll('[data-gallery-loop-slot]')) {
      const record = records.find(record => record.number === Number(slot.getAttribute('data-gallery-loop-slot')));
      const filed = progress.found.includes(record.number), held = record.number === heldSeal;
      slot.textContent = filed || held ? record.seal.fragment : '—';
      slot.setAttribute('data-status', filed ? 'filed' : held ? 'held' : 'empty');
      slot.setAttribute('aria-label', filed ? `持ち帰り済み「${record.seal.fragment}」` : held ? `仮押し「${record.seal.fragment}」` : '未回収');
    }
  }
  function notice(title, text, result = 'loading') {
    veil.hidden = false; veil.setAttribute('data-result', result);
    q('[data-gallery-loop-transition-title]').textContent = title;
    q('[data-gallery-loop-transition-note]').textContent = text;
    q('[data-gallery-loop-retry]').hidden = true;
  }
  function rememberBest() { try { localStorage.setItem(bestKey, String(state.best)); } catch {} }
  async function prepare(title, note, result = 'loading', duration = 0) {
    const token = ++epoch;
    busy = true; retry = false; exhibition.stop(); render(); notice(title, note, result);
    const [ready] = await Promise.all([exhibition.prepareLoop(active ? state.anomaly : null, state.round), delay(reduced.matches ? Math.min(duration, 450) : duration)]).catch(() => [false]);
    if (disposed || token !== epoch) return false;
    if (!ready) {
      retry = true;
      notice('展示の準備ができませんでした', '展示を読み込めないため、判定を止めています。読み込み直してから進んでください。', 'loading');
      q('[data-gallery-loop-retry]').hidden = false;
      // Switching to the accessible catalog remains possible after a graphics failure.
      for (const choice of choices) choice.disabled = false;
      return false;
    }
    busy = false; veil.hidden = true; render(); canvas.focus({ preventScroll: true }); exhibition.wake?.();
    return true;
  }
  async function cross(direction) {
    if (!active || busy || disposed || document.querySelector('dialog[open]')) return false;
    if (exhibition.hasImageErrors()) {
      void prepare('展示を確認しています', '画像を読み込み直しています。この巡回の判定と展示内容は変わりません。');
      return false;
    }
    const verdict = judgeLoop(state, direction, random, { visitorsReady: exhibition.hasVisitors?.() === true });
    const carried = heldSeal;
    const confirmed = verdict.correct && carried !== null ? gallery.confirmSeal(carried) : null;
    heldSeal = null;
    state = verdict.next; rememberBest();
    gallery.play(verdict.correct ? 'gallery-unseal' : 'transmission', { level: verdict.correct ? .55 : .65 });
    const title = verdict.baseline && verdict.correct ? '正常な展示を記憶しました' : verdict.correct ? '判断は、正しかった。' : 'また、最初から。';
    const sealResult = confirmed ? `検印「${confirmed.fragment}」を持ち帰りました。${confirmed.count} / 6` : carried !== null && !verdict.correct ? '仮押しの印が消えました。持ち帰り済みの検印は残っています。' : verdict.correct ? '今回は仮押しなし。次の巡回で金色の印を探してください。' : '連続正解が 00 に戻りました。持ち帰り済みの検印は残っています。';
    const note = verdict.baseline && verdict.correct ? 'ここからは、検印を仮押しして正しい扉へ。異変があるなら引き返してください。' : `${describeAnomaly(verdict.previous)} ${sealResult}`;
    void prepare(title, note, verdict.correct ? 'correct' : 'wrong', 2200).then(ready => { if (ready && confirmed?.complete && active && !disposed) gallery.celebrateSeals(); });
    return true;
  }
  function inspect(index) {
    if (!active || busy || !Number.isInteger(index) || index < 0 || index >= records.length || modal.open) return false;
    exhibition.stop();
    inspected = index; imageReady = false;
    const appearance = paintingAppearance(index, state.anomaly);
    image.style.transform = appearance.upsideDown ? 'rotate(180deg)' : '';
    image.style.filter = appearance.negative ? 'invert(1)' : '';
    image.src = new URL(`../../../assets/generated/manzokukyo/gallery/gallery-${records[appearance.imageIndex].id}.webp?${assetVersionQuery}`, document.baseURI).href;
    image.alt = `展示中の記録 ${String(index + 1).padStart(2, '0')}`;
    modal.querySelector('[data-gallery-loop-inspection-title]').textContent = `記録 ${String(index + 1).padStart(2, '0')}`;
    imageReady = image.complete && image.naturalWidth > 0;
    renderInspection();
    modal.showModal(); gallery.play('gallery-reveal', { level: .35 });
    return true;
  }
  function renderInspection() {
    const record = records[inspected];
    const filed = record && gallery.state().found.includes(record.number);
    collectButton.hidden = !record?.seal;
    collectButton.disabled = !imageReady || state.round === 0 || heldSeal !== null || filed || !active || busy;
    collectButton.textContent = filed ? '持ち帰り済み' : heldSeal === record?.number ? `仮押し「${record.seal.fragment}」` : '⊹ 検印を仮押しする';
    sealNote.textContent = !imageReady ? '絵を読み込んでいます。' : !record?.seal ? 'この額縁に検印はありません。絵の違和感もよく見て。' : filed ? 'この検印は、すでに検印帳に記録されています。' : state.round === 0 ? '最初の一周は観察。次の巡回から仮押しできます。' : heldSeal !== null ? '1周に持ち歩ける印は1枚。正しい扉を選ぶと、検印帳に残ります。' : '仮押しした後も、回廊をよく観察。異変があれば引き返してください。';
    modal.setAttribute('data-held', String(record?.number === heldSeal));
  }
  function collect() {
    const record = records[inspected];
    if (!active || busy || !modal.open || !imageReady || state.round === 0 || heldSeal !== null || !record?.seal || gallery.state().found.includes(record.number)) return false;
    heldSeal = record.number; renderInspection(); render();
    gallery.play('gallery-collect', { level: .7, rate: .95 + record.seal.order * .015 });
    return true;
  }
  function closeInspection() { modal.close(); canvas.focus({ preventScroll: true }); }
  modal.querySelector('[data-gallery-loop-inspection-close]').addEventListener('click', closeInspection);
  collectButton.addEventListener('click', collect);
  modal.addEventListener('cancel', event => { event.preventDefault(); closeInspection(); });
  modal.addEventListener('click', event => { if (event.target === modal) closeInspection(); });
  image.addEventListener('load', () => { imageReady = image.naturalWidth > 0; renderInspection(); });
  image.addEventListener('error', () => { imageReady = false; renderInspection(); sealNote.textContent = '画像を読み込めませんでした。閉じて、もう一度お試しください。'; });
  async function setMode(mode) {
    if (!['loop', 'gallery'].includes(mode) || (busy && !retry)) return false;
    ++epoch; active = mode === 'loop'; heldSeal = null; modal.close(); exhibition.stop();
    if (active) { state = newLoop(state.best); await prepare('正常な展示を開いています', '最初の一周で、絵の配置を覚えてください。'); }
    else { busy = false; retry = false; veil.hidden = true; render(); await exhibition.prepareLoop(null, 0); }
    return true;
  }
  for (const choice of choices) choice.addEventListener('click', () => { void setMode(choice.getAttribute('data-gallery-loop-mode')); });
  function reset() { heldSeal = null; state = newLoop(state.best); if (active) void prepare('初回の展示へ', '検印と連続正解をリセットしました。最高記録は残っています。'); else { render(); canvas.focus({ preventScroll: true }); } }
  q('[data-gallery-loop-restart]').addEventListener('click', () => { if (!busy) gallery.resetGallery(); });
  q('[data-gallery-loop-ledger]').addEventListener('click', () => { exhibition.stop(); document.querySelector('[data-ledger-toggle]').click(); });
  q('[data-gallery-loop-retry]').addEventListener('click', () => { void prepare('展示を読み込み直しています', 'この巡回の内容は変わりません。'); });
  q('[data-gallery-loop-ui]').hidden = false;
  window.addEventListener('pagehide', event => { if (!event.persisted) { disposed = true; ++epoch; } });
  render();
  // Let the caller install the controller before the asynchronous preparation.
  queueMicrotask(() => { void prepare('正常な展示を開いています', '最初の一周で、絵の配置を覚えてください。'); });
  const controller = { get active() { return active; }, get busy() { return busy; }, inspect, collect, closeInspection, cross, setMode, reset,
    snapshot: () => ({ active, busy, round: state.round, streak: state.streak, best: state.best, baseline: state.round === 0, inspectionOpen: modal.open, inspectedRecord: modal.open ? records[inspected]?.number : null, heldSeal, filedSeals: gallery.state().count }),
    fallback: () => { ++epoch; busy = false; active = false; heldSeal = null; modal.close(); veil.hidden = true; render(); q('[data-gallery-loop-ui]').hidden = true; gallery.setExpedition(null); } };
  gallery.setExpedition(controller);
  return controller;
}
