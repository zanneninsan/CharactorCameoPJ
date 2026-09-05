const AMOUNTS = Object.freeze([0, 5, 100, 1000, 10000, 1000000, 100000000]);
const REACTIONS = Object.freeze({
  0: { title: '手ぶらの勇者', message: 'ケチ！…でも、来てくれたので満足です。', tier: 'empty', teaser: 'お気持ちは、目に見えないタイプ。', progress: '空気を受け取り中……', stamp: '来訪ヨシ！', drop: 'empty', duration: 1150 },
  5: { title: 'ご縁のスポンサー', message: '五円！ご縁はいただきました。予算は、ほぼ据え置きです。', tier: 'coin', teaser: 'ご縁の音、聞かせてください。', progress: 'ご縁が、ころころ……', stamp: 'ご縁あり', drop: 'coin', duration: 850 },
  100: { title: '小銭の救世主', message: '百円！自販機の前で、あと少しだけ待ちます。', tier: 'coin', teaser: 'いい音がしそうな、お気持ちです。', progress: '小銭の響きを鑑賞中……', stamp: '満足！', drop: 'coin', duration: 900 },
  1000: { title: 'お札の先輩', message: 'お札だ！本日のお茶が、気持ちだけ豪華になります。', tier: 'note', teaser: 'お札が来る。背筋を伸ばそう。', progress: 'お札を丁重にお迎え中……', stamp: '感謝！', drop: 'note', duration: 1000 },
  10000: { title: '太っ腹さま', message: '一万円！急に姿勢がよくなりました。', tier: 'blessing', teaser: '祝福の準備、入りまーす。', progress: '祝福の紙吹雪を準備中……', stamp: '大満足！', drop: 'note', fanfare: 'blessing', duration: 1150 },
  1000000: { title: '歩く予算', message: '百万！ごっこの財布に限界はない。急に敬語が増えそうです。', tier: 'royal', teaser: '急いで、おもてなしの色を増やせ。', progress: '特別待遇を大急ぎで手配中……', stamp: 'VIP待遇', drop: 'note', fanfare: 'blessing', duration: 1250 },
  100000000: { title: '石油王さま', message: '石油王さま！床まで金にしましょう。', tier: 'royal', teaser: '石油王のお通りです。道を開けて。', progress: '石油王さまの入場準備中……', stamp: '石油王降臨', drop: 'note', fanfare: 'royal', duration: 1450 }
});

// A local pretend ceremony: no payment, submission, or saved donation history.
export function createOffering({ canOpen = () => true, onChange, onSound, soundEnabled = () => false, onToggleSound } = {}) {
  const dialog = document.querySelector('.offering-dialog');
  if (!dialog) throw Error('Offering dialog is missing');
  const form = dialog.querySelector('[data-offering-form]');
  const radios = [...dialog.querySelectorAll('input[name="offering-amount"]')];
  const submitButton = dialog.querySelector('[data-offering-submit]');
  const result = dialog.querySelector('[data-offering-result]');
  const resultActions = dialog.querySelector('[data-offering-result-actions]');
  const receipt = dialog.querySelector('[data-offering-receipt]');
  const title = dialog.querySelector('[data-offering-result-title]');
  const message = dialog.querySelector('[data-offering-reaction]');
  const teaser = dialog.querySelector('[data-offering-teaser]');
  const processing = dialog.querySelector('[data-offering-processing]');
  const progress = dialog.querySelector('[data-offering-progress]');
  const stamp = dialog.querySelector('[data-offering-stamp]');
  const token = dialog.querySelector('.offering-token');
  const soundButton = dialog.querySelector('[data-offering-sound]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const timers = new Set(), soundStops = new Set();
  let amount = 0, phase = 'choose', opener, active = false, hadModalClass = false, lastTapAt = -Infinity, complete;
  const isOpen = () => dialog.open;
  const otherModalOpen = () => [...document.querySelectorAll('dialog[open]')].some(element => element !== dialog)
    || Boolean(document.querySelector('.guestbook-modal.is-open, body.guestbook-is-open'));

  function play(id) {
    if (document.hidden) return;
    if (id === 'tap') {
      const now = performance.now();
      if (now - lastTapAt < 180) return;
      lastTapAt = now;
    }
    const stop = onSound?.(id);
    if (typeof stop === 'function') soundStops.add(stop);
  }
  function stopSounds() {
    for (const stop of soundStops) stop();
    soundStops.clear();
  }
  function clearEffects() {
    for (const timer of timers) clearTimeout(timer);
    timers.clear(); stopSounds();
  }
  function later(delay, action) {
    const timer = setTimeout(() => { timers.delete(timer); if (isOpen() && phase === 'offering') action(); }, delay);
    timers.add(timer);
  }
  function setPhase(value) { phase = value; dialog.dataset.phase = value; }
  function refreshSound() {
    const enabled = soundEnabled();
    soundButton.setAttribute('aria-pressed', String(enabled));
    soundButton.textContent = enabled ? '♪ 音あり' : '♪ 音をオン';
    soundButton.setAttribute('aria-label', enabled ? '音をオフにする' : '音をオンにする');
  }
  function updateSelection() {
    const reaction = REACTIONS[amount];
    dialog.dataset.tier = reaction.tier;
    teaser.textContent = reaction.teaser;
    token.textContent = amount === 0 ? '気' : '¥';
    for (const radio of radios) radio.checked = Number(radio.value) === amount;
  }
  function resetRound() {
    clearEffects(); complete?.(false); complete = undefined;
    amount = 0; setPhase('choose'); updateSelection(); refreshSound();
    form.hidden = false; submitButton.disabled = false; processing.hidden = true;
    result.hidden = true; resultActions.hidden = true;
    receipt.textContent = ''; title.textContent = ''; message.textContent = ''; stamp.textContent = '';
    dialog.removeAttribute('aria-busy'); dialog.scrollTop = 0;
  }
  function finishClose() {
    if (!active || isOpen()) return;
    active = false; clearEffects(); complete?.(false); complete = undefined;
    dialog.removeAttribute('aria-busy');
    if (!hadModalClass && !otherModalOpen()) document.body.classList.remove('modal-open');
    onChange?.(false);
    if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
  }
  function open(from) {
    if (isOpen()) return true;
    if (typeof dialog.showModal !== 'function' || !canOpen() || otherModalOpen()) return false;
    opener = typeof from?.focus === 'function' ? from : document.activeElement;
    hadModalClass = document.body.classList.contains('modal-open');
    resetRound();
    try { dialog.showModal(); } catch { return false; }
    active = true; document.body.classList.add('modal-open'); onChange?.(true); play('tap');
    return true;
  }
  function close() {
    if (!isOpen()) return;
    dialog.close(); finishClose(); play('tap');
  }
  function choose(value) {
    if (typeof value !== 'number' || !AMOUNTS.includes(value)) throw RangeError('Choose one of the seven displayed offering amounts');
    if (phase !== 'choose') return false;
    const changed = amount !== value;
    amount = value; updateSelection();
    if (changed && isOpen()) play('tap');
    return true;
  }
  function reveal({ silent = false, focus = true } = {}) {
    if (!isOpen() || phase !== 'offering') return;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    // Let a coin's natural ringing tail finish beneath the result stamp.
    setPhase('result'); dialog.removeAttribute('aria-busy');
    processing.hidden = true; result.hidden = false; resultActions.hidden = false;
    const reaction = REACTIONS[amount];
    receipt.textContent = `${amount.toLocaleString('ja-JP')}円のお布施ごっこ`;
    title.textContent = reaction.title; message.textContent = reaction.message; stamp.textContent = reaction.stamp;
    if (focus) title.focus({ preventScroll: true });
    if (!silent && reaction.fanfare) play(`offering-${reaction.fanfare}`);
    complete?.(true); complete = undefined;
  }
  function submit() {
    if (!isOpen() || phase !== 'choose') return false;
    clearEffects(); setPhase('offering'); dialog.setAttribute('aria-busy', 'true');
    form.hidden = true; submitButton.disabled = true; processing.hidden = false;
    const reaction = REACTIONS[amount];
    progress.textContent = reaction.progress; progress.focus({ preventScroll: true }); dialog.scrollTop = 0;
    const finished = new Promise(resolve => { complete = resolve; });
    if (document.hidden) reveal({ silent: true, focus: false });
    else if (reducedMotion.matches) { reveal(); if (!reaction.fanfare) play(`offering-${reaction.drop}`); }
    else {
      later(amount === 0 ? 520 : reaction.drop === 'coin' ? 460 : 180, () => play(`offering-${reaction.drop}`));
      later(reaction.duration, reveal);
    }
    return finished;
  }
  form.addEventListener('submit', event => { event.preventDefault(); void submit(); });
  for (const radio of radios) radio.addEventListener('change', () => { if (radio.checked) choose(Number(radio.value)); });
  for (const button of dialog.querySelectorAll('[data-offering-close]')) button.addEventListener('click', close);
  dialog.querySelector('[data-offering-again]').addEventListener('click', () => {
    if (!isOpen() || phase !== 'result') return;
    resetRound(); radios[0].focus({ preventScroll: true }); play('tap');
  });
  soundButton.addEventListener('click', async () => {
    // The existing audio revision guard lets a second click cancel a pending enable.
    // Keep OFF available even while an effect file is still downloading.
    try {
      const pending = onToggleSound?.();
      refreshSound();
      if (!soundEnabled()) stopSounds();
      await pending;
    } finally { if (isOpen()) refreshSound(); }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', finishClose);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearEffects(); reveal({ silent: true, focus: false }); }
    else if (isOpen()) refreshSound();
  });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) reveal({ silent: true }); });
  window.addEventListener('pagehide', () => { clearEffects(); reveal({ silent: true, focus: false }); complete?.(false); complete = undefined; });
  resetRound();
  return { open, close, isOpen, choose, submit,
    state: () => ({ open: isOpen(), amount, phase, title: phase === 'result' ? REACTIONS[amount].title : null, message: phase === 'result' ? REACTIONS[amount].message : null }) };
}
