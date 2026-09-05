import { appRoot, resolveRoom, roomTrack } from './rooms.js';
import { createSessionAudio } from './audio-session.js';

const host = document.querySelector('#room-host');
const loading = document.querySelector('#room-loading');
const error = document.querySelector('#room-error');
const announcement = document.querySelector('#room-announcement');
const sessionId = crypto.randomUUID();
let current, sequence = 0;
const audio = createSessionAudio({
  soundBase: new URL('sounds/', appRoot).href,
  onChange(state) { for (const listener of current?.listeners || []) listener.onChange?.(state); },
  onError(message) { for (const listener of current?.listeners || []) listener.onError?.(message); }
});

function register(tool, signal) {
  try { Promise.resolve(document.modelContext?.registerTool(tool, { signal })).catch(() => {}); } catch {}
}
register({ name: 'read_teaser_session', description: 'Read the current room and persistent sound session. Does not play audio or navigate.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => ({ sessionId, room: current?.room.id, loading: !current?.ready, sound: audio.state() }) });

function scrollRoom(url, smooth = false) {
  const doc = current?.frame.contentDocument;
  if (!doc) return;
  let id;
  try { id = decodeURIComponent(url.hash.slice(1)); } catch { return; }
  const target = id && doc.getElementById(id);
  if (target) target.scrollIntoView({ behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
  else if (!id) current.frame.contentWindow.scrollTo(0, 0);
}

function navigate(href, { historyMode = 'push', reload = false } = {}) {
  const resolved = resolveRoom(href, location.href);
  if (!resolved) { location.assign(href); return; }
  const { room, url } = resolved;
  if (!reload && current && !current.ready && current.room.id === room.id && historyMode === 'none') {
    current.url = url; return;
  }
  if (!reload && current?.ready && current.room.id === room.id) {
    if (historyMode !== 'none' && url.href !== location.href) history[historyMode === 'replace' ? 'replaceState' : 'pushState']({}, '', url);
    current.url = url; scrollRoom(url, historyMode === 'push'); return;
  }
  if (historyMode !== 'none') history[historyMode === 'replace' ? 'replaceState' : 'pushState']({}, '', url);
  current?.controller.abort();
  if (current) { clearTimeout(current.timeout); current.listeners.clear(); }
  audio.stopEffects();
  const frame = document.createElement('iframe');
  frame.title = room.title;
  frame.allow = 'autoplay';
  const record = { id: ++sequence, room, url, frame, listeners: new Set(), controller: new AbortController(), attached: false, ready: false };
  current = record;
  loading.hidden = false; error.hidden = true; host.setAttribute('aria-busy', 'true');
  function fail() {
    if (current !== record || record.ready) return;
    clearTimeout(record.timeout); loading.hidden = true; error.hidden = false;
    host.setAttribute('aria-busy', 'false');
    error.querySelector('[data-fallback]').href = new URL(`../manzokukyo/${room.old}`, appRoot).href;
  }
  frame.addEventListener('error', fail);
  frame.addEventListener('load', () => {
    if (current !== record) return;
    if (!record.attached) { fail(); return; }
    clearTimeout(record.timeout); record.ready = true;
    loading.hidden = true; error.hidden = true; host.setAttribute('aria-busy', 'false');
    document.title = frame.contentDocument.title || room.title;
    announcement.textContent = `${room.title}に移動しました。`;
    void audio.setTrack(roomTrack(room));
    scrollRoom(record.url);
  });
  record.timeout = setTimeout(fail, 30000);
  const viewUrl = new URL(`views/${room.id}.html${url.search}`, appRoot);
  viewUrl.searchParams.set('v', new URL(import.meta.url).searchParams.get('v') || '1');
  frame.src = viewUrl.href;
  host.replaceChildren(frame);
  // The first room can request sound before its images finish loading.
  if (sequence === 1) void audio.setTrack(roomTrack(room));
}

window.__ManzokukyoSession = {
  attach(child) {
    const record = current;
    if (!record || child !== record.frame.contentWindow) return null;
    record.attached = true;
    const active = () => current === record && !record.controller.signal.aborted;
    const invoke = name => (...args) => active() ? audio[name](...args) : undefined;
    return {
      route: record.room.id,
      root: appRoot.href,
      state: () => audio.state(),
      navigate(href) { if (active()) navigate(href); },
      map(href) { return resolveRoom(href)?.url.href || null; },
      createSound(listener = {}) {
        if (active()) record.listeners.add(listener);
        queueMicrotask(() => { if (active()) listener.onChange?.(audio.state()); });
        return {
          enable: invoke('enable'), mute: invoke('mute'), play: invoke('play'),
          setMusicVolume: invoke('setMusicVolume'), setEffectsVolume: invoke('setEffectsVolume'),
          // Child documents disappear between rooms. Only the outer document owns suspension.
          silence() {}, pauseMusic() {}, resumeMusic() {},
          state: () => audio.state(),
          get enabled() { return audio.enabled; }, get consentGiven() { return audio.consentGiven; }
        };
      },
      registerTool(tool) {
        if (!active()) return;
        register({ ...tool, execute: (...args) => {
          if (!active()) throw Error('This room has been closed');
          return tool.execute(...args);
        } }, record.controller.signal);
      }
    };
  }
};
error.querySelector('[data-retry]').addEventListener('click', () => navigate(location.href, { historyMode: 'none', reload: true }));
window.addEventListener('popstate', () => navigate(location.href, { historyMode: 'none' }));
window.addEventListener('hashchange', () => navigate(location.href, { historyMode: 'none' }));
document.addEventListener('visibilitychange', () => { if (document.hidden) audio.silence(); else void audio.resumeMusic(); });
window.addEventListener('pagehide', () => audio.silence());
window.addEventListener('pageshow', event => { if (event.persisted) void audio.resumeMusic(); });
navigate(location.href, { historyMode: 'replace' });
