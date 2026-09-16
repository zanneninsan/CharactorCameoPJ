// One cancellable timeline for each surface. No per-frame DOM work or new GPU pass.
export function mountGalleryFeedback({ stage, modal, play, reduced }) {
  const seal = modal.querySelector('[data-gallery-loop-imprint]');
  const touch = stage.querySelector('[data-gallery-loop-touch]');
  let stopSeal = () => {}, stopTouch = () => {};
  function timeline(node, cues, duration) {
    let alive = true;
    const timers = [], sounds = [];
    function stop() {
      if (!alive) return;
      alive = false;
      for (const id of timers) clearTimeout(id);
      for (const cancel of sounds) if (typeof cancel === 'function') cancel();
      node.hidden = true; node.setAttribute('data-phase', 'idle');
    }
    node.hidden = false; node.setAttribute('data-phase', 'gather');
    for (const [at, phase, name, options] of cues) {
      const run = () => {
        if (!alive) return;
        node.setAttribute('data-phase', phase);
        if (name) sounds.push(play(name, options));
      };
      if (!at) run(); else timers.push(setTimeout(run, at));
    }
    timers.push(setTimeout(() => { if (alive) stop(); }, duration));
    return stop;
  }
  return {
    imprint(record) {
      stopSeal();
      seal.querySelector('[data-gallery-loop-imprint-fragment]').textContent = record.seal.fragment;
      seal.querySelector('[data-gallery-loop-imprint-number]').textContent = `記録 ${String(record.number).padStart(2, '0')} / 仮押し`;
      const impact = reduced.matches ? 0 : 380;
      stopSeal = timeline(seal, [
        [0, 'gather', 'gallery-reveal', { level: .28, rate: .65 }],
        [impact, 'press', 'gallery-collect', { level: .85, rate: .88 + record.seal.order * .018 }],
        [impact + 160, 'bloom', 'gallery-unseal', { level: .34, rate: 1.25 }],
        [impact + 1100, 'settle', 'discover', { level: .22, rate: 1.08 }],
      ], reduced.matches ? 1800 : 2900);
    },
    hand(pan = 0) {
      stopTouch();
      stopTouch = timeline(touch, [
        [0, 'grasp', 'portrait', { level: .52, rate: .6, pan: Math.max(-1, Math.min(1, pan)) }],
        [240, 'held', 'transmission', { level: .2, rate: .8 }],
      ], 1700);
    },
    closeSeal() { stopSeal(); },
    cancel() { stopSeal(); stopTouch(); },
  };
}
