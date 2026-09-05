const soundFiles = ['tap', 'step-1', 'step-2', 'discover', 'projector', 'transmission', 'portrait', 'door-open', 'enter', 'offering-empty', 'offering-coin', 'offering-note', 'offering-blessing', 'offering-royal'];

export function createSound(audio, { onChange, onError }) {
  let context, effectsGain, enabled = false, requested = false, musicLevel = .28, effectsLevel = .65, decoded;
  let revision = 0;
  const buffers = new Map();
  const activeSources = new Set();
  const downloads = new Map(soundFiles.map(name => [name, fetch(`./sounds/${name}.wav`).then(response => {
    if (!response.ok) throw Error(`Sound ${name}: ${response.status}`);
    return response.arrayBuffer();
  }).catch(() => null)]));
  audio.volume = musicLevel;
  const notify = () => onChange?.({ enabled, musicPlaying: !audio.paused, effectsReady: Boolean(context?.state === 'running') });
  function ensureContext() {
    if (context) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    context = new AudioContext();
    effectsGain = context.createGain(); effectsGain.gain.value = effectsLevel;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -12; limiter.knee.value = 12; limiter.ratio.value = 4; limiter.attack.value = .005; limiter.release.value = .2;
    effectsGain.connect(limiter).connect(context.destination);
    context.addEventListener('statechange', notify);
    decoded = Promise.all(soundFiles.map(async name => {
      const bytes = await downloads.get(name);
      if (!bytes) return;
      try { buffers.set(name, await context.decodeAudioData(bytes)); } catch {}
    }));
  }
  function play(name, { level = 1, pan = 0, rate = 1 } = {}) {
    if (!enabled || !requested || document.hidden || !context || context.state !== 'running' || effectsLevel === 0) return;
    const buffer = buffers.get(name); if (!buffer) return;
    if (activeSources.size >= 6) { const oldest = activeSources.values().next().value; oldest.stop(); activeSources.delete(oldest); }
    const source = context.createBufferSource(); source.buffer = buffer; source.playbackRate.value = rate;
    const gain = context.createGain(); gain.gain.value = Math.max(0, Math.min(1, level));
    const panner = context.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(gain).connect(panner).connect(effectsGain);
    source.addEventListener('ended', () => { activeSources.delete(source); source.disconnect(); gain.disconnect(); panner.disconnect(); });
    activeSources.add(source); source.start();
    let cancelled = false;
    return () => {
      if (cancelled || !activeSources.has(source)) return;
      cancelled = true;
      gain.gain.cancelScheduledValues(context.currentTime);
      gain.gain.setTargetAtTime(0, context.currentTime, .006);
      try { source.stop(context.currentTime + .03); } catch {}
    };
  }
  async function enable() {
    requested = true;
    const attempt = ++revision;
    // Both unlock calls happen inside the original click, before the first await.
    let resume;
    try { ensureContext(); resume = context?.resume(); } catch { resume = Promise.reject(Error('Audio context unavailable')); }
    const music = audio.play();
    const results = await Promise.allSettled([resume, music]);
    if (attempt !== revision || document.hidden) return false;
    enabled = context?.state === 'running' || !audio.paused;
    requested = enabled;
    notify();
    if (!enabled) onError?.('音を再生できませんでした。右上のSOUNDから再度お試しください。');
    else if (results[1].status === 'rejected') onError?.('効果音はオンです。BGMの再生には失敗しました。');
    if (decoded) {
      await decoded;
      if (enabled && attempt === revision && !document.hidden) {
        if (buffers.size < soundFiles.length) onError?.('一部の効果音を読み込めませんでした。ページを再読み込みしてください。');
        play('enter', { level: .6 });
      }
    } else if (enabled) onError?.('BGMはオンです。この環境では効果音を再生できません。');
    return enabled;
  }
  function mute() {
    requested = false; enabled = false; silence(); notify();
  }
  function silence() {
    revision++; audio.pause();
    for (const source of activeSources) { try { source.stop(); } catch {} }
    activeSources.clear();
    context?.suspend().catch(() => {}); notify();
  }
  async function resumeMusic() {
    if (!requested || document.hidden) return;
    const attempt = ++revision;
    try { await Promise.all([context?.resume(), audio.play()]); }
    catch { onError?.('音の再開には右上のSOUNDを押してください。'); }
    if (attempt !== revision || document.hidden) return;
    enabled = context?.state === 'running' || !audio.paused;
    notify();
  }
  audio.addEventListener('play', notify);
  audio.addEventListener('pause', notify);
  audio.addEventListener('error', () => { if (enabled) onError?.('BGMを読み込めませんでした。効果音は引き続き利用できます。'); });
  return {
    enable, mute, play, resumeMusic,
    get enabled() { return requested; },
    pauseMusic() { audio.pause(); },
    setMusicVolume(value) { musicLevel = Math.max(0, Math.min(1, value)); audio.volume = musicLevel; },
    setEffectsVolume(value) { effectsLevel = Math.max(0, Math.min(1, value)); if (effectsGain) effectsGain.gain.setTargetAtTime(effectsLevel, context.currentTime, .03); },
    silence,
    state() { return { enabled, musicPlaying: !audio.paused, effectsReady: context?.state === 'running', loadedEffects: buffers.size, musicVolume: musicLevel, effectsVolume: effectsLevel }; }
  };
}
