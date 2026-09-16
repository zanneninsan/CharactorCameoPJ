export const openingKey = 'manzokukyo-gallery-opening-v1';
export const openingDuration = 6;
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };

export function arrivalPose(seconds, narrow = false) {
  const travel = smooth((seconds - 1.2) / 4.8);
  return { door: smooth(seconds / 1.8) * 1.38, z: 9.4 - travel * 8.6,
    lookX: narrow ? 0 : -1.9 * (1 - smooth(seconds / 2.4)), lookZ: 4 - travel * 16,
    title: smooth((seconds - 2.6) / .8) * (1 - smooth((seconds - 5) / .8)) };
}

// The same physical entrance is used for arrival and for turning back later.
export function createGalleryArrival(T, { scene, box, material, basic, gold, stone, cornice }) {
  const root = new T.Group(); root.name = 'Gallery entrance and vestibule'; scene.add(root);
  const dark = material({ color: 0x111c1c, roughness: .87 });
  const wood = material({ color: 0x18302b, roughness: .68 });
  const inset = material({ color: 0x0d1c1b, roughness: .86 });
  const glow = basic({ color: 0xf2cc85 });
  for (const side of [-1, 1]) {
    box(root, [4.05, 6.4, .3], [side * 3.675, 3.15, 4.5], stone);
    box(root, [.25, 6.4, 6.4], [side * 5.55, 3.15, 7.7], dark);
    box(root, [.16, 4.9, .36], [side * 1.68, 2.45, 4.22], gold);
    box(root, [.24, 5.08, .28], [side * 1.87, 2.52, 4.35], dark);
    box(root, [.08, .9, .09], [side * 2.32, 3.2, 4.72], gold);
    box(root, [.045, .65, .045], [side * 2.32, 3.22, 4.79], glow);
  }
  box(root, [3.3, 1.6, .3], [0, 5.6, 4.5], stone);
  box(root, [3.52, .16, .36], [0, 4.9, 4.22], gold);
  box(root, [4, .11, .45], [0, 5.08, 4.28], cornice);
  box(root, [11.4, .18, 6.4], [0, 6.45, 7.7], dark);
  box(root, [11.4, .12, 6.4], [0, -.07, 7.7], dark);
  box(root, [3.52, .04, .8], [0, .025, 4.25], gold);
  const leaves = [-1, 1].map(side => {
    const hinge = new T.Group(); hinge.position.set(side * 1.59, 0, 4.12); root.add(hinge);
    const x = -side * .79;
    box(hinge, [1.58, 4.74, .15], [x, 2.39, 0], wood);
    for (const y of [1.03, 3.1]) {
      box(hinge, [1.28, y === 1.03 ? 1.6 : 2.06, .025], [x, y, .086], gold);
      box(hinge, [1.23, y === 1.03 ? 1.55 : 2.01, .03], [x, y, .104], inset);
    }
    box(hinge, [.04, 4.55, .05], [-side * 1.54, 2.39, .12], gold);
    box(hinge, [.065, .46, .13], [-side * 1.37, 2.2, .18], gold);
    return hinge;
  });
  return {
    update(camera, seconds) {
      const pose = arrivalPose(seconds, camera.aspect < 1);
      leaves[0].rotation.y = pose.door; leaves[1].rotation.y = -pose.door;
      camera.position.set(0, 2.32, pose.z); camera.lookAt(pose.lookX, 2.32, pose.lookZ);
    },
    close() { for (const leaf of leaves) leaf.rotation.y = 0; },
    dispose() { root.removeFromParent(); },
  };
}

export function mountGalleryOpening({ gallery, wake = () => {}, onFinish = () => {}, doc = document, storage, reduced = matchMedia('(prefers-reduced-motion: reduce)') }) {
  const dialog = doc.querySelector('[data-gallery-opening]');
  if (!dialog) return null;
  const enter = dialog.querySelector('[data-opening-enter]'), skip = dialog.querySelector('[data-opening-skip]');
  const sound = dialog.querySelector('[data-opening-sound]'), status = dialog.querySelector('[data-opening-status]');
  const letter = dialog.querySelector('[data-opening-letter]'), title = dialog.querySelector('[data-opening-title]');
  let active = false, elapsed = 0, phase = 'waiting', ready = false, disposed = false, cancelSound;
  try { storage ??= sessionStorage; } catch {}
  let seen = false; try { seen = storage?.getItem(openingKey) === '1'; } catch {}
  dialog.removeAttribute('open');
  function soundLabel() { const enabled = Boolean(gallery.state().sound.enabled); sound.textContent = enabled ? '音：オン' : '音：オフ'; sound.setAttribute('aria-pressed', String(enabled)); }
  function finish(remember = true) {
    if (!active) return;
    active = false; phase = 'finished'; cancelSound?.(); cancelSound = null;
    if (remember) try { storage?.setItem(openingKey, '1'); } catch {}
    dialog.close(); doc.body.classList.remove('is-gallery-opening'); onFinish(); wake();
  }
  function begin() {
    if (!active || !ready || phase !== 'waiting') return;
    if (reduced.matches) { finish(); return; }
    phase = 'opening'; dialog.dataset.phase = phase;
    letter.setAttribute('aria-hidden', 'true'); letter.inert = true; title.hidden = false;
    enter.disabled = true; skip.focus({ preventScroll: true });
    cancelSound = gallery.play('gallery-door', { level: .45, rate: .8 }); wake();
  }
  enter.addEventListener('click', begin); skip.addEventListener('click', () => finish());
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
  sound.addEventListener('click', async () => { await gallery.toggleSound(); if (!disposed) soundLabel(); });
  function restart() {
    if (disposed) return false;
    cancelSound?.(); cancelSound = null;
    try { storage?.removeItem(openingKey); } catch {}
    active = true; elapsed = 0; phase = 'waiting'; ready = false;
    dialog.dataset.phase = phase; dialog.dataset.ready = 'false';
    dialog.style.setProperty('--opening-title-opacity', '0');
    letter.removeAttribute('aria-hidden'); letter.inert = false; title.hidden = true;
    enter.disabled = true; status.textContent = '展示を準備しています。';
    doc.body.classList.add('is-gallery-opening');
    if (!dialog.open) dialog.showModal();
    soundLabel(); skip.focus({ preventScroll: true }); wake();
    return true;
  }
  if (!seen) {
    active = true; doc.body.classList.add('is-gallery-opening'); dialog.showModal(); soundLabel();
    skip.focus({ preventScroll: true });
  }
  return {
    restart,
    get active() { return active; },
    get elapsed() { return elapsed; },
    setReady(value) {
      ready = Boolean(value); dialog.dataset.ready = String(ready); enter.disabled = !ready;
      status.textContent = ready ? '準備ができました。どうぞ、お入りください。' : '展示を読み込めませんでした。スキップして、展示室から読み込み直せます。';
      if (ready && active && phase === 'waiting' && doc.activeElement === skip) enter.focus({ preventScroll: true });
      wake();
    },
    advance(seconds) {
      if (!active || phase !== 'opening') return false;
      if (reduced.matches) { finish(); return false; }
      elapsed += Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, .05));
      dialog.style.setProperty('--opening-title-opacity', String(arrivalPose(elapsed).title));
      if (elapsed >= openingDuration) { finish(); return false; }
      return true;
    },
    snapshot: () => ({ active, ready, phase, elapsed }),
    fallback() { finish(false); },
    dispose() { if (disposed) return; disposed = true; finish(false); },
  };
}
