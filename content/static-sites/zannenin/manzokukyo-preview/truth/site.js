import { createSound } from '../audio.js';
import { connectGuestbook } from '../guestbook-adapter.js';

const RUNE_OPTIONS = [['未', '満', '赤', '空'], ['定', '足', '罪', '門']];
const ANSWERS = ['満足', 'まんぞく'];
const BAD_MESSAGES = ['違う。いまの声は、奥の誰かに届いた。', '祭壇の下で、爪が石をなぞっている。', 'その言葉では満たされない。もう一度。', '右奥の暗がりが、ひとつ近づいた。', 'あなたの声を覚えた。次は間違えないで。'];
const form = document.querySelector('#truth-console');
const input = document.querySelector('#truth-passphrase');
const message = document.querySelector('#truth-message');
const meter = document.querySelector('[data-denial-meter]');
const runes = [...document.querySelectorAll('[data-rune]')];
const soundToggle = document.querySelector('.sound-toggle');
const soundInvitation = document.querySelector('.truth-audio-invite');
const status = document.querySelector('.sound-status');
const guestbookRoot = document.querySelector('[data-guestbook-widget]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const destination = new URL('../../manzokukyo/truth/gallery/', window.location.href).href;
const indices = [0, 0];
let scene, state = 'waiting', denials = 0, rejectionTimer, navigationTimer, fadeTimer, navigationStarted = 0, remaining = 2400;

const sound = createSound(document.querySelector('#ambient-audio'), {
  soundPath: '../sounds/',
  onChange({ enabled }) {
    soundToggle.setAttribute('aria-pressed', String(enabled));
    soundToggle.setAttribute('aria-label', enabled ? '音をオフにする' : '音をオンにする');
    document.querySelector('[data-sound-label]').textContent = enabled ? 'SOUND ON' : 'SOUND OFF';
  },
  onError(text) { status.textContent = text; }
});
const guestbook = connectGuestbook({
  onChange(open) {
    if (open) { scene?.setPointer(0, 0); scene?.pause(); pauseNavigation(); }
    else if (!document.hidden) { scene?.resume(); resumeNavigation(); }
  },
  onTap() { sound.play('tap', { level: .7 }); }
});

function setState(next) {
  state = next; document.body.dataset.truthState = next; scene?.setState(next, denials);
}
function selectedRunes() { return RUNE_OPTIONS.map((options, index) => options[indices[index]]); }
function renderRunes() {
  const selected = selectedRunes();
  runes.forEach((button, index) => {
    button.querySelector('strong').textContent = selected[index];
    button.setAttribute('aria-label', `${index === 0 ? '第一' : '第二'}の印、現在は${selected[index]}`);
  });
  input.value = selected.join(''); scene?.setRunes(selected);
}
function assertAvailable() {
  if (state === 'accepted') throw Error('The door is already opening');
  if (guestbook.isOpen()) throw Error('Close the guestbook before touching the altar');
}
function advanceRune(index) {
  assertAvailable();
  if (!Number.isInteger(index) || index < 0 || index > 1) throw Error('Choose the first or second seal');
  clearTimeout(rejectionTimer);
  indices[index] = (indices[index] + 1) % RUNE_OPTIONS[index].length;
  renderRunes(); setState('listening');
  message.textContent = '印がひとつ進んだ。二つの音が、祭壇に残る。';
  sound.play('portrait', { level: .6, rate: index ? 1.08 : .95 });
  return selectedRunes();
}
function pauseNavigation() {
  clearTimeout(navigationTimer); clearTimeout(fadeTimer);
  if (navigationStarted) remaining = Math.max(0, remaining - (performance.now() - navigationStarted));
  navigationStarted = 0;
}
function resumeNavigation() {
  if (state !== 'accepted' || document.hidden || guestbook.isOpen() || navigationStarted) return;
  navigationStarted = performance.now();
  fadeTimer = setTimeout(() => document.body.classList.add('is-leaving'), Math.max(0, remaining - 650));
  navigationTimer = setTimeout(() => { window.location.href = destination; }, remaining);
}
function submitPassphrase(value) {
  assertAvailable();
  if (typeof value !== 'string' || value.length > 64) throw Error('Passphrase must be text of at most 64 characters');
  input.value = value;
  const normalized = value.replace(/[\u3000\s]+/g, '').trim();
  clearTimeout(rejectionTimer);
  if (ANSWERS.includes(normalized)) {
    setState('accepted');
    message.textContent = '受理しました。次の部屋が、あなたを待っています。';
    for (const control of form.querySelectorAll('input, button')) control.disabled = true;
    guestbookRoot.inert = true;
    soundInvitation.hidden = true;
    sound.play('door-open', { level: .85 });
    remaining = reducedMotion.matches ? 250 : 2400; resumeNavigation();
    return { accepted: true, destination, message: message.textContent };
  }
  denials = Math.min(3, denials + 1);
  meter.textContent = `${String(denials).padStart(2, '0')} / 03`;
  setState('denied');
  message.textContent = BAD_MESSAGES[Math.floor(Math.random() * BAD_MESSAGES.length)];
  sound.play('transmission', { level: .6, rate: .82 });
  rejectionTimer = setTimeout(() => { if (state === 'denied') setState('listening'); }, reducedMotion.matches ? 200 : 1280);
  return { accepted: false, denials, message: message.textContent };
}
function resetAfterReturn() {
  pauseNavigation(); clearTimeout(rejectionTimer);
  remaining = 2400; denials = 0; indices.fill(0);
  document.body.classList.remove('is-leaving');
  guestbookRoot.inert = false;
  for (const control of form.querySelectorAll('input, button')) control.disabled = false;
  scene?.reset(); renderRunes(); setState('waiting');
  meter.textContent = '00 / 03'; message.textContent = '祭壇は、あなたの言葉を待っている。';
}

for (const button of runes) button.addEventListener('click', () => { if (state !== 'accepted' && !guestbook.isOpen()) advanceRune(Number(button.dataset.rune)); });
input.addEventListener('input', () => { if (state !== 'accepted') { clearTimeout(rejectionTimer); setState('listening'); } });
form.addEventListener('submit', event => {
  event.preventDefault();
  if (state === 'accepted' || guestbook.isOpen()) return;
  const result = submitPassphrase(input.value);
  if (!result.accepted && document.activeElement === input) input.select();
});
document.querySelector('[data-start-sound]').addEventListener('click', () => {
  soundInvitation.hidden = true; status.textContent = ''; void sound.enable();
});
document.querySelector('[data-stay-silent]').addEventListener('click', () => { soundInvitation.hidden = true; sound.mute(); });
soundToggle.addEventListener('click', () => {
  soundInvitation.hidden = true; status.textContent = '';
  if (sound.enabled) sound.mute(); else void sound.enable();
});
document.querySelector('#music-volume').addEventListener('input', event => sound.setMusicVolume(Number(event.target.value) / 100));
document.querySelector('#effects-volume').addEventListener('input', event => sound.setEffectsVolume(Number(event.target.value) / 100));
document.querySelector('#effects-volume').addEventListener('change', () => sound.play('tap'));
soundToggle.hidden = false; document.querySelector('.sound-settings').hidden = false; soundInvitation.hidden = false;

window.addEventListener('pointermove', event => {
  if (event.pointerType === 'mouse' && !guestbook.isOpen() && state !== 'accepted') scene?.setPointer(event.clientX / innerWidth * 2 - 1, event.clientY / innerHeight * 2 - 1);
}, { passive: true });
document.addEventListener('click', event => {
  if (event.target.closest('[data-guestbook-widget]') || guestbook.isOpen()) return;
  const target = event.target.closest('a, button, input, form, details, aside');
  if (target) { if (target.matches('[data-sfx]')) sound.play(target.dataset.sfx, { level: .65 }); return; }
  if (state === 'accepted' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  const index = scene?.hitTest(event.clientX, event.clientY);
  if (index === 0 || index === 1) advanceRune(index);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { sound.silence(); scene?.pause(); pauseNavigation(); }
  else {
    if (!guestbook.isOpen()) { scene?.resume(); resumeNavigation(); }
    if (sound.enabled) void sound.resumeMusic();
  }
});
window.addEventListener('pagehide', () => { sound.silence(); scene?.pause(); pauseNavigation(); clearTimeout(rejectionTimer); });
window.addEventListener('pageshow', event => {
  if (event.persisted) resetAfterReturn();
  if (!document.hidden && !guestbook.isOpen()) scene?.resume();
  if (event.persisted && sound.enabled) void sound.resumeMusic();
});
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches && state === 'accepted') { pauseNavigation(); remaining = 250; resumeNavigation(); }
});
function showFallback() {
  scene?.dispose(); scene = undefined; document.body.classList.add('scene-unavailable');
  status.textContent = '立体表示を利用できません。下の印と合言葉の仕掛けは、そのまま遊べます。';
}
renderRunes();
try {
  const { createTruthChamber } = await import('./chamber.js');
  scene = createTruthChamber(document.querySelector('#truth-canvas'), { onUnavailable: showFallback });
  if (scene) {
    scene.setRunes(selectedRunes()); scene.setState(state, denials);
    if (document.hidden || guestbook.isOpen()) scene.pause();
  }
} catch { showFallback(); }

if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const register = tool => { try { Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch {} };
  register({ name: 'read_truth_state', description: 'Read the altar seals, passphrase, reaction count, room state, sound and guestbook state.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: args => {
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw Error('Expected an empty object');
    return { state, denials, runes: selectedRunes(), passphrase: input.value, sceneAvailable: Boolean(scene), sound: sound.state(), guestbookOpen: guestbook.isOpen(), message: message.textContent };
  } });
  register({ name: 'cycle_truth_rune', description: 'Turn the first or second seal once, using the same action as touching its stone or button. Does not submit the word.', inputSchema: { type: 'object', properties: { index: { type: 'integer', enum: [0, 1] } }, required: ['index'], additionalProperties: false }, execute: input => {
    if (!input || Object.keys(input).length !== 1) throw Error('Expected one seal index');
    return { runes: advanceRune(input.index), state };
  } });
  register({ name: 'submit_truth_passphrase', description: 'Offer a passphrase to the altar. A correct word opens the 3D door and navigates to the existing memory gallery after a short transition. Never enables sound.', inputSchema: { type: 'object', properties: { passphrase: { type: 'string', maxLength: 64 } }, required: ['passphrase'], additionalProperties: false }, execute: input => {
    if (!input || Object.keys(input).length !== 1) throw Error('Expected one passphrase');
    return submitPassphrase(input.passphrase);
  } });
  register({ name: 'set_guestbook_open', description: 'Open or close the shared guestbook. Opening reads existing entries; never submits a post.', inputSchema: { type: 'object', properties: { open: { type: 'boolean' } }, required: ['open'], additionalProperties: false }, execute: input => {
    if (!input || Object.keys(input).length !== 1 || typeof input.open !== 'boolean') throw Error('Expected a boolean open value');
    if (input.open) { if (state === 'accepted') throw Error('The door is opening'); if (!guestbook.open()) throw Error('Guestbook is not ready'); }
    else guestbook.close();
    return { guestbookOpen: guestbook.isOpen() };
  } });
  window.addEventListener('pagehide', event => { if (!event.persisted) lifecycle.abort(); });
}
