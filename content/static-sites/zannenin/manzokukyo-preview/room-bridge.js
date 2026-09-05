(() => {
  const root = new URL('./', document.currentScript.src);
  if (window === parent) {
    const paths = { corridor: '', truth: 'truth/', gallery: 'truth/gallery/', 'red-house': 'truth/red-house/', archive: 'truth/red-house/archive/', novel: 'novel/' };
    const id = location.pathname.split('/').pop().replace(/\.html$/, '');
    if (Object.hasOwn(paths, id)) location.replace(new URL(paths[id] + location.search + location.hash, root));
    return;
  }
  let connection;
  try { connection = parent.__ManzokukyoSession?.attach(window); } catch {}
  if (!connection) return;
  const sound = connection.createSound();
  window.ManzokukyoRoom = {
    ...connection,
    novelAudio(game) {
      const element = game.querySelector('[data-vn-audio]');
      if (element) { element.pause(); element.removeAttribute('src'); element.preload = 'none'; }
      return {
        play: () => sound.enabled ? Promise.resolve() : sound.enable().then(ok => { if (!ok) throw Error('Audio unavailable'); }),
        pause: () => sound.mute(),
        get volume() { return sound.state().musicVolume; },
        set volume(value) { sound.setMusicVolume(value); }
      };
    }
  };
  const sfxMap = { seal: 'portrait', success: 'offering-blessing', error: 'transmission', door: 'door-open' };
  // Legacy rooms use this facade instead of creating unmuted, private audio contexts.
  window.ManzokukyoSfx = { play: kind => sound.play(sfxMap[kind] || kind || 'tap', { level: .65 }) };
  function mapLink(link) {
    const raw = link.getAttribute('href');
    if (!raw || raw.startsWith('#') || link.hasAttribute('download') || link.hasAttribute('data-session-exit')) return;
    const mapped = connection.map(link.href);
    if (mapped) { if (mapped !== link.href) link.href = mapped; }
    else if (!link.target && /^https?:/.test(link.href)) link.target = '_top';
  }
  document.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    if (link.getAttribute('aria-disabled') === 'true') { event.preventDefault(); return; }
    // These doors navigate only after their existing animation and puzzle checks.
    if (link.matches('[data-gate], [data-gallery-exit]')) return;
    const raw = link.getAttribute('href');
    const mapped = raw.startsWith('#') ? connection.map(new URL(raw, document.baseURI).href) : connection.map(link.href);
    if (mapped) { event.preventDefault(); connection.navigate(mapped); }
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a[href]').forEach(mapLink);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') mapLink(record.target);
        else for (const node of record.addedNodes) if (node.nodeType === 1) {
          if (node.matches('a[href]')) mapLink(node);
          node.querySelectorAll('a[href]').forEach(mapLink);
        }
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    if (!document.body.hasAttribute('data-session-legacy')) return;
    // The gallery has its own consent, volume and precisely timed sound controls.
    if (document.querySelector('[data-gallery-experience]')) return;
    document.addEventListener('click', event => {
      const target = event.target.closest('[data-sfx],button,a');
      if (target && target.getAttribute('aria-disabled') !== 'true') window.ManzokukyoSfx.play(target.dataset.sfx || 'tap');
    }, { capture: true });
    if (document.querySelector('[data-vn-sound]')) return;
    const style = document.createElement('style');
    style.textContent = '.session-sound{position:fixed;right:16px;bottom:16px;z-index:500;border:1px solid #c9ad70;border-radius:12px;padding:10px 14px;background:#191c23ed;color:#f5e9cc;font:12px system-ui;box-shadow:0 4px 22px #0008}.session-sound button,.session-sound summary{cursor:pointer;color:inherit;font:inherit}.session-sound button{background:#373329;border:1px solid #b99b65;border-radius:20px;padding:8px 12px}.session-sound summary{padding:8px 0}.session-sound label{display:flex;align-items:center;gap:8px;padding:6px 0}.session-sound input{width:120px;accent-color:#dfbe75}.session-sound p{max-width:230px;line-height:1.6;margin:6px 0}.session-sound [hidden]{display:none}';
    document.head.append(style);
    const panel = document.createElement('aside'); panel.className = 'session-sound'; panel.setAttribute('aria-label', '音の設定');
    panel.innerHTML = '<p data-session-invite>この部屋を音と一緒に楽しみますか？</p><button type="button" data-session-toggle aria-pressed="false">SOUND OFF</button><button type="button" data-session-silent>音なしで進む</button><details><summary>音量</summary><label>BGM <input type="range" min="0" max="100" data-session-music aria-label="BGMの音量"></label><label>効果音 <input type="range" min="0" max="100" data-session-effects aria-label="効果音の音量"></label></details><p role="status" data-session-status></p>';
    document.body.append(panel);
    const toggle = panel.querySelector('[data-session-toggle]');
    const music = panel.querySelector('[data-session-music]');
    const effects = panel.querySelector('[data-session-effects]');
    const shared = connection.createSound({ onChange(state) {
      toggle.textContent = state.enabled ? 'SOUND ON' : 'SOUND OFF'; toggle.setAttribute('aria-pressed', String(state.enabled));
      music.value = Math.round(state.musicVolume * 100); effects.value = Math.round(state.effectsVolume * 100);
      panel.querySelector('[data-session-invite]').hidden = state.consentGiven;
      panel.querySelector('[data-session-silent]').hidden = state.consentGiven;
    }, onError(message) { panel.querySelector('[data-session-status]').textContent = message; } });
    toggle.addEventListener('click', () => { if (shared.enabled) shared.mute(); else void shared.enable(); });
    panel.querySelector('[data-session-silent]').addEventListener('click', () => shared.mute());
    music.addEventListener('input', () => shared.setMusicVolume(Number(music.value) / 100));
    effects.addEventListener('input', () => shared.setEffectsVolume(Number(effects.value) / 100));
    effects.addEventListener('change', () => shared.play('tap'));
  });
})();
