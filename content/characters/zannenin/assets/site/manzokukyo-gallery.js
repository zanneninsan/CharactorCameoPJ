const page = document.querySelector('[data-gallery-experience]');
const { records, assetVersionQuery } = JSON.parse(document.querySelector('[data-gallery-records]').textContent);
const room = window.ManzokukyoRoom;
const previewRoot = new URL('../../manzokukyo-preview/', import.meta.url);
const { createSound } = await import(new URL(`audio.js?${assetVersionQuery}`, previewRoot).href);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const seals = records.filter(record => record.seal).sort((a, b) => a.seal.order - b.seal.order);
const storageKey = 'manzokukyo-gallery-seals-v2', clearedKey = 'manzokukyo-gallery-cleared-v2';
const readSaved = key => { try { return sessionStorage.getItem(key); } catch { return null; } };
const save = (key, value) => { try { sessionStorage.setItem(key, value); } catch {} };
let saved = [];
try { const value = JSON.parse(readSaved(storageKey) || '[]'); if (Array.isArray(value)) saved = value; } catch {}
const found = new Set(saved.filter(number => seals.some(record => record.number === number)));
const viewed = new Set();
let cleared = readSaved(clearedKey) === '1', current = 0, phase = 'idle', opener, ceremonyKind, timeline, frameId, lastTime = 0;
const playing = new Set();
const dialog = document.querySelector('[data-gallery-lightbox]');
const aside = dialog.querySelector('.gallery-lightbox-aside');
const collect = dialog.querySelector('[data-gallery-collect]');
const note = dialog.querySelector('[data-gallery-note]');
note.setAttribute('role', 'status');
dialog.querySelector('[data-gallery-title]').id = 'gallery-record-title';
dialog.setAttribute('aria-labelledby', 'gallery-record-title');
const form = document.querySelector('[data-gallery-puzzle]');
const answer = form.querySelector('input'), submit = form.querySelector('button');
answer.maxLength = 32;
const message = document.querySelector('[data-gallery-message]');
const exit = document.querySelector('[data-gallery-exit]');
const exitHref = exit.href;
const solved = 'あかいとびら';

const imprint = document.createElement('div');
imprint.className = 'gallery-imprint'; imprint.dataset.stage = 'idle'; imprint.setAttribute('aria-hidden', 'true');
imprint.innerHTML = '<span class="gallery-imprint-ring"></span><strong data-imprint-fragment>⊹</strong><small data-imprint-status>UNFILED SEAL</small>';
aside.insertBefore(imprint, note);

const ledger = document.createElement('aside'); ledger.className = 'gallery-ledger'; ledger.setAttribute('aria-label', '検印帳');
ledger.innerHTML = '<button type="button" data-ledger-toggle aria-expanded="false" aria-controls="gallery-ledger-panel">⊹ 検印帳 <strong data-ledger-count>00 / 06</strong></button><div class="gallery-ledger-panel" id="gallery-ledger-panel" hidden><p>拾い集めた、六つの断片。</p><div class="gallery-ledger-slots"></div><button type="button" data-ledger-puzzle>印を並べる場所へ ↓</button></div>';
document.body.append(ledger);
for (const record of seals) {
  const slot = document.createElement('span'); slot.className = 'gallery-ledger-slot'; slot.dataset.record = record.number;
  slot.innerHTML = `<small class="slot-number">${String(record.seal.order).padStart(2, '0')}</small><strong>—</strong>`;
  ledger.querySelector('.gallery-ledger-slots').append(slot);
}
const wordTray = document.createElement('div'); wordTray.className = 'gallery-word-tray'; wordTray.setAttribute('aria-label', '集めた文字を順に選ぶ');
for (const record of seals) {
  const button = document.createElement('button'); button.type = 'button'; button.dataset.wordFragment = record.seal.fragment;
  button.textContent = '—'; button.disabled = true; wordTray.append(button);
}
const undo = document.createElement('button'); undo.type = 'button'; undo.dataset.wordUndo = ''; undo.textContent = '一文字戻す'; wordTray.append(undo);
answer.after(wordTray);
const wordHint = document.createElement('small'); wordHint.className = 'gallery-word-hint'; wordHint.textContent = '文字を順にタップ。直接入力もできます。'; wordTray.after(wordHint);
message.setAttribute('role', 'status');

const ceremony = document.createElement('dialog'); ceremony.className = 'gallery-ceremony'; ceremony.setAttribute('aria-labelledby', 'gallery-ceremony-title');
ceremony.innerHTML = '<div class="gallery-ceremony-stage" data-phase="gather"><div class="gallery-ceremony-door" aria-hidden="true"><span></span><span></span></div><div class="gallery-sigil" aria-hidden="true"><svg class="gallery-sigil-lines" viewBox="0 0 400 400"><circle cx="200" cy="200" r="148" fill="none"/><circle cx="200" cy="200" r="131" fill="none"/><path d="M200 52L328 126L328 274L200 348L72 274L72 126Z M200 52L328 274L72 274Z M200 348L72 126L328 126Z" fill="none"/></svg><div class="gallery-ceremony-core"><small>SEALED RECORDS</small><strong>六</strong></div></div><div class="gallery-ceremony-copy"><small data-ceremony-eyebrow>SIX FRAGMENTS</small><h2 id="gallery-ceremony-title">六つの検印が、揃った。</h2><p data-ceremony-message></p></div><button type="button" data-ceremony-continue>印を並べに行く</button><button type="button" data-ceremony-skip>演出をスキップ</button></div>';
document.body.append(ceremony);
for (let index = 0; index < 6; index++) {
  const token = document.createElement('span'); token.className = 'gallery-orbit-seal'; token.style.setProperty('--i', index); token.style.setProperty('--angle', `${index * 60 - 90}deg`); token.innerHTML = '<strong></strong>';
  ceremony.querySelector('.gallery-sigil').append(token);
}
const stage = ceremony.querySelector('.gallery-ceremony-stage');
const continueButton = ceremony.querySelector('[data-ceremony-continue]');
const skipButton = ceremony.querySelector('[data-ceremony-skip]');

for (const host of [form, ledger.querySelector('.gallery-ledger-panel')]) {
  const restart = document.createElement('button'); restart.type = 'button'; restart.className = 'gallery-restart'; restart.dataset.galleryRestart = '';
  restart.textContent = '↺ もう一度遊ぶ'; restart.title = 'この画廊の検印と解錠状態をリセットして、最初から遊ぶ';
  restart.addEventListener('click', resetGallery); host.append(restart);
}

const audioPanel = document.createElement('aside'); audioPanel.className = 'gallery-sound'; audioPanel.setAttribute('aria-label', '画廊の音');
audioPanel.innerHTML = '<p data-gallery-sound-invite>紙の擦れ、印の響き。音も一緒に楽しみますか？</p><button type="button" data-gallery-sound-toggle aria-pressed="false">SOUND OFF</button><button type="button" data-gallery-silent>音なしで進む</button><details><summary>音量</summary><label>BGM <input data-gallery-music type="range" min="0" max="100" value="28" aria-label="BGMの音量"></label><label>効果音 <input data-gallery-effects type="range" min="0" max="100" value="65" aria-label="効果音の音量"></label></details><p data-gallery-sound-status role="status"></p>';
document.body.append(audioPanel);
const audio = document.createElement('audio'); audio.loop = true; audio.preload = 'none';
for (const [file, type] of [['truth-chamber-bgm.flac', 'audio/flac'], ['truth-chamber-bgm.mp3', 'audio/mpeg']]) {
  const source = document.createElement('source'); source.src = new URL(`music/${file}`, previewRoot).href; source.type = type; audio.append(source);
}
document.body.append(audio);
let consent = Boolean(room?.state().consentGiven);
function updateSound(state) {
  consent ||= Boolean(state.consentGiven);
  audioPanel.querySelector('[data-gallery-sound-toggle]').textContent = state.enabled ? 'SOUND ON' : 'SOUND OFF';
  audioPanel.querySelector('[data-gallery-sound-toggle]').setAttribute('aria-pressed', String(state.enabled));
  if (Number.isFinite(state.musicVolume)) audioPanel.querySelector('[data-gallery-music]').value = Math.round(state.musicVolume * 100);
  if (Number.isFinite(state.effectsVolume)) audioPanel.querySelector('[data-gallery-effects]').value = Math.round(state.effectsVolume * 100);
  audioPanel.querySelector('[data-gallery-sound-invite]').hidden = consent;
  audioPanel.querySelector('[data-gallery-silent]').hidden = consent;
}
const sound = createSound(audio, { soundPath: new URL('sounds/', previewRoot).href, extraSounds: ['gallery-reveal', 'gallery-collect', 'gallery-complete', 'gallery-unseal', 'gallery-door'], onChange: updateSound, onError(text) { audioPanel.querySelector('[data-gallery-sound-status]').textContent = text; } });
updateSound(sound.state());
function play(name, options = {}) { const cancel = sound.play(name, options); if (cancel) playing.add(cancel); }
function stopSounds() { for (const cancel of playing) cancel(); playing.clear(); }
audioPanel.querySelector('[data-gallery-sound-toggle]').addEventListener('click', () => { consent = true; if (sound.enabled) sound.mute(); else void sound.enable(); updateSound(sound.state()); });
audioPanel.querySelector('[data-gallery-silent]').addEventListener('click', () => { consent = true; sound.mute(); updateSound(sound.state()); });
audioPanel.querySelector('[data-gallery-music]').addEventListener('input', event => sound.setMusicVolume(Number(event.target.value) / 100));
audioPanel.querySelector('[data-gallery-effects]').addEventListener('input', event => sound.setEffectsVolume(Number(event.target.value) / 100));
audioPanel.querySelector('[data-gallery-effects]').addEventListener('change', () => play('tap'));

function stopTimeline() { cancelAnimationFrame(frameId); timeline = null; lastTime = 0; }
function syncModalLock() {
  const open = dialog.open || ceremony.open;
  document.documentElement.classList.toggle('gallery-modal-open', open);
  document.body.classList.toggle('gallery-modal-open', open);
}
function tick(now) {
  if (!timeline) return;
  const active = timeline;
  if (!document.hidden && lastTime) active.elapsed += Math.min(80, now - lastTime);
  lastTime = document.hidden ? 0 : now;
  active.update?.(active.elapsed);
  if (timeline !== active) return;
  if (active.elapsed >= active.duration) { stopTimeline(); active.finish(); }
  else frameId = requestAnimationFrame(tick);
}
function animate(duration, update, finish) { stopTimeline(); timeline = { elapsed: 0, duration, update, finish }; frameId = requestAnimationFrame(tick); }
function setLedger(open) { ledger.querySelector('.gallery-ledger-panel').hidden = !open; ledger.querySelector('[data-ledger-toggle]').setAttribute('aria-expanded', String(open)); }
function scrollToArea(target) {
  setLedger(false);
  target.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'center' });
  target.focus({ preventScroll: true });
}
function renderPuzzle() {
  const complete = found.size === 6;
  for (const button of document.querySelectorAll('[data-gallery-restart]')) button.disabled = found.size === 0 && !cleared;
  page.classList.toggle('is-cleared', cleared);
  ledger.querySelector('[data-ledger-count]').textContent = `${String(found.size).padStart(2, '0')} / 06`;
  for (const record of seals) {
    const collected = found.has(record.number);
    const slot = document.querySelector(`[data-seal-slot="${record.seal.order}"]`);
    slot.textContent = cleared ? solved[record.seal.order - 1] : collected ? record.seal.fragment : '—';
    slot.classList.toggle('is-found', collected); slot.classList.toggle('is-solved', cleared);
    const smallSlot = ledger.querySelector(`[data-record="${record.number}"]`);
    smallSlot.classList.toggle('is-found', collected); smallSlot.querySelector('strong').textContent = collected ? record.seal.fragment : '—';
    const frame = document.querySelector(`[data-gallery-index="${record.number - 1}"]`);
    frame.classList.toggle('is-collected', collected);
    frame.querySelector('.gallery-seal').textContent = collected ? record.seal.fragment : '⊹';
    frame.setAttribute('aria-label', `記録 ${record.id} を拡大表示${collected ? '、検印は回収済み' : '、金色の検印あり'}`);
    const tile = wordTray.querySelector(`[data-word-fragment="${record.seal.fragment}"]`);
    tile.textContent = collected ? record.seal.fragment : '—';
    tile.disabled = !complete || cleared; tile.setAttribute('aria-label', collected ? `文字「${record.seal.fragment}」を加える` : '未回収の文字');
  }
  answer.disabled = !complete || cleared; submit.disabled = !complete || cleared; undo.disabled = !complete || cleared;
  message.textContent = cleared ? '六つの留め具が外れた。赤い扉が、あなたを待っている。' : complete ? '六つの文字が揃った。順に選んで、扉を呼ぶ言葉を。' : `検印を探してください。${found.size} / 6`;
  message.classList.remove('is-error');
  exit.setAttribute('aria-disabled', String(!cleared)); exit.tabIndex = cleared ? 0 : -1;
  if (cleared) exit.href = exitHref; else exit.removeAttribute('href');
  exit.textContent = cleared ? '赤い懺悔室へ進む →' : '検印を照合すると扉が開く';
}
function resetGallery() {
  stopTimeline(); stopSounds();
  dialog.close(); ceremony.close(); syncModalLock();
  found.clear(); viewed.clear(); cleared = false; current = 0; phase = 'idle'; ceremonyKind = undefined; opener = null;
  save(storageKey, '[]'); save(clearedKey, '0'); answer.value = '';
  page.classList.remove('is-door-opening', 'is-gallery-denied');
  for (const frame of document.querySelectorAll('[data-gallery-index]')) frame.classList.remove('is-viewed');
  imprint.dataset.stage = 'idle'; collect.disabled = false; stage.dataset.phase = 'gather';
  renderPuzzle(); message.textContent = '画廊の記録を白紙に戻しました。もう一度、六つの検印を探そう。';
  play('gallery-reveal', { level: .45 });
  scrollToArea(document.querySelector('[data-gallery-index="0"]'));
}
function showRecord(index, openingButton) {
  if (phase !== 'idle' || ceremony.open) return false;
  current = (index + records.length) % records.length;
  const record = records[current]; viewed.add(record.number);
  document.querySelector(`[data-gallery-index="${current}"]`).classList.add('is-viewed');
  const base = `../../../assets/generated/manzokukyo/gallery/gallery-${record.id}`;
  dialog.querySelector('[data-gallery-avif]').srcset = `${base}.avif?${assetVersionQuery}`;
  dialog.querySelector('[data-gallery-image]').src = `${base}.webp?${assetVersionQuery}`;
  dialog.querySelector('[data-gallery-image]').alt = `記録 ${record.id}`;
  dialog.querySelector('[data-gallery-title]').textContent = `ARCHIVE ${record.id}`;
  dialog.querySelector('[data-gallery-shelf]').textContent = record.shelf;
  const collected = found.has(record.number);
  imprint.hidden = !record.seal; imprint.dataset.stage = collected ? 'collected' : 'idle';
  imprint.querySelector('strong').textContent = collected ? record.seal.fragment : '⊹';
  imprint.querySelector('small').textContent = collected ? 'FILED / 照合済' : 'UNFILED / 未照合';
  collect.hidden = !record.seal || collected; collect.disabled = false;
  note.textContent = record.seal ? collected ? `文字「${record.seal.fragment}」は検印帳に記録されています。` : '金箔の下に、ひとつの文字が眠っている。印を押して、写し取る。' : 'この記録に検印はない。ひと息置いて、次の額縁へ。';
  if (!dialog.open) { opener = openingButton || document.querySelector(`[data-gallery-index="${current}"]`); dialog.showModal(); syncModalLock(); }
  play(record.seal && !collected ? 'gallery-reveal' : 'tap', { level: .55 });
  return true;
}
function closeRecord({ restoreFocus = true } = {}) {
  if (phase === 'collecting') { stopTimeline(); stopSounds(); phase = 'idle'; renderPuzzle(); }
  dialog.close(); syncModalLock(); if (restoreFocus) opener?.focus({ preventScroll: true });
}
function collectSeal() {
  const record = records[current];
  if (!dialog.open || phase !== 'idle' || !record.seal || found.has(record.number)) return false;
  phase = 'collecting'; found.add(record.number); save(storageKey, JSON.stringify([...found]));
  collect.disabled = true; imprint.dataset.stage = 'press'; play('gallery-collect', { level: .8, rate: .95 + record.seal.order * .015 });
  note.textContent = '金箔の輪郭が、紙に移っていく。';
  animate(reducedMotion.matches ? 100 : 1150, elapsed => {
    if (elapsed >= 320 || reducedMotion.matches) { imprint.dataset.stage = 'reveal'; imprint.querySelector('strong').textContent = record.seal.fragment; }
  }, () => {
    phase = 'idle'; renderPuzzle(); imprint.dataset.stage = 'collected'; imprint.querySelector('small').textContent = 'FILED / 照合済';
    collect.hidden = true; collect.disabled = false; note.textContent = `文字「${record.seal.fragment}」を検印帳へ。${found.size} / 6`;
    if (found.size === 6 && !cleared) { closeRecord({ restoreFocus: false }); beginCeremony('gather'); }
  });
  return true;
}
function finishRelease() {
  stopTimeline(); cleared = true; phase = 'idle'; save(clearedKey, '1'); renderPuzzle(); stage.dataset.phase = 'open';
  ceremony.querySelector('[data-ceremony-message]').textContent = '奥で、赤い灯りが点いた。次の部屋へ、進めます。';
  continueButton.hidden = false; continueButton.textContent = '赤い扉へ'; skipButton.hidden = true;
  if (ceremony.open) continueButton.focus({ preventScroll: true });
}
function beginCeremony(kind) {
  if (ceremony.open || dialog.open) return;
  ceremonyKind = kind; phase = kind === 'release' ? 'releasing' : 'gathering'; setLedger(false);
  stage.dataset.phase = kind; ceremony.classList.remove('is-skipped');
  ceremony.querySelectorAll('.gallery-orbit-seal strong').forEach((element, index) => { element.textContent = kind === 'release' ? solved[index] : seals[index].seal.fragment; });
  ceremony.querySelector('.gallery-ceremony-core strong').textContent = kind === 'release' ? '解' : '六';
  ceremony.querySelector('[data-ceremony-eyebrow]').textContent = kind === 'release' ? 'THE SEALS ANSWER' : 'SIX FRAGMENTS / FILED';
  ceremony.querySelector('h2').textContent = kind === 'release' ? '六つの留め具が、応える。' : '六つの検印が、揃った。';
  ceremony.querySelector('[data-ceremony-message]').textContent = kind === 'release' ? 'ひとつずつ、扉を縛るものが外れていく。' : 'ばらばらの文字が、ひとつの言葉を待っている。';
  continueButton.textContent = '印を並べに行く'; continueButton.hidden = kind === 'release'; skipButton.hidden = false;
  ceremony.showModal(); syncModalLock(); (kind === 'release' ? skipButton : continueButton).focus({ preventScroll: true });
  stopSounds(); play(kind === 'release' ? 'gallery-unseal' : 'gallery-complete', { level: .85 });
  if (kind === 'release') animate(reducedMotion.matches ? 150 : 4400, elapsed => { if (elapsed >= 2650) stage.dataset.phase = 'open'; }, finishRelease);
}
function closeCeremony() {
  if (ceremonyKind === 'release' && !cleared) { stopSounds(); ceremony.classList.add('is-skipped'); finishRelease(); }
  stopTimeline(); ceremony.close(); syncModalLock(); phase = 'idle';
  scrollToArea(ceremonyKind === 'release' ? exit : answer);
}
function submitWord(value) {
  if (found.size !== 6 || cleared || phase !== 'idle' || dialog.open || ceremony.open) return { accepted: false, unavailable: true };
  if (typeof value !== 'string' || value.length > 32) throw Error('Enter a word of at most 32 characters');
  answer.value = value;
  if (value.replace(/[\s　]+/g, '') === solved) { beginCeremony('release'); return { accepted: true }; }
  page.classList.remove('is-gallery-denied'); void form.offsetWidth; page.classList.add('is-gallery-denied');
  message.textContent = '留め具がひとつ鳴り、また静まった。文字の順番を変えてみよう。'; message.classList.add('is-error');
  play('transmission', { level: .42 }); return { accepted: false };
}
function leaveGallery(event) {
  if (!cleared) { event.preventDefault(); return; }
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  event.preventDefault(); if (!cleared || phase !== 'idle') return;
  phase = 'leaving'; page.classList.add('is-door-opening'); setLedger(false); play('gallery-door', { level: .8 });
  animate(reducedMotion.matches ? 120 : 1700, null, () => {
    const destination = exit.href;
    if (room?.navigate) room.navigate(destination); else window.location.href = destination;
  });
}
for (const button of document.querySelectorAll('[data-gallery-index]')) {
  button.addEventListener('click', () => showRecord(Number(button.dataset.galleryIndex), button));
  button.addEventListener('pointermove', event => { if (event.pointerType !== 'mouse' || reducedMotion.matches) return; const bounds = button.getBoundingClientRect(); button.style.setProperty('--spot-x', `${(event.clientX - bounds.left) / bounds.width * 100}%`); button.style.setProperty('--spot-y', `${(event.clientY - bounds.top) / bounds.height * 100}%`); });
}
collect.addEventListener('click', collectSeal);
dialog.querySelector('[data-gallery-prev]').addEventListener('click', () => showRecord(current - 1));
dialog.querySelector('[data-gallery-next]').addEventListener('click', () => showRecord(current + 1));
dialog.querySelector('[data-gallery-close]').addEventListener('click', () => closeRecord());
dialog.addEventListener('cancel', event => { event.preventDefault(); closeRecord(); });
dialog.addEventListener('click', event => { if (event.target === dialog) closeRecord(); });
dialog.addEventListener('keydown', event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); showRecord(current + (event.key === 'ArrowRight' ? 1 : -1)); } });
ledger.querySelector('[data-ledger-toggle]').addEventListener('click', () => { setLedger(ledger.querySelector('.gallery-ledger-panel').hidden); play('gallery-reveal', { level: .35 }); });
ledger.querySelector('[data-ledger-puzzle]').addEventListener('click', () => { const target = found.size === 6 && !cleared ? answer : document.querySelector('#gallery-puzzle-title'); target.tabIndex = -1; scrollToArea(target); });
for (const tile of wordTray.querySelectorAll('[data-word-fragment]')) tile.addEventListener('click', () => { if (answer.value.length < 6) { answer.value += tile.dataset.wordFragment; play('portrait', { level: .35, rate: .92 + answer.value.length * .035 }); } });
undo.addEventListener('click', () => { answer.value = answer.value.slice(0, -1); play('tap', { level: .5 }); });
form.addEventListener('submit', event => { event.preventDefault(); submitWord(answer.value); });
continueButton.addEventListener('click', closeCeremony); skipButton.addEventListener('click', closeCeremony);
ceremony.addEventListener('cancel', event => { event.preventDefault(); closeCeremony(); });
exit.addEventListener('click', leaveGallery);
document.addEventListener('visibilitychange', () => {
  lastTime = 0; document.body.classList.toggle('gallery-paused', document.hidden);
  if (document.hidden) { stopSounds(); if (!room) sound.silence(); }
  else if (!room && sound.enabled) void sound.resumeMusic();
});
window.addEventListener('pagehide', () => { stopTimeline(); stopSounds(); if (!room) sound.silence(); });
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  if (phase === 'releasing') finishRelease();
  if (phase === 'collecting') { dialog.close(); syncModalLock(); renderPuzzle(); }
  phase = 'idle'; page.classList.remove('is-door-opening');
  if (!room && sound.enabled) void sound.resumeMusic();
});
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches && timeline && phase !== 'leaving') { const finish = timeline.finish; stopTimeline(); finish(); }
});
renderPuzzle();
const register = tool => { try { (room?.registerTool ? room.registerTool(tool) : document.modelContext?.registerTool(tool)); } catch {} };
const state = () => ({ found: [...found], count: found.size, cleared, phase, currentRecord: dialog.open ? records[current].number : null, lightboxOpen: dialog.open, ceremony: ceremony.open ? ceremonyKind : null, ledgerOpen: !ledger.querySelector('.gallery-ledger-panel').hidden, sound: sound.state() });
register({ name: 'read_gallery_state', description: 'Read collected seals, gallery ceremony and sound state. Does not change or clear saved progress.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: state });
register({ name: 'open_gallery_record', description: 'Open one of the 24 displayed records using its normal lightbox. Does not collect a seal or enable sound.', inputSchema: { type: 'object', properties: { number: { type: 'integer', minimum: 1, maximum: 24 } }, required: ['number'], additionalProperties: false }, execute: input => { if (!Number.isInteger(input?.number) || input.number < 1 || input.number > 24) throw Error('Record must be 1–24'); if (!showRecord(input.number - 1)) throw Error('Finish or close the current ceremony first'); return state(); } });
register({ name: 'collect_gallery_seal', description: 'Press the visible seal in the open record, with the normal imprint animation. Saves only local collection progress and never enables audio.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => { if (!collectSeal()) throw Error('Open an uncollected marked record first'); return state(); } });
register({ name: 'close_gallery_overlay', description: 'Close the record or finish/skip its ceremony using the same visible controls. Never skips collection or the passphrase.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => { if (ceremony.open) closeCeremony(); else if (dialog.open) closeRecord(); return state(); } });
register({ name: 'submit_gallery_word', description: 'Try a word after collecting all six seals. The same normal puzzle and release ceremony apply. Does not enable audio.', inputSchema: { type: 'object', properties: { word: { type: 'string', maxLength: 32 } }, required: ['word'], additionalProperties: false }, execute: input => { const result = submitWord(input?.word); return { ...result, ...state() }; } });
