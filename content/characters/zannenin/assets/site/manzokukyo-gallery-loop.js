const kinds = ['upside-down', 'negative', 'same-image'];
export function newLoop(best = 0) {
  return { round: 0, streak: 0, best: Number.isSafeInteger(best) && best >= 0 ? best : 0, anomaly: null };
}
export function chooseAnomaly(random = Math.random) {
  if (random() < .45) return null;
  return { kind: kinds[Math.min(2, Math.floor(random() * kinds.length))], index: Math.min(23, Math.floor(random() * 24)) };
}
export function paintingAppearance(index, anomaly) {
  return { imageIndex: anomaly?.kind === 'same-image' ? anomaly.index : index,
    upsideDown: anomaly?.kind === 'upside-down' && anomaly.index === index,
    negative: anomaly?.kind === 'negative' && anomaly.index === index };
}
export function judgeLoop(state, direction, random = Math.random) {
  if (!['forward', 'back'].includes(direction)) throw Error('Choose a corridor exit.');
  const correct = Boolean(state.anomaly) === (direction === 'back');
  const streak = correct ? state.streak + (state.round === 0 ? 0 : 1) : 0;
  return { correct, baseline: state.round === 0, previous: state.anomaly,
    next: { round: state.round + 1, streak, best: Math.max(state.best, streak), anomaly: chooseAnomaly(random) } };
}
export function loopExit(position) {
  if (Math.abs(position.x) > 1.25) return null;
  return position.z <= -62.1 ? 'forward' : position.z >= 2.65 ? 'back' : null;
}
export function describeAnomaly(anomaly) {
  if (!anomaly) return 'この巡回に異変はありませんでした。';
  if (anomaly.kind === 'same-image') return 'すべての額縁が、同じ絵になっていました。';
  return `記録 ${String(anomaly.index + 1).padStart(2, '0')} の絵が${anomaly.kind === 'negative' ? '色反転' : '逆さま'}になっていました。`;
}

export function mountGalleryLoop({ stage, canvas, records, assetVersionQuery, gallery, exhibition, random = Math.random }) {
  const q = selector => stage.querySelector(selector);
  const panel = q('[data-gallery-loop-panel]'), veil = q('[data-gallery-loop-transition]');
  const modal = document.querySelector('[data-gallery-loop-inspection]');
  const image = modal.querySelector('img');
  const choices = [...stage.querySelectorAll('[data-gallery-loop-mode]')];
  const bestKey = 'manzokukyo-gallery-loop-best-v1';
  let savedBest = 0;
  try { savedBest = Number(localStorage.getItem(bestKey)); } catch {}
  let state = newLoop(savedBest), active = true, busy = true, epoch = 0, disposed = false, retry = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  function render() {
    document.body.classList.toggle('is-gallery-loop', active);
    panel.hidden = !active;
    for (const choice of choices) { choice.setAttribute('aria-pressed', String((choice.getAttribute('data-gallery-loop-mode') === 'loop') === active)); choice.disabled = busy; }
    q('[data-gallery-loop-round]').textContent = state.round === 0 ? '初回 / 正常な展示' : `巡回 ${String(state.round).padStart(2, '0')}`;
    q('[data-gallery-loop-streak]').textContent = String(state.streak).padStart(2, '0');
    q('[data-gallery-loop-best]').textContent = String(state.best).padStart(2, '0');
    q('[data-gallery-loop-restart]').disabled = busy;
    q('[data-gallery-loop-hint]').textContent = state.round === 0 ? 'まずは正常な24枚を覚えて、奥の扉へ。次の巡回から異変が紛れます。' : '異変がなければ奥へ。見つけたら、来た道を入口まで引き返す。';
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
    if (disposed || token !== epoch) return;
    if (!ready) {
      retry = true;
      notice('展示の準備ができませんでした', '画像を読み込めないため、判定を止めています。読み込み直してから進んでください。', 'loading');
      q('[data-gallery-loop-retry]').hidden = false;
      // Switching to the accessible catalog remains possible after a graphics failure.
      for (const choice of choices) choice.disabled = false;
      return;
    }
    busy = false; veil.hidden = true; render(); canvas.focus({ preventScroll: true });
  }
  async function cross(direction) {
    if (!active || busy || disposed) return false;
    if (exhibition.hasImageErrors()) {
      void prepare('展示を確認しています', '画像を読み込み直しています。この巡回の判定と展示内容は変わりません。');
      return false;
    }
    const verdict = judgeLoop(state, direction, random);
    state = verdict.next; rememberBest();
    gallery.play(verdict.correct ? 'gallery-unseal' : 'transmission', { level: verdict.correct ? .55 : .65 });
    const title = verdict.baseline && verdict.correct ? '正常な展示を記憶しました' : verdict.correct ? '判断は、正しかった。' : 'また、最初から。';
    const note = verdict.baseline && verdict.correct ? 'ここからは、同じとは限りません。' : `${describeAnomaly(verdict.previous)} ${verdict.correct ? '同じ回廊が、また続いています。' : '連続正解が 00 に戻りました。'}`;
    void prepare(title, note, verdict.correct ? 'correct' : 'wrong', 1700);
    return true;
  }
  function inspect(index) {
    if (!active || busy || !Number.isInteger(index) || index < 0 || index >= records.length || modal.open) return false;
    exhibition.stop();
    const appearance = paintingAppearance(index, state.anomaly);
    image.style.transform = appearance.upsideDown ? 'rotate(180deg)' : '';
    image.style.filter = appearance.negative ? 'invert(1)' : '';
    image.src = new URL(`../../../assets/generated/manzokukyo/gallery/gallery-${records[appearance.imageIndex].id}.webp?${assetVersionQuery}`, document.baseURI).href;
    image.alt = `展示中の記録 ${String(index + 1).padStart(2, '0')}`;
    modal.querySelector('[data-gallery-loop-inspection-title]').textContent = `記録 ${String(index + 1).padStart(2, '0')}`;
    modal.showModal(); gallery.play('gallery-reveal', { level: .35 });
    return true;
  }
  function closeInspection() { modal.close(); canvas.focus({ preventScroll: true }); }
  modal.querySelector('button').addEventListener('click', closeInspection);
  modal.addEventListener('cancel', event => { event.preventDefault(); closeInspection(); });
  modal.addEventListener('click', event => { if (event.target === modal) closeInspection(); });
  image.addEventListener('error', () => { modal.querySelector('[data-gallery-loop-inspection-title]').textContent = '画像を読み込めませんでした。閉じて、もう一度お試しください。'; });
  async function setMode(mode) {
    if (!['loop', 'gallery'].includes(mode) || (busy && !retry)) return false;
    ++epoch; active = mode === 'loop'; modal.close(); exhibition.stop();
    if (active) { state = newLoop(state.best); await prepare('正常な展示を開いています', '最初の一周で、絵の配置を覚えてください。'); }
    else { busy = false; retry = false; veil.hidden = true; render(); await exhibition.prepareLoop(null, 0); }
    return true;
  }
  for (const choice of choices) choice.addEventListener('click', () => { void setMode(choice.getAttribute('data-gallery-loop-mode')); });
  q('[data-gallery-loop-restart]').addEventListener('click', () => { if (!busy) { state = newLoop(state.best); void prepare('初回の展示へ', '連続正解だけをリセットしました。最高記録と検印は残っています。'); } });
  q('[data-gallery-loop-retry]').addEventListener('click', () => { void prepare('展示を読み込み直しています', 'この巡回の内容は変わりません。'); });
  q('[data-gallery-loop-ui]').hidden = false;
  window.addEventListener('pagehide', event => { if (!event.persisted) { disposed = true; ++epoch; } });
  render();
  // Let the caller install the controller before the asynchronous preparation.
  queueMicrotask(() => { void prepare('正常な展示を開いています', '最初の一周で、絵の配置を覚えてください。'); });
  return { get active() { return active; }, get busy() { return busy; }, inspect, cross, setMode,
    snapshot: () => ({ active, busy, round: state.round, streak: state.streak, best: state.best, baseline: state.round === 0, inspectionOpen: modal.open }),
    fallback: () => { ++epoch; busy = false; active = false; modal.close(); veil.hidden = true; render(); q('[data-gallery-loop-ui]').hidden = true; } };
}
