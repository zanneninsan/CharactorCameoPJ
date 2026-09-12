export const achievementKey = 'manzokukyo-gallery-achievements-v1';

export function createGalleryAchievements(options, storage) {
  const kinds = options.filter(option => option.kind !== 'normal');
  let memory = {};
  function read() {
    try {
      const saved = JSON.parse(storage?.getItem(achievementKey) || '{}');
      return Object.fromEntries(kinds.filter(({ kind }) => saved?.[kind] === 1 || saved?.[kind] === 2).map(({ kind }) => [kind, saved[kind]]));
    } catch { return {}; }
  }
  function sync() { for (const [kind, level] of Object.entries(read())) memory[kind] = Math.max(memory[kind] || 0, level); }
  return {
    record(kind, correct, debug = false) {
      if (debug || !kinds.some(option => option.kind === kind)) return false;
      sync(); const previous = memory[kind] || 0;
      memory[kind] = Math.max(previous, correct ? 2 : 1);
      try { storage?.setItem(achievementKey, JSON.stringify(memory)); } catch {}
      return memory[kind] > previous;
    },
    snapshot() {
      sync();
      const entries = kinds.map(({ kind, label }, index) => ({ number: index + 1, level: memory[kind] || 0, label: memory[kind] ? label : '？？？' }));
      return { total: entries.length, encountered: entries.filter(entry => entry.level).length, solved: entries.filter(entry => entry.level === 2).length, entries };
    },
  };
}

export function mountAchievementBoard({ achievements, canvas, exhibition, canOpen, isViewing = () => false, enterViewing }) {
  const dialog = document.querySelector('[data-gallery-achievements]');
  if (!dialog) return null;
  const triggers = [...document.querySelectorAll('[data-gallery-achievements-open]')];
  const cards = [...dialog.querySelectorAll('[data-achievement-card]')];
  const viewing = dialog.querySelector('[data-achievements-viewing]');
  const confirmation = dialog.querySelector('[data-viewing-confirm]');
  const accept = dialog.querySelector('[data-viewing-accept]');
  const cancel = dialog.querySelector('[data-viewing-cancel]');
  let disposed = false;
  function render() {
    if (disposed) return;
    const state = achievements.snapshot();
    for (const trigger of triggers) { trigger.textContent = `実績 ${state.encountered} / ${state.total}`; trigger.disabled = !canOpen(); }
    dialog.querySelector('[data-achievement-count]').textContent = `遭遇 ${state.encountered} / ${state.total}　看破 ${state.solved} / ${state.total}`;
    dialog.querySelector('[data-achievement-complete]').hidden = state.solved !== state.total;
    if (viewing) { viewing.disabled = !canOpen() || isViewing(); viewing.textContent = isViewing() ? '作品鑑賞中' : '作品鑑賞'; }
    state.entries.forEach((entry, i) => {
      cards[i].setAttribute('data-level', String(entry.level));
      cards[i].querySelector('strong').textContent = entry.label;
      cards[i].querySelector('small').textContent = ['未遭遇', '遭遇済み', '看破済み'][entry.level];
    });
  }
  function resetConfirmation() { if (confirmation) confirmation.hidden = true; }
  function open() { if (disposed || !canOpen() || document.querySelector('dialog[open]')) return; resetConfirmation(); exhibition.stop(); render(); dialog.showModal(); }
  function close() { resetConfirmation(); dialog.close(); canvas.focus({ preventScroll: true }); exhibition.wake?.(); }
  viewing?.addEventListener('click', () => {
    if (disposed || !dialog.open || !canOpen() || isViewing()) return;
    confirmation.hidden = false; cancel.focus();
  });
  cancel?.addEventListener('click', () => { resetConfirmation(); viewing.focus(); });
  accept?.addEventListener('click', () => {
    if (disposed || !dialog.open || confirmation.hidden || !canOpen() || isViewing()) return;
    // Only the explicit confirmation mutates the round and discards its held seal.
    close(); void enterViewing();
  });
  for (const trigger of triggers) trigger.addEventListener('click', open);
  dialog.querySelector('[data-achievements-close]').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (confirmation && !confirmation.hidden) { resetConfirmation(); viewing.focus(); } else close(); });
  render();
  return { render, dispose() { disposed = true; resetConfirmation(); dialog.close(); for (const trigger of triggers) trigger.removeEventListener('click', open); } };
}
