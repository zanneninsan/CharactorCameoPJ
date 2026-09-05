import { createSound } from './audio.js';
import { connectGuestbook } from './guestbook-adapter.js';
import { createOffering } from './offering.js';
import { STOPS, TRAVEL_DISTANCE } from './route.js';

const clamp = value => Math.max(0, Math.min(1, value));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const journey = document.querySelector('.journey');
const threshold = document.querySelector('#threshold');
const nav = document.querySelector('.journey-nav');
const locationLabel = document.querySelector('[data-location]');
const distanceLabel = document.querySelector('[data-distance]');
const objectLinks = [...document.querySelectorAll('[data-object]')];
const dialog = document.querySelector('.sound-invitation');
const gamesDialog = document.querySelector('.games-dialog');
const toggle = document.querySelector('.sound-toggle');
const status = document.querySelector('.sound-status');
const audio = document.querySelector('#ambient-audio');
let scene, travel = 0, queued = false, consentGiven = false, lastStep = 0, stepDistance = 0, stepIndex = 0, lastScroll = 0, navigationTimer, fadeTimer, departing = false;
const found = new Set();
const stopIds = [...STOPS.map(stop => stop.id), 'threshold'];
for (const stop of STOPS) document.getElementById(stop.id).style.top = `calc(var(--walk-length) * ${stop.progress})`;
const sound = createSound(audio, {
  onChange({ enabled }) {
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.setAttribute('aria-label', enabled ? '音をオフにする' : '音をオンにする');
    document.querySelector('[data-sound-label]').textContent = enabled ? 'SOUND ON' : 'SOUND OFF';
  },
  onError(message) { status.textContent = message; }
});
const guestbook = connectGuestbook({
  onChange(open) {
    lastScroll = 0; stepDistance = 0;
    if (open) { scene?.setPointer(0, 0); scene?.pause(); }
    else { scheduleUpdate(); if (!document.hidden) scene?.resume(); }
  },
  onTap() { sound.play('tap', { level: .7 }); }
});
const offering = createOffering({
  canOpen: () => consentGiven && !departing && !guestbook.isOpen(),
  onChange(open) {
    lastScroll = 0; stepDistance = 0;
    if (open) { scene?.setPointer(0, 0); scene?.pause(); }
    else { scheduleUpdate(); if (!document.hidden && !guestbook.isOpen()) scene?.resume(); }
  },
  onSound(id) { sound.play(id, { level: .8 }); }
});
for (const button of document.querySelectorAll('[data-open-offering]')) {
  button.hidden = false;
  button.addEventListener('click', () => offering.open(button));
}
toggle.hidden = false;
document.querySelector('.sound-settings').hidden = false;
function chooseSound(enabled) {
  consentGiven = true;
  status.textContent = '';
  if (enabled) void sound.enable(); else sound.mute();
  dialog.close(); document.body.classList.remove('modal-open');
  document.querySelector('.journey-link').focus({ preventScroll: true });
}
document.querySelector('.enter-with-sound').addEventListener('click', () => chooseSound(true));
document.querySelector('.enter-silent').addEventListener('click', () => chooseSound(false));
dialog.addEventListener('cancel', event => { event.preventDefault(); chooseSound(false); });
dialog.addEventListener('close', () => { document.body.classList.remove('modal-open'); });
toggle.addEventListener('click', () => {
  status.textContent = '';
  if (sound.enabled) sound.mute(); else void sound.enable();
});
document.querySelector('#music-volume').addEventListener('input', event => sound.setMusicVolume(Number(event.target.value) / 100));
document.querySelector('#effects-volume').addEventListener('input', event => sound.setEffectsVolume(Number(event.target.value) / 100));
document.querySelector('#effects-volume').addEventListener('change', () => sound.play('tap'));
document.querySelector('.sound-settings').addEventListener('toggle', () => sound.play('tap', { level: .7 }));
let gamesOpener;
for (const link of document.querySelectorAll('[data-open-games]')) link.addEventListener('click', event => {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || typeof gamesDialog.showModal !== 'function') return;
  event.preventDefault(); gamesOpener = event.currentTarget;
  gamesDialog.showModal(); document.body.classList.add('modal-open');
});
document.querySelector('[data-close-games]').addEventListener('click', () => gamesDialog.close());
gamesDialog.addEventListener('cancel', () => sound.play('tap', { level: .7 }));
gamesDialog.addEventListener('close', () => {
  document.body.classList.remove('modal-open');
  const focusTarget = gamesOpener?.classList.contains('is-visible') ? gamesOpener : nav.querySelector('a[href="#games"]');
  focusTarget?.focus({ preventScroll: true });
});

function updateTravel() {
  queued = false;
  if (guestbook.isOpen() || offering.isOpen()) return;
  const start = journey.getBoundingClientRect().top + window.scrollY;
  const end = threshold.getBoundingClientRect().top + window.scrollY;
  travel = clamp((window.scrollY - start) / Math.max(1, end - start));
  scene?.setProgress(travel);
  nav.style.setProperty('--travel', travel);
  nav.hidden = !scene || window.scrollY < start - window.innerHeight * .4;
  if (!scene) return;
  distanceLabel.textContent = `${String(Math.round(travel * TRAVEL_DISTANCE)).padStart(2, '0')} / ${TRAVEL_DISTANCE} m`;
  const currentStop = STOPS.findLast(stop => travel >= stop.progress - .065);
  locationLabel.textContent = travel > .94 ? '扉の前' : currentStop ? `${currentStop.label}の前` : '回廊';
  const currentId = travel > .94 ? 'threshold' : currentStop?.id;
  for (const link of nav.querySelectorAll('a')) {
    if (link.getAttribute('href') === `#${currentId}`) link.setAttribute('aria-current', 'step'); else link.removeAttribute('aria-current');
  }
}
function scheduleUpdate() { if (!queued) { queued = true; requestAnimationFrame(updateTravel); } }
window.addEventListener('scroll', () => { lastScroll = performance.now(); scheduleUpdate(); }, { passive: true });
window.addEventListener('resize', scheduleUpdate);
function showFallback() {
  scene?.pause(); scene = undefined;
  document.body.classList.remove('has-scene'); document.body.classList.add('scene-unavailable');
  nav.hidden = true;
  for (const link of objectLinks) { link.style.transform = ''; link.removeAttribute('tabindex'); link.removeAttribute('aria-hidden'); }
  status.textContent = 'この環境では立体表示を利用できません。下のリンクから各ページへ進めます。';
}
// Ask before the async scene import; audio never starts merely by loading the page.
if (typeof dialog.showModal === 'function') {
  dialog.showModal(); document.body.classList.add('modal-open');
} else { consentGiven = true; }
try {
  const { createCorridor } = await import('./corridor.js');
  scene = createCorridor(document.querySelector('#corridor-canvas'), {
    onUnavailable: showFallback,
    onFrame({ labels, moved, nearest, now }) {
      for (const link of objectLinks) {
        const id = link.dataset.object, point = labels[id];
        const visible = point?.visible && !departing && !dialog.open && !gamesDialog.open && !guestbook.isOpen() && !offering.isOpen() && travel > .025;
        link.classList.toggle('is-visible', visible);
        link.setAttribute('aria-hidden', String(!visible)); link.tabIndex = visible ? 0 : -1;
        if (visible) {
          const width = link.offsetWidth || 245, height = link.offsetHeight || 80;
          const x = Math.max(16, Math.min(window.innerWidth - width - 16, point.x - width / 2));
          let y = Math.max(105, Math.min(window.innerHeight - height - 155, point.y + 15));
          // Separate both labels whenever their projected rectangles overlap, including landscape screens.
          if (id === 'offering' && labels.portrait?.visible) {
            const portraitLink = objectLinks.find(item => item.dataset.object === 'portrait');
            const portraitHeight = portraitLink.offsetHeight || 80;
            const portraitY = Math.max(105, Math.min(window.innerHeight - portraitHeight - 155, labels.portrait.y + 15));
            const portraitWidth = portraitLink.offsetWidth || 245;
            const portraitX = Math.max(16, Math.min(window.innerWidth - portraitWidth - 16, labels.portrait.x - portraitWidth / 2));
            if (x < portraitX + portraitWidth + 12 && x + width + 12 > portraitX && y < portraitY + portraitHeight + 12 && y + height + 12 > portraitY) {
              y = portraitY - height - 12;
              if (y < 85) {
                y = 85;
                portraitLink.style.transform = `translate(${Math.round(portraitX)}px, ${Math.round(y + height + 12)}px)`;
              }
            }
          }
          link.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
          if (!found.has(id) && consentGiven && performance.now() - lastScroll < 250) {
            found.add(id); sound.play('discover', { level: .32, pan: (STOPS.find(stop => stop.id === id)?.x ?? 2.1) > 0 ? .35 : -.35 });
          }
        }
      }
      if (consentGiven && !departing && !dialog.open && !gamesDialog.open && !guestbook.isOpen() && !offering.isOpen() && now - lastScroll < 220 && travel > .01 && travel < .995) {
        stepDistance += moved;
        if (stepDistance > .7 && now - lastStep > 360) {
          stepDistance = 0; lastStep = now; stepIndex++;
          sound.play(stepIndex % 2 ? 'step-1' : 'step-2', { level: .5, pan: stepIndex % 2 ? -.13 : .13, rate: .97 + (stepIndex % 4) * .018 });
        }
      }
    }
  });
  document.body.classList.add('has-scene');
  if (guestbook.isOpen() || offering.isOpen() || document.hidden) scene.pause();
} catch { showFallback(); }
updateTravel();

window.addEventListener('pointermove', event => {
  if (guestbook.isOpen() || offering.isOpen() || dialog.open || gamesDialog.open) return;
  if (event.pointerType === 'mouse') scene?.setPointer(event.clientX / window.innerWidth * 2 - 1, event.clientY / window.innerHeight * 2 - 1);
}, { passive: true });
document.addEventListener('click', event => {
  if (event.target.closest('[data-guestbook-widget], .offering-dialog') || guestbook.isOpen() || offering.isOpen()) return;
  const actionable = event.target.closest('a, button, summary, input, dialog');
  if (actionable) {
    if (actionable.matches('[data-sfx]')) sound.play(actionable.dataset.sfx, { level: .8 });
    return;
  }
  if (!scene || dialog.open || gamesDialog.open || departing || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const id = scene.hitTest(event.clientX, event.clientY);
  const link = objectLinks.find(item => item.dataset.object === id && item.classList.contains('is-visible'));
  link?.click();
});
document.querySelector('[data-gate]').addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) { sound.play('tap'); return; }
  event.preventDefault(); if (departing) return;
  departing = true; sound.play('door-open', { level: 1 });
  document.querySelector('[data-guestbook-widget]').inert = true;
  const destination = event.currentTarget.href;
  scene?.setProgress(1); scene?.openDoor();
  const duration = reducedMotion.matches ? 250 : 2100;
  fadeTimer = window.setTimeout(() => document.body.classList.add('is-leaving'), reducedMotion.matches ? 0 : 1450);
  navigationTimer = window.setTimeout(() => { window.location.href = destination; }, duration);
});
window.addEventListener('pagehide', () => {
  sound.silence(); scene?.pause(); clearTimeout(navigationTimer); clearTimeout(fadeTimer);
});
window.addEventListener('pageshow', event => {
  departing = false; navigationTimer = undefined; fadeTimer = undefined;
  document.body.classList.remove('is-leaving');
  document.querySelector('[data-guestbook-widget]').inert = false;
  scene?.resetDoor(); if (!guestbook.isOpen() && !offering.isOpen()) scene?.resume(); updateTravel();
  if (event.persisted && sound.enabled) void sound.resumeMusic();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { sound.silence(); scene?.pause(); }
  else { if (!guestbook.isOpen() && !offering.isOpen()) scene?.resume(); if (consentGiven && sound.enabled) void sound.resumeMusic(); }
});

// Optional browser integration uses the same controls and never enables audio without a click.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const register = tool => {
    try { Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch {}
  };
  register({ name: 'read_corridor_state', description: 'Read corridor position, rendering availability, sound, guestbook and pretend offering game state.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => ({ position: travel, sceneAvailable: Boolean(scene), sound: sound.state(), consentRequired: dialog.open, gamesOpen: gamesDialog.open, guestbookOpen: guestbook.isOpen(), guestbookReady: guestbook.isReady(), offering: offering.state() }) });
  register({ name: 'navigate_corridor', description: 'Move within the corridor to a chosen exhibit or the door. Does not open an external page or enable sound.', inputSchema: { type: 'object', properties: { stop: { type: 'string', enum: stopIds } }, required: ['stop'], additionalProperties: false }, execute: async input => {
    if (!input || Object.keys(input).length !== 1 || !stopIds.includes(input.stop)) throw Error('Invalid corridor stop');
    if (dialog.open) throw Error('Choose sound on or off in the entrance dialog first');
    if (guestbook.isOpen()) throw Error('Close the guestbook before moving through the corridor');
    if (offering.isOpen()) throw Error('Close the offering game before moving through the corridor');
    if (gamesDialog.open) gamesDialog.close();
    document.getElementById(input.stop).scrollIntoView({ behavior: 'instant' }); updateTravel();
    return { stop: input.stop, position: travel };
  } });
  register({ name: 'set_guestbook_open', description: 'Open or close the shared guestbook. Opening reads existing entries; this tool never writes or submits a message.', inputSchema: { type: 'object', properties: { open: { type: 'boolean' } }, required: ['open'], additionalProperties: false }, execute: input => {
    if (!input || Object.keys(input).length !== 1 || typeof input.open !== 'boolean') throw Error('Expected a boolean open value');
    if (input.open) {
      if (dialog.open) throw Error('Choose sound on or off in the entrance dialog first');
      if (departing) throw Error('The door transition is in progress');
      if (offering.isOpen()) throw Error('Close the offering game before opening the guestbook');
      if (gamesDialog.open) gamesDialog.close();
      if (!guestbook.open()) throw Error('Guestbook is not ready');
    } else guestbook.close();
    return { guestbookOpen: guestbook.isOpen(), guestbookReady: guestbook.isReady() };
  } });
  register({ name: 'set_offering_open', description: 'Open or close the pretend offering game. No actual money, payment, data submission or storage is involved.', inputSchema: { type: 'object', properties: { open: { type: 'boolean' } }, required: ['open'], additionalProperties: false }, execute: input => {
    if (!input || Object.keys(input).length !== 1 || typeof input.open !== 'boolean') throw Error('Expected a boolean open value');
    if (input.open) {
      if (!offering.open(document.querySelector('.offering-footer'))) throw Error('Choose sound on or off and close other dialogs before opening the offering game');
    } else offering.close();
    return offering.state();
  } });
  register({ name: 'play_offering', description: 'Choose a displayed pretend yen amount and show its joke reaction in the open offering game. This never sends money or data. Close and reopen, or use the visible try-again button, for another round.', inputSchema: { type: 'object', properties: { amount: { type: 'integer', enum: [0, 5, 100, 1000, 10000, 1000000, 100000000] } }, required: ['amount'], additionalProperties: false }, execute: input => {
    if (!input || Object.keys(input).length !== 1) throw Error('Expected one amount value');
    if (!offering.isOpen()) throw Error('Open the offering game first');
    if (!offering.choose(input.amount) || !offering.submit()) throw Error('Start another round before offering again');
    return offering.state();
  } });
  window.addEventListener('pagehide', event => { if (!event.persisted) lifecycle.abort(); });
}
