import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let contexts = [], sources = [], fetches = [], deferred = new Map(), failDecode = new Set();
let serial = 0;
const urls = new Map();
const settle = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
const held = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
class Param {
  constructor(value = 1) { this.value = value; this.events = []; }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  setTargetAtTime(value, time, constant) { this.value = value; this.events.push(['target', value, time, constant]); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['linear', value, time]); }
}
class Node {
  connect(destination) { this.destination = destination; return destination; }
  disconnect() { this.disconnected = true; }
}
class Source extends Node {
  constructor(context) { super(); this.context = context; this.playbackRate = new Param(); this.listeners = {}; this.starts = 0; sources.push(this); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  start() { this.starts++; this.startTime = this.context.currentTime; }
  stop(time = this.context.currentTime) { this.stopTime = time; if (time <= this.context.currentTime) this.listeners.ended?.(); }
}
class Context {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = new Node(); this.listeners = {}; this.gains = []; contexts.push(this); }
  createGain() { const node = new Node(); node.gain = new Param(); this.gains.push(node); return node; }
  createDynamicsCompressor() { const node = new Node(); for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new Param(); return node; }
  createStereoPanner() { const node = new Node(); node.pan = new Param(0); return node; }
  createBufferSource() { return new Source(this); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  removeEventListener(name) { delete this.listeners[name]; }
  resume() {
    if (this.resumeHeld) return this.resumeHeld.promise.then(() => { this.state = 'running'; this.listeners.statechange?.(); });
    this.state = 'running'; this.listeners.statechange?.(); return Promise.resolve();
  }
  suspend() { this.state = 'suspended'; this.listeners.statechange?.(); return Promise.resolve(); }
  close() { this.state = 'closed'; this.listeners.statechange?.(); return Promise.resolve(); }
  async decodeAudioData(bytes) {
    const url = urls.get(new Uint32Array(bytes)[0]);
    if (failDecode.has(url)) throw Error('Unsupported codec');
    return { duration: 60, url };
  }
}
globalThis.window = { AudioContext: Context };
globalThis.document = { hidden: false };
globalThis.location = { href: 'https://example.test/preview/' };
globalThis.fetch = async input => {
  const url = String(input); fetches.push(url);
  if (deferred.has(url)) await deferred.get(url).promise;
  const id = ++serial; urls.set(id, url);
  return { ok: true, arrayBuffer: async () => new Uint32Array([id]).buffer };
};
const sourceText = await readFile(new URL('../content/static-sites/zannenin/manzokukyo-preview/audio-session.js', import.meta.url), 'utf8');
const { createSessionAudio } = await import(`data:text/javascript;base64,${Buffer.from(sourceText).toString('base64')}`);
const track = id => ({ id, label: id, sources: [`https://example.test/music/${id}.flac`, `https://example.test/music/${id}.mp3`] });
const music = () => sources.filter(source => source.loop);
const effects = () => sources.filter(source => !source.loop);

const reports = [], errors = [];
const session = createSessionAudio({ soundBase: 'https://example.test/preview/sounds/', onChange: value => reports.push(value), onError: value => errors.push(value) });
await session.setTrack(track('corridor'));
assert.equal(contexts.length, 0, 'selecting a track must not unlock audio');
assert.equal(fetches.length, 0, 'there is no music fetch before the first consent gesture');
assert.equal(session.consentGiven, false);
session.setMusicVolume(.42); session.setEffectsVolume(.71);
await session.enable(); await settle();
assert.equal(contexts.length, 1);
assert.equal(session.consentGiven, true);
assert.equal(session.state().enabled, true);
assert.equal(session.state().loadedEffects, 15);
assert.equal(music().length, 1);
assert.equal(session.state().track.id, 'corridor');
assert.equal(music()[0].loop, true);
assert.equal(music()[0].loopEnd, 60);

await session.setTrack(track('corridor')); await session.enable(); await settle();
assert.equal(music().length, 1, 'same track and repeated enable must preserve the current source');
assert.equal(contexts.length, 1);
assert.equal(fetches.filter(url => url.includes('/sounds/')).length, 15, 'effect files are loaded once');
const original = music()[0]; contexts[0].currentTime = 12;
session.mute();
assert.equal(session.state().enabled, false);
assert.equal(session.enabled, false);
assert.equal(session.consentGiven, true);
assert.equal(original.stopTime, undefined, 'mute suspends rather than destroys the music source');
assert.equal(session.play('tap'), undefined);
await session.setTrack(track('truth')); await settle();
assert.equal(music().length, 1, 'a room change while muted cannot start the new track');
assert.equal(session.state().requestedTrack.id, 'truth');
assert.equal(session.state().track.id, 'corridor');
assert.equal(session.state().musicVolume, .42);
assert.equal(session.state().effectsVolume, .71);
await session.resumeMusic();
assert.equal(contexts[0].state, 'suspended', 'visibility restoration does not override an explicit mute');
await session.enable(); await settle();
assert.equal(music().length, 2);
assert.equal(session.state().track.id, 'truth');
assert.equal(original.stopTime, 12.91, 'outgoing music crossfades for .9 seconds');
assert.equal(session.state().musicVolume, .42);
assert.equal(session.state().effectsVolume, .71);

const slow = track('slow'); deferred.set(slow.sources[0], held());
const pending = session.setTrack(slow);
await session.setTrack(track('latest')); await settle();
assert.equal(session.state().track.id, 'latest');
const countBeforeSlow = music().length;
deferred.get(slow.sources[0]).resolve(); await pending; await settle();
assert.equal(session.state().track.id, 'latest', 'a late decode cannot replace the newer room track');
assert.equal(music().length, countBeforeSlow);

const fallback = track('fallback'); failDecode.add(fallback.sources[0]);
await session.setTrack(fallback); await settle();
assert.equal(session.state().track.id, 'fallback');
assert.equal(music().at(-1).buffer.url, fallback.sources[1], 'unsupported FLAC falls back to MP3');

const cancel = session.play('truth-denied', { level: .6, rate: .85 });
assert.equal(typeof cancel, 'function');
cancel(); cancel();
assert.equal(effects().at(-1).stopTime, 12.03, 'effect cancellation uses a short fade');
for (let n = 0; n < 8; n++) session.play('tap');
assert.ok(effects().filter(source => source.stopTime === undefined).length <= 6, 'effect voices remain bounded');
session.stopEffects();
assert.ok(effects().every(source => source.stopTime !== undefined));

const activeBeforeHidden = music().at(-1);
document.hidden = true; session.silence();
assert.equal(session.enabled, true, 'background silence retains the listener preference');
assert.equal(session.state().enabled, false);
assert.equal(activeBeforeHidden.stopTime, undefined);
await session.setTrack(track('hidden-room')); await settle();
assert.equal(session.state().track.id, 'fallback');
await session.resumeMusic();
assert.equal(contexts[0].state, 'suspended');
document.hidden = false; await session.resumeMusic(); await settle();
assert.equal(session.state().track.id, 'hidden-room');
assert.equal(session.state().enabled, true);

// A delayed gesture resume cannot unmute a newer explicit mute.
contexts[0].resumeHeld = held();
const lateEnable = session.enable(); session.mute();
contexts[0].resumeHeld.resolve(); await lateEnable; await settle();
assert.equal(session.state().enabled, false);
assert.equal(session.enabled, false);
assert.equal(contexts[0].gains[2].gain.value, 0, 'master output is gated during late resume races');
assert.equal(contexts[0].state, 'suspended', 'a stale resume is suspended again to preserve music phase');
assert.equal(contexts.length, 1, 'all routes share one AudioContext');
assert.deepEqual(errors, []);
assert.ok(reports.length > 10);
session.dispose(); assert.equal(contexts[0].state, 'closed');
assert.equal(await session.enable(), false);

const retryErrors = [];
const retry = createSessionAudio({ onError: value => retryErrors.push(value) });
const workingResume = Context.prototype.resume;
Context.prototype.resume = () => Promise.reject(Error('Gesture rejected'));
assert.equal(await retry.enable(), false);
assert.equal(retry.enabled, false, 'failed enable leaves the next SOUND click free to retry');
assert.equal(retry.consentGiven, true);
assert.equal(retryErrors.length, 1);
Context.prototype.resume = workingResume;
assert.equal(await retry.enable(), true, 'one click can retry after enable fails');
retry.silence();
Context.prototype.resume = () => Promise.reject(Error('Resume rejected'));
assert.equal(await retry.resumeMusic(), false);
assert.equal(retry.enabled, false, 'failed automatic resume also leaves the next click free to retry');
Context.prototype.resume = workingResume;
retry.dispose();
console.log('PASS: one-context ownership; consent; same-track phase; mute and volumes; crossfade; stale loads; FLAC fallback; effect voice cap; visibility; late resume; disposal.');
