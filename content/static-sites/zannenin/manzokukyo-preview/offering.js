const AMOUNTS = Object.freeze([0, 5, 100, 1000, 10000, 1000000, 100000000]);
const REACTIONS = Object.freeze({
  0: { title: '手ぶらの勇者', message: 'ケチ！…でも、来てくれたので満足です。', sound: 'transmission' },
  5: { title: 'ご縁のスポンサー', message: '五円！ご縁はいただきました。予算は、ほぼ据え置きです。', sound: 'portrait' },
  100: { title: '小銭の救世主', message: '百円！自販機の前で、あと少しだけ待ちます。', sound: 'portrait' },
  1000: { title: 'お札の先輩', message: 'お札だ！本日のお茶が、気持ちだけ豪華になります。', sound: 'discover' },
  10000: { title: '太っ腹さま', message: '一万円！急に姿勢がよくなりました。', sound: 'discover' },
  1000000: { title: '歩く予算', message: '百万！ごっこの財布に限界はない。急に敬語が増えそうです。', sound: 'discover' },
  100000000: { title: '石油王さま', message: '石油王さま！床まで金にしましょう。', sound: 'discover' }
});

// This is an in-memory joke. The dialog form never sends money or data.
export function createOffering({ canOpen = () => true, onChange, onSound } = {}) {
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
  let amount = 0, phase = 'choose', opener, active = false, hadModalClass = false, lastSoundAt = -Infinity;
  const isOpen = () => dialog.open;
  const otherModalOpen = () => [...document.querySelectorAll('dialog[open]')].some(element => element !== dialog)
    || Boolean(document.querySelector('.guestbook-modal.is-open, body.guestbook-is-open'));

  function play(id) {
    const now = performance.now();
    if (now - lastSoundAt < 180) return;
    lastSoundAt = now;
    onSound?.(id);
  }

  function resetRound() {
    amount = 0;
    phase = 'choose';
    for (const radio of radios) radio.checked = Number(radio.value) === amount;
    form.hidden = false;
    submitButton.disabled = false;
    result.hidden = true;
    resultActions.hidden = true;
    receipt.textContent = '';
    title.textContent = '';
    message.textContent = '';
  }

  function finishClose() {
    if (!active || isOpen()) return;
    active = false;
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
    active = true;
    document.body.classList.add('modal-open');
    onChange?.(true);
    play('tap');
    return true;
  }

  function close() {
    if (!isOpen()) return;
    dialog.close();
    finishClose();
    play('tap');
  }

  function choose(value) {
    if (typeof value !== 'number' || !AMOUNTS.includes(value)) throw RangeError('Choose one of the seven displayed offering amounts');
    if (phase !== 'choose') return false;
    const changed = amount !== value;
    amount = value;
    for (const radio of radios) radio.checked = Number(radio.value) === amount;
    if (changed && isOpen()) play('tap');
    return true;
  }

  function submit() {
    if (!isOpen() || phase !== 'choose') return false;
    phase = 'result';
    submitButton.disabled = true;
    form.hidden = true;
    result.hidden = false;
    resultActions.hidden = false;
    const reaction = REACTIONS[amount];
    receipt.textContent = `${amount.toLocaleString('ja-JP')}円のお布施ごっこ`;
    title.textContent = reaction.title;
    message.textContent = reaction.message;
    title.focus({ preventScroll: true });
    play(reaction.sound);
    return true;
  }

  form.addEventListener('submit', event => { event.preventDefault(); submit(); });
  for (const radio of radios) radio.addEventListener('change', () => { if (radio.checked) choose(Number(radio.value)); });
  for (const button of dialog.querySelectorAll('[data-offering-close]')) button.addEventListener('click', close);
  dialog.querySelector('[data-offering-again]').addEventListener('click', () => {
    if (!isOpen() || phase !== 'result') return;
    resetRound();
    radios[0].focus({ preventScroll: true });
    play('tap');
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', finishClose);
  resetRound();

  return {
    open, close, isOpen, choose, submit,
    state: () => ({ open: isOpen(), amount, phase, title: phase === 'result' ? REACTIONS[amount].title : null, message: phase === 'result' ? REACTIONS[amount].message : null })
  };
}
