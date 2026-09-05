const EFFECT_NAMES = ['tap', 'step-1', 'step-2', 'discover', 'projector', 'transmission', 'portrait', 'door-open', 'enter', 'offering-empty', 'offering-coin', 'offering-note', 'offering-blessing', 'offering-royal', 'truth-denied', 'gallery-reveal', 'gallery-collect', 'gallery-complete', 'gallery-unseal', 'gallery-door'];
const CROSSFADE_SECONDS = .9;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, Number.isFinite(Number(value)) ? Number(value) : low));

// The outer document owns this session. Room changes never recreate its context.
export function createSessionAudio({ soundBase, onChange, onError } = {}) {
  const base = new URL(soundBase || './sounds/', location.href);
  const abort = new AbortController();
  const effectBuffers = new Map();
  const trackBuffers = new Map();
  const effectVoices = new Set();
  const musicVoices = new Set();
  let context, effectsGain, musicGain, limiter, outputGain;
  let requested = false, consentGiven = false, silenced = false, disposed = false;
  let musicVolume = .28, effectsVolume = .65;
  let controlRevision = 0, trackRevision = 0;
  let requestedTrack = null, preparedTrack = null, currentTrack = null;
  let effectsLoading = null;

  const audible = () => !disposed && requested && !silenced && !document.hidden && context?.state === 'running';
  const publicTrack = track => track ? { id: track.id, label: track.label } : null;
  const state = () => ({
    enabled: audible(),
    musicPlaying: Boolean(audible() && currentTrack && musicVolume > 0),
    effectsReady: Boolean(audible() && effectBuffers.size),
    loadedEffects: effectBuffers.size,
    musicVolume,
    effectsVolume,
    consentGiven,
    track: publicTrack(currentTrack?.descriptor),
    requestedTrack: publicTrack(requestedTrack),
  });
  const notify = () => { if (!disposed) onChange?.(state()); };
  const error = message => { if (!disposed) onError?.(message); };

  function setOutput(open) {
    if (!outputGain) return;
    outputGain.gain.cancelScheduledValues(context.currentTime);
    if (open) outputGain.gain.setTargetAtTime(.85, context.currentTime, .025);
    else outputGain.gain.setValueAtTime(0, context.currentTime);
  }

  async function downloadAndDecode(url) {
    const response = await fetch(url, { signal: abort.signal });
    if (!response.ok) throw Error(`Audio: ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (disposed) throw Error('Audio session disposed');
    return context.decodeAudioData(bytes);
  }

  function loadEffects() {
    if (effectsLoading) return effectsLoading;
    effectsLoading = Promise.all(EFFECT_NAMES.map(async name => {
      try {
        const buffer = await downloadAndDecode(new URL(`${name}.wav`, base).href);
        if (!disposed) effectBuffers.set(name, buffer);
      } catch { /* Other effects and music remain usable if one file fails. */ }
    })).then(() => {
      notify();
      if (!disposed && requested && effectBuffers.size < EFFECT_NAMES.length) {
        error('一部の効果音を読み込めませんでした。音の設定はそのまま引き継ぎます。');
      }
    });
    return effectsLoading;
  }

  function contextChanged() {
    // A late resume must never make a muted or background session audible.
    if (audible()) {
      setOutput(true);
      reconcileMusic();
    } else {
      setOutput(false);
      if (!disposed && context.state === 'running' && (!requested || silenced || document.hidden)) {
        context.suspend().catch(() => {});
      }
    }
    notify();
  }

  function ensureContext() {
    if (context) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw Error('Web Audio unavailable');
    context = new Context();
    effectsGain = context.createGain(); effectsGain.gain.value = effectsVolume;
    musicGain = context.createGain(); musicGain.gain.value = musicVolume;
    limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -12; limiter.knee.value = 12; limiter.ratio.value = 4;
    limiter.attack.value = .005; limiter.release.value = .2;
    outputGain = context.createGain(); outputGain.gain.value = 0;
    effectsGain.connect(limiter); musicGain.connect(limiter);
    limiter.connect(outputGain).connect(context.destination);
    context.addEventListener('statechange', contextChanged);
    loadEffects();
  }

  function trackKey(track) {
    return JSON.stringify([track.id, track.sources]);
  }

  function loadTrack(track) {
    const key = trackKey(track);
    if (!trackBuffers.has(key)) {
      const loading = (async () => {
        for (const source of track.sources) {
          try { return await downloadAndDecode(source); }
          catch (failure) { if (disposed) throw failure; }
        }
        throw Error('No decodable music source');
      })();
      trackBuffers.set(key, loading);
      loading.catch(() => { if (trackBuffers.get(key) === loading) trackBuffers.delete(key); });
    }
    return trackBuffers.get(key);
  }

  function gainAt(voice, time) {
    if (time >= voice.rampEnd) return voice.to;
    if (time <= voice.rampStart) return voice.from;
    return voice.from + (voice.to - voice.from) * (time - voice.rampStart) / (voice.rampEnd - voice.rampStart);
  }

  function fadeVoice(voice, value, seconds) {
    const now = context.currentTime;
    const present = gainAt(voice, now);
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(present, now);
    voice.gain.gain.linearRampToValueAtTime(value, now + seconds);
    voice.from = present; voice.to = value; voice.rampStart = now; voice.rampEnd = now + seconds;
  }

  function retireVoice(voice, seconds = CROSSFADE_SECONDS) {
    fadeVoice(voice, 0, seconds);
    try { voice.source.stop(context.currentTime + seconds + .01); } catch {}
  }

  function reconcileMusic() {
    if (!audible() || !preparedTrack || preparedTrack.descriptor.id !== requestedTrack?.id) return;
    if (currentTrack?.descriptor.id === preparedTrack.descriptor.id) return;
    const now = context.currentTime;
    const source = context.createBufferSource(); source.buffer = preparedTrack.buffer;
    source.loop = true; source.loopStart = 0; source.loopEnd = preparedTrack.buffer.duration;
    const gain = context.createGain(); gain.gain.value = 0;
    const voice = { source, gain, descriptor: preparedTrack.descriptor, from: 0, to: 0, rampStart: now, rampEnd: now };
    source.connect(gain).connect(musicGain);
    source.addEventListener('ended', () => {
      musicVoices.delete(voice); source.disconnect(); gain.disconnect();
      if (currentTrack === voice) currentTrack = null;
      notify();
    });
    // Rapid room changes shorten obsolete tails; only the latest room fades in.
    for (const previous of musicVoices) retireVoice(previous, previous === currentTrack ? CROSSFADE_SECONDS : .03);
    musicVoices.add(voice); currentTrack = voice;
    source.start(); fadeVoice(voice, 1, CROSSFADE_SECONDS);
    notify();
  }

  async function prepareSelectedTrack() {
    if (!context || !requestedTrack || disposed) return false;
    const attempt = trackRevision;
    const selection = requestedTrack;
    if (currentTrack?.descriptor.id === selection.id) { notify(); return true; }
    try {
      const buffer = await loadTrack(selection);
      if (disposed || attempt !== trackRevision) return false;
      preparedTrack = { descriptor: selection, buffer };
      reconcileMusic(); notify();
      return true;
    } catch {
      if (!disposed && attempt === trackRevision) {
        error('この部屋のBGMを読み込めませんでした。効果音と音の設定は引き継ぎます。');
        notify();
      }
      return false;
    }
  }

  function setTrack(track) {
    if (disposed) return Promise.resolve(false);
    if (!track || typeof track.id !== 'string' || !track.id || !Array.isArray(track.sources) || !track.sources.length) {
      throw TypeError('A music track needs an id and sources.');
    }
    const selection = { id: track.id, label: String(track.label || track.id), sources: track.sources.map(source => new URL(source).href) };
    if (requestedTrack && trackKey(requestedTrack) === trackKey(selection)) return prepareSelectedTrack();
    requestedTrack = selection; preparedTrack = null; trackRevision++;
    notify();
    return prepareSelectedTrack();
  }

  function stopEffects() {
    for (const voice of effectVoices) {
      try { voice.source.stop(); } catch {}
    }
    effectVoices.clear();
  }

  function play(name, { level = 1, pan = 0, rate = 1 } = {}) {
    if (!audible() || effectsVolume === 0) return;
    const buffer = effectBuffers.get(name); if (!buffer) return;
    if (effectVoices.size >= 6) {
      const oldest = effectVoices.values().next().value;
      try { oldest.source.stop(); } catch {}
      effectVoices.delete(oldest);
    }
    const source = context.createBufferSource(); source.buffer = buffer;
    source.playbackRate.value = clamp(rate, .25, 4);
    const gain = context.createGain(); gain.gain.value = clamp(level);
    const panner = context.createStereoPanner ? context.createStereoPanner() : context.createGain();
    if (panner.pan) panner.pan.value = clamp(pan, -1, 1);
    source.connect(gain).connect(panner).connect(effectsGain);
    const voice = { source, gain, panner };
    source.addEventListener('ended', () => {
      effectVoices.delete(voice); source.disconnect(); gain.disconnect(); panner.disconnect();
    });
    effectVoices.add(voice); source.start();
    let cancelled = false;
    return () => {
      if (cancelled || disposed || !effectVoices.has(voice)) return;
      cancelled = true;
      gain.gain.cancelScheduledValues(context.currentTime);
      gain.gain.setTargetAtTime(0, context.currentTime, .006);
      try { source.stop(context.currentTime + .03); } catch {}
    };
  }

  async function enable() {
    if (disposed) return false;
    consentGiven = true; requested = true; silenced = false;
    const attempt = ++controlRevision;
    let resumed;
    // Construct and resume before any await, inside the user's original gesture.
    try { ensureContext(); resumed = context.resume(); }
    catch { resumed = Promise.reject(Error('Audio context unavailable')); }
    notify();
    try { await resumed; }
    catch {
      if (!disposed && attempt === controlRevision) {
        requested = false; silenced = true; setOutput(false);
        context?.suspend().catch(() => {}); notify();
        error('音を再生できませんでした。SOUNDからもう一度お試しください。');
      }
      return false;
    }
    if (disposed || attempt !== controlRevision) return false;
    if (!audible()) {
      if (!document.hidden && !silenced) {
        requested = false; setOutput(false); notify();
        error('音を再生できませんでした。SOUNDからもう一度お試しください。');
      }
      return false;
    }
    setOutput(true);
    reconcileMusic();
    void prepareSelectedTrack();
    notify();
    return true;
  }

  function silence() {
    if (disposed) return;
    silenced = true; controlRevision++;
    setOutput(false); stopEffects();
    context?.suspend().catch(() => {});
    notify();
  }

  function mute() {
    if (disposed) return;
    consentGiven = true; requested = false;
    silence();
  }

  async function resumeMusic() {
    if (disposed || !requested || document.hidden || !context) return false;
    silenced = false;
    const attempt = ++controlRevision;
    try { await context.resume(); }
    catch {
      if (!disposed && attempt === controlRevision) {
        requested = false; silenced = true; setOutput(false);
        context.suspend().catch(() => {}); notify();
        error('音の再開にはSOUNDを押してください。');
      }
      return false;
    }
    if (disposed || attempt !== controlRevision || !audible()) return false;
    setOutput(true); reconcileMusic(); void prepareSelectedTrack(); notify();
    return true;
  }

  function setMusicVolume(value) {
    if (disposed) return;
    musicVolume = clamp(value);
    if (musicGain) musicGain.gain.setTargetAtTime(musicVolume, context.currentTime, .03);
    notify();
  }

  function setEffectsVolume(value) {
    if (disposed) return;
    effectsVolume = clamp(value);
    if (effectsGain) effectsGain.gain.setTargetAtTime(effectsVolume, context.currentTime, .03);
    notify();
  }

  function dispose() {
    if (disposed) return;
    setOutput(false); stopEffects();
    disposed = true; controlRevision++; trackRevision++; abort.abort();
    context?.removeEventListener('statechange', contextChanged);
    for (const voice of musicVoices) { try { voice.source.stop(); } catch {} }
    musicVoices.clear(); effectBuffers.clear(); trackBuffers.clear();
    context?.close().catch(() => {});
  }

  return {
    enable, mute, play, setMusicVolume, setEffectsVolume, setTrack,
    silence, resumeMusic, stopEffects, state, dispose,
    get enabled() { return requested; },
    get consentGiven() { return consentGiven; },
  };
}
