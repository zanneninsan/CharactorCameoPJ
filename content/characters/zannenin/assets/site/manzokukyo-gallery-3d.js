const stage = document.querySelector('.gallery-3d-stage');
const canvas = stage.querySelector('[data-gallery-3d-canvas]');
const viewport = canvas.parentElement;
const loading = stage.querySelector('.gallery-3d-loading');
const catalog = document.querySelector('.gallery-3d-catalog');
const listButton = stage.querySelector('[data-gallery-3d-list]');
const { records, assetVersionQuery } = JSON.parse(document.querySelector('[data-gallery-records]').textContent);
const gallery = await import(new URL(`manzokukyo-gallery.js?${assetVersionQuery}`, import.meta.url));
const { advanceWalk, walkKeys, walkRoom } = await import(new URL(`manzokukyo-gallery-walk.js?${assetVersionQuery}`, import.meta.url));
const { mountGalleryLoop, paintingAppearance, loopExit } = await import(new URL(`manzokukyo-gallery-loop.js?${assetVersionQuery}`, import.meta.url));
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let exhibition, loop, selected = 0;
function setCatalog(open) {
  catalog.hidden = !open; listButton.setAttribute('aria-expanded', String(open));
  listButton.textContent = open ? '一覧を閉じる' : '24枚の一覧';
}
function fallback() {
  loop?.fallback();
  document.body.classList.remove('has-gallery-3d'); document.body.classList.add('gallery-3d-fallback');
  loading.hidden = false; loading.textContent = '3D展示を開けませんでした。下の一覧から、すべての絵を鑑賞できます。';
  setCatalog(true);
  for (const name of ['prev', 'next', 'overview']) stage.querySelector(`[data-gallery-3d-${name}]`).disabled = true;
  for (const button of stage.querySelectorAll('[data-gallery-3d-room-jump]')) button.disabled = true;
  for (const button of stage.querySelectorAll('[data-gallery-3d-walk]')) button.disabled = true;
}
function updateSelection(index) {
  if (!Number.isInteger(index) || index < 0 || index >= records.length) return false;
  selected = index;
  stage.querySelector('[data-gallery-3d-inspect]').disabled = false;
  stage.querySelector('[data-gallery-3d-room]').textContent = `展示室 ${['I', 'II', 'III', 'IV'][Math.floor(index / 6)]} / IV`;
  stage.querySelector('[data-gallery-3d-record]').textContent = `記録 ${String(index + 1).padStart(2, '0')} / 24`;
  stage.querySelector('[data-gallery-3d-inspect]').textContent = `記録 ${String(index + 1).padStart(2, '0')} を大きく見る`;
  for (const button of stage.querySelectorAll('[data-gallery-3d-room-jump]')) button.setAttribute('aria-pressed', String(Number(button.getAttribute('data-gallery-3d-room-jump')) === Math.floor(index / 6)));
  for (const button of catalog.querySelectorAll('[data-gallery-index]')) button.classList.toggle('is-current', Number(button.dataset.galleryIndex) === index);
}
function inspect(index = selected) {
  if (!Number.isInteger(index) || index < 0 || index >= records.length) return false;
  if (loop?.active) return loop.inspect(index);
  exhibition?.stop();
  if (gallery.showRecord(index, stage.querySelector('[data-gallery-3d-inspect]'))) {
    updateSelection(index); return true;
  }
  return false;
}
stage.querySelector('[data-gallery-3d-prev]').addEventListener('click', () => { exhibition?.select((selected + 23) % 24); gallery.play('step-1', { level: .35 }); });
stage.querySelector('[data-gallery-3d-next]').addEventListener('click', () => { exhibition?.select((selected + 1) % 24); gallery.play('step-2', { level: .35 }); });
stage.querySelector('[data-gallery-3d-inspect]').addEventListener('click', () => inspect());
stage.querySelector('[data-gallery-3d-overview]').addEventListener('click', () => exhibition?.overview(exhibition.state().room - 1));
listButton.addEventListener('click', () => { setCatalog(catalog.hidden); if (!catalog.hidden) catalog.scrollIntoView({ behavior: motion.matches ? 'instant' : 'smooth', block: 'start' }); });
for (const button of stage.querySelectorAll('[data-gallery-3d-room-jump]')) button.addEventListener('click', () => { exhibition?.overview(Number(button.getAttribute('data-gallery-3d-room-jump'))); gallery.play('step-1', { level: .35 }); });
for (const button of catalog.querySelectorAll('[data-gallery-index]')) button.addEventListener('click', () => { const index = Number(button.dataset.galleryIndex); updateSelection(index); exhibition?.select(index); });
for (const button of document.querySelectorAll('[data-gallery-restart]')) button.addEventListener('click', () => {
  exhibition?.overview(0, true); canvas.scrollIntoView({ behavior: motion.matches ? 'instant' : 'smooth', block: 'center' }); canvas.focus({ preventScroll: true });
});
// Large viewing stays in the normal HTML image viewer, without perspective or cropping.
const lightbox = document.querySelector('[data-gallery-lightbox]');
const original = document.createElement('a'); original.className = 'gallery-original-link'; original.target = '_blank'; original.rel = 'noopener'; original.textContent = '画像だけを開く ↗';
lightbox.querySelector('.gallery-lightbox-actions').append(original);
const largeImage = lightbox.querySelector('[data-gallery-image]');
new MutationObserver(() => { original.href = largeImage.src; }).observe(largeImage, { attributes: true, attributeFilter: ['src'] });
updateSelection(0);

try {
  const THREE = await import(new URL('../../manzokukyo-preview/vendor/three.module.js', import.meta.url));
  exhibition = createExhibition(THREE);
  document.body.classList.add('has-gallery-3d'); setCatalog(false);
  loading.textContent = '絵を掛けています。';
  loop = mountGalleryLoop({ stage, canvas, records, assetVersionQuery, gallery, exhibition });
} catch { fallback(); }

function createExhibition(T) {
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const scene = new T.Scene(); scene.background = new T.Color(0x23232a); scene.fog = new T.Fog(0x3a3735, 22, 52);
  const camera = new T.PerspectiveCamera(49, 1, .1, 100);
  const geometry = new Set(), materials = new Set(), textures = new Set();
  const material = options => { const m = new T.MeshStandardMaterial(options); materials.add(m); return m; };
  const basic = options => { const m = new T.MeshBasicMaterial(options); materials.add(m); return m; };
  const cube = new T.BoxGeometry(1, 1, 1); geometry.add(cube);
  const plane = new T.PlaneGeometry(1, 1); geometry.add(plane);
  const stone = material({ color: 0xc7c2ad, roughness: .88 });
  const baseStone = material({ color: 0x3c4646, roughness: .72 });
  const cornice = material({ color: 0xe0d8bd, roughness: .7 });
  const gold = material({ color: 0xc8a65c, metalness: .72, roughness: .32 });
  const black = material({ color: 0x1d2224, roughness: .6 });
  const backing = basic({ color: 0xe8dfc7 });
  const warm = basic({ color: 0xfbe6b1 });
  const green = basic({ color: 0x94cbb8 });
  const rose = basic({ color: 0xd6a9a7 });
  function box(parent, size, at, m) { const mesh = new T.Mesh(cube, m); mesh.scale.set(...size); mesh.position.set(...at); parent.add(mesh); return mesh; }
  scene.add(new T.HemisphereLight(0xfff2d8, 0x4b595f, 2.1));
  const sun = new T.DirectionalLight(0xffe4b8, 2.3); sun.position.set(-4, 8, 5); scene.add(sun);
  const fill = new T.DirectionalLight(0x9cb4bf, 1.1); fill.position.set(5, 4, -12); scene.add(fill);
  const ambience = new T.PointLight(0xe7c78f, 35, 22, 2); ambience.position.set(0, 4.4, -5); scene.add(ambience);

  // Repeated architecture uses shared geometry; the rooms are deliberately well lit.
  box(scene, [11.4, .25, 69], [0, -.15, -30], baseStone);
  for (const [n, color] of [[0, 0xa2a499], [1, 0x888f8b]]) {
    const tiles = new T.InstancedMesh(cube, material({ color, roughness: .64, metalness: .15 }), 6 * 36 / 2);
    const matrix = new T.Object3D(); let i = 0;
    for (let x = 0; x < 6; x++) for (let z = 0; z < 36; z++) if ((x + z) % 2 === n) {
      matrix.position.set((x - 2.5) * 1.8, 0, 4 - z * 1.9); matrix.scale.set(1.78, .035, 1.88); matrix.updateMatrix(); tiles.setMatrixAt(i++, matrix.matrix);
    }
    scene.add(tiles);
  }
  for (const side of [-1, 1]) {
    box(scene, [.32, 6.4, 69], [side * 5.55, 3.15, -30], stone);
    box(scene, [.22, .85, 69], [side * 5.33, .43, -30], baseStone);
    box(scene, [.24, .065, 69], [side * 5.29, .9, -30], gold);
    box(scene, [.28, .13, 69], [side * 5.28, 5.15, -30], cornice);
    box(scene, [.32, .04, 69], [side * 5.25, 5.25, -30], gold);
    box(scene, [.16, .06, 69], [side * 5.2, 5.7, -30], warm);
    box(scene, [.025, .025, 69], [side * 3.75, .03, -30], gold);
  }
  box(scene, [11.4, .18, 69], [0, 6.45, -30], baseStone);
  box(scene, [2.4, .05, 69], [0, 6.33, -30], warm);
  // Walking lets visitors turn back toward the entrance as well.
  box(scene, [11.4, 6.4, .3], [0, 3.15, 4.5], stone);
  box(scene, [3.3, 4.8, .18], [0, 2.4, 4.2], gold);
  box(scene, [2.95, 4.55, .18], [0, 2.28, 4.07], baseStone);
  const curve = new T.CatmullRomCurve3([new T.Vector3(-4.95, 3.8, 0), new T.Vector3(-4.5, 4.8, 0), new T.Vector3(-2.8, 5.8, 0), new T.Vector3(0, 6.2, 0), new T.Vector3(2.8, 5.8, 0), new T.Vector3(4.5, 4.8, 0), new T.Vector3(4.95, 3.8, 0)]);
  const arch = new T.TubeGeometry(curve, 40, .12, 6, false); geometry.add(arch);
  for (let r = 0; r <= 4; r++) {
    const z = 1 - r * 16;
    const rim = new T.Mesh(arch, gold); rim.position.z = z; scene.add(rim);
    for (const side of [-1, 1]) {
      box(scene, [.3, 3.8, .5], [side * 4.96, 1.9, z], cornice);
      box(scene, [.1, 3.3, .06], [side * 4.78, 1.9, z + .29], gold);
      box(scene, [.62, .19, .7], [side * 4.96, .12, z], black);
    }
    const ringShape = new T.RingGeometry(1.12, 1.145, 64); geometry.add(ringShape);
    const ring = new T.Mesh(ringShape, gold); ring.rotation.x = -Math.PI / 2; ring.position.set(0, .038, z - 1.5); scene.add(ring);
  }
  // A red doorway anchors the far end, with the same heraldic silhouette as the other rooms.
  box(scene, [11.4, 6.4, .3], [0, 3.15, -64.5], stone);
  box(scene, [3.3, 4.8, .18], [0, 2.4, -64.2], gold);
  box(scene, [2.95, 4.55, .18], [0, 2.28, -64.07], material({ color: 0x642b3c, roughness: .62 }));
  box(scene, [.018, 4.45, .1], [0, 2.27, -63.96], warm);
  const frames = [], targets = [];
  const loader = new T.TextureLoader();
  const roomCache = [];
  const loaded = new Map(), failed = new Set(), pending = new Map();
  let activeRoom = 0, disposed = false, lost = false, inView = true, raf = 0, last = 0;
  let anomaly = null, textureGeneration = 0, preparationResolve;
  let selectedIndex = 0, mode = 'overview', moving = false, aimedIndex = null;
  let yaw = 0, pitch = 0, walked = 0;
  const heldKeys = new Set(), heldPointers = new Map();
  const sprintButton = stage.querySelector('[data-gallery-3d-sprint]');
  let sprintLatched = false;
  const walkButtons = [...stage.querySelectorAll('[data-gallery-3d-walk]')];
  const orientation = new T.Euler(0, 0, 0, 'YXZ');
  const forwardVector = new T.Vector3(), toFrame = new T.Vector3();
  const endPosition = new T.Vector3(), endQuaternion = new T.Quaternion(), lookCamera = new T.PerspectiveCamera();
  function labelTexture(text, detail = '') {
    const c = document.createElement('canvas'); c.width = 256; c.height = 96;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#e4dcc5'; ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#443c2b'; ctx.textAlign = 'center'; ctx.font = '24px Georgia'; ctx.fillText(text, 128, 40);
    ctx.font = '12px sans-serif'; ctx.fillText(detail, 128, 69);
    const texture = new T.CanvasTexture(c); texture.colorSpace = T.SRGBColorSpace; textures.add(texture); return texture;
  }
  for (let index = 0; index < 24; index++) {
    const roomIndex = Math.floor(index / 6), local = index % 6, side = local % 2 === 0 ? -1 : 1, z = -3 - Math.floor(local / 2) * 4.5 - roomIndex * 16;
    const group = new T.Group(); group.position.set(side * 5.13, 2.82, z); group.rotation.y = -side * Math.PI / 2; scene.add(group);
    const width = 2.12, height = width * 1080 / 768;
    box(group, [width + .5, height + .5, .09], [0, 0, -.07], black);
    box(group, [width + .36, height + .36, .1], [0, 0, 0], gold);
    box(group, [width + .2, height + .2, .08], [0, 0, .065], backing);
    const surface = basic({ color: 0xffffff, toneMapped: false, fog: true });
    const inversion = { value: 0 };
    surface.onBeforeCompile = shader => {
      shader.uniforms.galleryNegative = inversion;
      shader.fragmentShader = 'uniform float galleryNegative;\n' + shader.fragmentShader.replace('#include <colorspace_fragment>', '#include <colorspace_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0) - gl_FragColor.rgb, galleryNegative);');
    };
    surface.customProgramCacheKey = () => 'gallery-negative-v1';
    const painting = new T.Mesh(plane, surface); painting.scale.set(width, height, 1); painting.position.z = .118; painting.userData.index = index; group.add(painting); targets.push(painting);
    const plaque = new T.Mesh(plane, basic({ map: labelTexture(`ARCHIVE ${records[index].id}`, records[index].seal ? 'SEALED RECORD' : 'UNFILED IMAGE'), toneMapped: false }));
    plaque.scale.set(1.22, .46, 1); plaque.position.set(0, -height / 2 - .64, .11); group.add(plaque);
    box(group, [.6, .04, .23], [0, height / 2 + .34, .15], gold);
    box(group, [.52, .025, .17], [0, height / 2 + .31, .17], warm);
    let seal;
    if (records[index].seal) {
      const shape = new T.TorusGeometry(.125, .025, 6, 28); geometry.add(shape);
      seal = new T.Mesh(shape, gold); seal.position.set(width / 2 + .12, height / 2 + .12, .17); group.add(seal);
    }
    frames.push({ group, painting, surface, inversion, index, roomIndex, side, z, width, height, seal });
  }
  let portalTexture = labelTexture('GALLERY', 'THE SAME CORRIDOR');
  const portalLabels = [4.03, -63.93].map((z, index) => {
    const sign = new T.Mesh(plane, basic({ map: portalTexture, toneMapped: false }));
    sign.scale.set(2.3, .86, 1); sign.position.set(0, 5.3, z); sign.rotation.y = index === 0 ? Math.PI : 0; scene.add(sign); return sign;
  });
  const skyPanels = [green, rose, warm, green];
  for (let r = 0; r < 4; r++) for (const side of [-1, 1]) box(scene, [.045, 1.6, .15], [side * 5.18, 3.4, -15 - r * 16], skyPanels[r]);

  function loadRoom(r, preload = false) {
    if (!preload) activeRoom = r;
    const previous = roomCache.indexOf(r); if (previous !== -1) roomCache.splice(previous, 1); roomCache.push(r);
    while (roomCache.length > 2) roomCache.splice(roomCache.findIndex(room => room !== activeRoom), 1);
    for (const [index, texture] of loaded) if (!roomCache.includes(frames[index].roomIndex)) { frames[index].surface.map = null; frames[index].surface.fog = true; frames[index].surface.needsUpdate = true; texture.dispose(); textures.delete(texture); loaded.delete(index); }
    for (const frame of frames.filter(frame => frame.roomIndex === r)) {
      if (loaded.has(frame.index) || pending.has(frame.index)) continue;
      const generation = textureGeneration;
      const appearance = paintingAppearance(frame.index, anomaly);
      const url = new URL(`../../../assets/generated/manzokukyo/gallery/gallery-${records[appearance.imageIndex].id}.webp?${assetVersionQuery}`, document.baseURI).href;
      pending.set(frame.index, generation);
      loader.load(url, texture => {
        if (generation !== textureGeneration) { texture.dispose(); return; }
        pending.delete(frame.index);
        if (disposed || !roomCache.includes(frame.roomIndex)) { texture.dispose(); return; }
        texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        // Fit the original aspect ratio inside its matte; never crop a texture.
        const aspect = texture.image.width / texture.image.height;
        const w = Math.min(frame.width, frame.height * aspect), h = w / aspect;
        frame.painting.scale.set(w, h, 1); frame.surface.map = texture; frame.surface.fog = false; frame.surface.needsUpdate = true;
        textures.add(texture); loaded.set(frame.index, texture); failed.delete(frame.index); refreshLoading(); wake();
      }, undefined, () => { if (generation !== textureGeneration || disposed) return; pending.delete(frame.index); failed.add(frame.index); refreshLoading(); });
    }
    ambience.position.z = -6 - activeRoom * 16; refreshLoading();
  }
  function refreshLoading() {
    const roomFrames = frames.filter(frame => frame.roomIndex === activeRoom);
    const count = roomFrames.filter(frame => loaded.has(frame.index)).length;
    loading.hidden = count === 6;
    loading.textContent = roomFrames.some(frame => failed.has(frame.index)) ? '読み込めない絵があります。「大きく見る」または一覧から開けます。' : `展示室の絵を掛けています。${count} / 6`;
    if (preparationResolve && (frames.slice(0, 6).every(frame => loaded.has(frame.index)) || frames.slice(0, 6).some(frame => failed.has(frame.index)))) {
      const resolve = preparationResolve; preparationResolve = null; resolve(!frames.slice(0, 6).some(frame => failed.has(frame.index)));
    }
  }
  function prepareLoop(nextAnomaly, round) {
    stopWalk(); moving = false; anomaly = nextAnomaly; textureGeneration++;
    preparationResolve?.(false); preparationResolve = null;
    for (const texture of loaded.values()) { texture.dispose(); textures.delete(texture); }
    loaded.clear(); failed.clear(); pending.clear(); roomCache.length = 0;
    for (const frame of frames) {
      const appearance = paintingAppearance(frame.index, anomaly);
      frame.painting.rotation.z = appearance.upsideDown ? Math.PI : 0;
      frame.inversion.value = appearance.negative ? 1 : 0;
      frame.surface.map = null; frame.surface.fog = true; frame.surface.needsUpdate = true;
      if (frame.seal) frame.seal.visible = true;
    }
    portalTexture.dispose(); textures.delete(portalTexture);
    portalTexture = labelTexture(loop?.active ? `ROUND ${String(round).padStart(2, '0')}` : 'GALLERY', 'THE SAME CORRIDOR');
    for (const sign of portalLabels) { sign.material.map = portalTexture; sign.material.needsUpdate = true; }
    const ready = new Promise(resolve => { preparationResolve = resolve; });
    overview(0, true, true); camera.position.z = .8; endPosition.copy(camera.position); wake();
    if (disposed || lost) { preparationResolve?.(false); preparationResolve = null; }
    return ready;
  }
  function destination(position, target, immediate = false) {
    endPosition.copy(position); lookCamera.position.copy(position); lookCamera.lookAt(target); endQuaternion.copy(lookCamera.quaternion);
    if (motion.matches || immediate) { camera.position.copy(endPosition); camera.quaternion.copy(endQuaternion); moving = false; }
    else moving = true;
    wake();
  }
  function select(index, immediate = false) {
    if (loop?.active || loop?.busy) return false;
    if (!Number.isInteger(index) || index < 0 || index >= records.length) return false;
    stopWalk();
    aimedIndex = null; viewport.classList.remove('is-aiming');
    selectedIndex = index; mode = 'artwork'; updateSelection(index);
    const frame = frames[index]; loadRoom(frame.roomIndex);
    const vertical = frame.height / (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)));
    const horizontal = frame.width / (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    const distance = Math.max(vertical, horizontal) * 1.26;
    destination(new T.Vector3(frame.side * (5.13 - Math.min(distance, 9.1)), 2.82, frame.z), new T.Vector3(frame.side * 5.13, 2.82, frame.z), immediate);
  }
  function overview(r, immediate = false, internal = false) {
    if (!internal && (loop?.active || loop?.busy)) return false;
    if (!Number.isInteger(r) || r < 0 || r >= 4) return false;
    stopWalk();
    aimedIndex = null; viewport.classList.remove('is-aiming');
    mode = 'overview'; selectedIndex = r * 6; updateSelection(selectedIndex); loadRoom(r);
    destination(new T.Vector3(0, 2.32, 2 - r * 16), new T.Vector3(0, 2.6, -10 - r * 16), immediate);
  }
  function stopWalk() {
    heldKeys.clear(); heldPointers.clear(); walked = 0; down = null;
    sprintLatched = false; sprintButton.setAttribute('aria-pressed', 'false');
    sprintButton.textContent = 'ダッシュ OFF';
    for (const button of walkButtons) button.classList.remove('is-held');
  }
  function canWalk() { return !disposed && !lost && !loop?.busy && !document.hidden && inView && !document.querySelector('dialog[open]'); }
  function startWalk() {
    if (!canWalk()) return false;
    if (mode !== 'walking') {
      orientation.setFromQuaternion(camera.quaternion, 'YXZ'); yaw = orientation.y; pitch = orientation.x;
      mode = 'walking'; moving = false;
    }
    return true;
  }
  function walkActions() { return new Set([...heldKeys].map(key => walkKeys[key]).concat([...heldPointers.values()], sprintLatched ? ['sprint'] : [])); }
  sprintButton.addEventListener('click', () => {
    if (!startWalk()) return;
    sprintLatched = !sprintLatched;
    sprintButton.setAttribute('aria-pressed', String(sprintLatched));
    sprintButton.textContent = sprintLatched ? 'ダッシュ ON' : 'ダッシュ OFF';
    canvas.focus({ preventScroll: true }); wake();
  });
  function syncWalkingSelection(direction = Math.cos(yaw) >= 0 ? 1 : -1) {
    const r = walkRoom(camera.position.z);
    if (r !== activeRoom) loadRoom(r);
    // Prefetch the next room near an arch, while retaining the current room.
    const neighbor = r + direction;
    const boundary = direction === 1 ? 2 - (r + 1) * 16 : 2 - r * 16;
    if (neighbor >= 0 && neighbor < 4 && Math.abs(camera.position.z - boundary) < 6 && !roomCache.includes(neighbor)) loadRoom(neighbor, true);
    camera.getWorldDirection(forwardVector);
    let best = .94; aimedIndex = null;
    for (const frame of frames) {
      toFrame.copy(frame.group.position).sub(camera.position);
      const distance = toFrame.length();
      const alignment = toFrame.normalize().dot(forwardVector);
      if (distance < 10 && alignment > best) { best = alignment; aimedIndex = frame.index; }
    }
    if (aimedIndex !== null) {
      selectedIndex = aimedIndex;
      if (selected !== aimedIndex || stage.querySelector('[data-gallery-3d-inspect]').disabled) updateSelection(aimedIndex);
    } else {
      stage.querySelector('[data-gallery-3d-record]').textContent = '歩いて探索中';
      stage.querySelector('[data-gallery-3d-inspect]').textContent = '気になる絵の方を向く';
      stage.querySelector('[data-gallery-3d-inspect]').disabled = true;
    }
    stage.querySelector('[data-gallery-3d-room]').textContent = `展示室 ${['I', 'II', 'III', 'IV'][r]} / IV`;
    for (const button of stage.querySelectorAll('[data-gallery-3d-room-jump]')) button.setAttribute('aria-pressed', String(Number(button.getAttribute('data-gallery-3d-room-jump')) === r));
    viewport.classList.toggle('is-aiming', aimedIndex !== null);
  }
  function applyWalk(dt, actions = walkActions()) {
    const next = advanceWalk(camera.position, yaw, actions, dt);
    const direction = next.z < camera.position.z ? 1 : next.z > camera.position.z ? -1 : undefined;
    camera.position.x = next.x; camera.position.z = next.z; yaw = next.yaw;
    camera.quaternion.setFromEuler(orientation.set(pitch, yaw, 0, 'YXZ'));
    endPosition.copy(camera.position); endQuaternion.copy(camera.quaternion);
    walked += next.distance;
    if (walked >= 1.75) { gallery.play('step-1', { level: actions.has('sprint') ? .25 : .18 }); walked %= 1.75; }
    const exit = loopExit(camera.position);
    if (loop?.active && exit) { void loop.cross(exit); return; }
    syncWalkingSelection(direction); wake();
  }
  function syncSeals() {
    for (const frame of frames) if (frame.seal) { frame.seal.material = document.querySelector(`[data-gallery-index="${frame.index}"]`).classList.contains('is-collected') ? green : gold; }
    wake();
  }
  const sealObserver = new MutationObserver(syncSeals); sealObserver.observe(catalog, { subtree: true, attributes: true, attributeFilter: ['class'] });
  const modalObserver = new MutationObserver(() => { if (document.querySelector('dialog[open]')) stopWalk(); last = 0; wake(); });
  for (const dialog of document.querySelectorAll('dialog')) modalObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  function animate(time) {
    raf = 0;
    if (disposed || lost || document.hidden || !inView) { last = 0; return; }
    const paused = document.querySelector('dialog[open]') || loop?.busy;
    const dt = last ? Math.min((time - last) / 1000, .05) : 0; last = time;
    const walking = mode === 'walking' && (heldKeys.size || heldPointers.size) && !paused;
    if (walking) applyWalk(dt);
    if (moving && !paused) {
      const ease = 1 - Math.exp(-dt * 5.4);
      camera.position.lerp(endPosition, ease); camera.quaternion.slerp(endQuaternion, ease);
      if (camera.position.distanceTo(endPosition) < .008 && camera.quaternion.angleTo(endQuaternion) < .002) { camera.position.copy(endPosition); camera.quaternion.copy(endQuaternion); moving = false; }
    }
    renderer.render(scene, camera);
    if ((moving || walking) && !paused && !raf) raf = requestAnimationFrame(animate);
  }
  function wake() { if (!raf && !disposed && !lost) raf = requestAnimationFrame(animate); }
  function resize() {
    const { width, height } = viewport.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    if (mode === 'artwork') select(selectedIndex, true); else wake();
  }
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(viewport);
  const intersection = new IntersectionObserver(entries => { inView = entries[0].isIntersecting; last = 0; if (inView) wake(); else stopWalk(); }, { rootMargin: '80px' }); intersection.observe(canvas);
  const raycaster = new T.Raycaster(), pointer = new T.Vector2();
  let down;
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !canWalk() || down) return;
    canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId);
    down = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, dragged: false };
  });
  canvas.addEventListener('pointermove', event => {
    if (!down || down.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 7) down.dragged = true;
    if (down.dragged && startWalk()) {
      yaw -= (event.clientX - down.lastX) * .004;
      pitch = Math.max(-.65, Math.min(.65, pitch - (event.clientY - down.lastY) * .003));
      applyWalk(0);
    }
    down.lastX = event.clientX; down.lastY = event.clientY;
  });
  canvas.addEventListener('pointerup', event => {
    if (!down || down.id !== event.pointerId) return;
    const dragged = down.dragged; down = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (dragged || !canWalk()) return;
    const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(targets)[0];
    if (hit) inspect(hit.object.userData.index);
  });
  canvas.addEventListener('pointercancel', () => { down = null; });
  canvas.addEventListener('lostpointercapture', () => { down = null; });
  stage.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.target.closest('input,textarea,select,[contenteditable]')) return;
    if (!walkKeys[event.code] || !startWalk()) return;
    event.preventDefault();
    if (!heldKeys.has(event.code)) { heldKeys.add(event.code); applyWalk(.035); }
  });
  window.addEventListener('keyup', event => { heldKeys.delete(event.code); });
  stage.addEventListener('focusout', event => { if (!stage.contains(event.relatedTarget)) stopWalk(); });
  for (const button of walkButtons) {
    const action = button.getAttribute('data-gallery-3d-walk');
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !startWalk()) return;
      event.preventDefault(); canvas.focus({ preventScroll: true }); button.setPointerCapture(event.pointerId);
      heldPointers.set(event.pointerId, action); button.classList.add('is-held'); applyWalk(.035);
    });
    const release = event => { heldPointers.delete(event.pointerId); button.classList.remove('is-held'); };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, release);
    button.addEventListener('click', event => { if (event.detail === 0 && startWalk()) applyWalk(.05, new Set([action, ...(sprintLatched ? ['sprint'] : [])])); });
  }
  canvas.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || !canWalk()) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); select((selected + (event.key === 'ArrowRight' ? 1 : 23)) % 24); }
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); if (mode !== 'walking' || aimedIndex !== null) inspect(); }
    if (event.key === 'Escape') stopWalk();
  });
  window.addEventListener('blur', stopWalk);
  const visibility = () => { stopWalk(); last = 0; if (!document.hidden) wake(); };
  document.addEventListener('visibilitychange', visibility);
  motion.addEventListener('change', () => { if (motion.matches) { camera.position.copy(endPosition); camera.quaternion.copy(endQuaternion); moving = false; wake(); } });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); stopWalk(); lost = true; preparationResolve?.(false); preparationResolve = null; cancelAnimationFrame(raf); fallback(); });
  // Keep the accessible catalog after a graphics reset. Reloading just the
  // hosted iframe would leave the parent's old sound subscriptions attached.
  window.addEventListener('pagehide', event => {
    stopWalk();
    cancelAnimationFrame(raf); raf = 0; last = 0;
    if (event.persisted) return;
    preparationResolve?.(false); preparationResolve = null;
    disposed = true; resizeObserver.disconnect(); intersection.disconnect(); sealObserver.disconnect(); modalObserver.disconnect();
    for (const item of textures) item.dispose(); for (const item of materials) item.dispose(); for (const item of geometry) item.dispose(); renderer.dispose();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { resize(); wake(); } });
  resize(); overview(0, true); syncSeals();
  return { select, overview, prepareLoop, hasImageErrors: () => failed.size > 0 || pending.size > 0, stop: stopWalk,
    state: () => ({ ready: !disposed && !lost, loop: loop?.snapshot(), selectedRecord: selectedIndex + 1, room: activeRoom + 1, mode, moving, walking: heldKeys.size > 0 || heldPointers.size > 0, position: camera.position.toArray(), yaw: orientation.setFromQuaternion(camera.quaternion, 'YXZ').y, aimedRecord: aimedIndex === null ? null : aimedIndex + 1, loadedRecords: [...loaded.keys()].map(n => n + 1).sort((a, b) => a - b), failedRecords: [...failed].map(n => n + 1), imageFit: 'contain', textureColorSpace: 'srgb', cameraAspect: camera.aspect }) };
}

const register = tool => { try { (window.ManzokukyoRoom?.registerTool ? window.ManzokukyoRoom.registerTool(tool) : document.modelContext?.registerTool(tool)); } catch {} };
register({ name: 'read_gallery_3d_state', description: 'Read the walking 3D gallery camera and image loading status without moving or changing progress.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => exhibition?.state() || { ready: false, fallback: true } });
register({ name: 'view_gallery_3d_artwork', description: 'Move to the front of one of the 24 paintings using the normal gallery camera. Does not collect a seal.', inputSchema: { type: 'object', properties: { number: { type: 'integer', minimum: 1, maximum: 24 } }, required: ['number'], additionalProperties: false }, execute: ({ number }) => { if (!Number.isInteger(number) || number < 1 || number > 24 || !exhibition) throw Error('Choose a displayed record from 1 to 24'); exhibition.select(number - 1); return exhibition.state(); } });
register({ name: 'view_gallery_3d_room', description: 'View one of the four exhibition rooms using its visible room selector. Does not change collected seals or sound.', inputSchema: { type: 'object', properties: { number: { type: 'integer', minimum: 1, maximum: 4 } }, required: ['number'], additionalProperties: false }, execute: ({ number }) => { if (!Number.isInteger(number) || number < 1 || number > 4 || !exhibition) throw Error('Choose room 1 to 4'); exhibition.overview(number - 1); return exhibition.state(); } });
