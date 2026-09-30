// 満足教大聖堂・懺悔室 配信ステージ（OBSブラウザソース 1920x1080）
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildConfessional } from './confessional.js';
import { Avatar } from './avatar.js';
import { Overlay } from './overlay.js';
import { DemoGame } from './game.js';
import { AudioEngine } from './audio.js';
import { MODES, SHOW, DEMO_SCRIPT, DEMO_COMMENTS, DEMO_NAMES, HYMN, GREETINGS } from './show.js';
import { DEMO_VOICE } from './demo-voice.js';

const params = new URLSearchParams(location.search);
// 公式サイトの公開版（サーバーなし）。ビルド時に window.STREAM_WORLD_STATIC を埋め込む
const staticMode = !!window.STREAM_WORLD_STATIC;
const stageEl = document.getElementById('stage');
if (params.has('obs')) document.body.classList.add('obs');
if (params.has('clean')) stageEl.classList.add('clean');

// ---------- 画面フィット ----------
// 枠（#frame）の実寸で合わせる。innerWidth はスマホでは舞台のはみ出しで広がってしまうので使わない
// 公開版では、更新の直後に「キャッシュに残った古いHTML＋新しいこのJS」の組み合わせになることがある。
// 古いHTMLには枠がないので、枠がなくても起動できるようにしておく
const frameEl = document.getElementById('frame');
function fit() {
  // 読み込み時にまだ大きさが決まっていない（非表示のタブ・OBSの非表示ソース等）ときや、枠がないときはウィンドウの大きさで代用する
  const w = frameEl?.clientWidth || innerWidth;
  const h = frameEl?.clientHeight || innerHeight;
  if (!w || !h) return;
  const s = Math.min(w / 1920, h / 1080);
  stageEl.style.transform = `translate(${(w - 1920 * s) / 2}px, ${(h - 1080 * s) / 2}px) scale(${s})`;
}
addEventListener('resize', fit);
addEventListener('orientationchange', fit);
visualViewport?.addEventListener('resize', fit);
// 枠の大きさが後から決まったり変わったりしたら合わせ直す
if (frameEl) new ResizeObserver(fit).observe(frameEl);
fit();

const overlay = new Overlay(stageEl);
const audio = new AudioEngine();
overlay.sfx = (name) => audio.play(name);
// コントロール内のプレビューや ?mute=1 では音を出さない
const muted = params.has('preview') || params.has('mute');

// ---------- レンダラー ----------
const canvas = document.getElementById('three');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Number(params.get('pr')) || 1);
renderer.setSize(1920, 1080, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1920 / 1080, 0.05, 60);
scene.add(camera);
// 右の懺悔箱に隠れないよう、人物を少し左（左右UIの中間）へ寄せて描画する
const VIEW_SHIFT = 60;
function applyViewShift(on) {
  if (on) camera.setViewOffset(1920, 1080, VIEW_SHIFT, 0, 1920, 1080);
  else camera.clearViewOffset();
}
applyViewShift(true);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1920, 1080), 0.55, 0.55, 0.8);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

// ---------- カメラ ----------
class CameraRig {
  constructor(cam) {
    this.cam = cam;
    this.pos = new THREE.Vector3(0, 2.1, 5.6);
    this.target = new THREE.Vector3(0, 1.7, -1.5);
    this.fov = 42;
    this.preset = 'wide';
    this.speed = 2.5;
    this.face = 1.35;
    this.handheld = 1;
  }

  presets(t) {
    const E = this.face;
    const a = Math.sin(t * 0.12) * 0.42;
    return {
      main: { pos: [0, E - 0.03, 1.62], target: [0, E - 0.14, 0], fov: 30 },
      close: { pos: [0, E + 0.01, 1.05], target: [0, E - 0.07, 0], fov: 30 },
      wide: { pos: [0, 2.1, 5.6], target: [0, 1.7, -1.5], fov: 42 },
      lattice: { pos: [-1.15, E - 0.05, 2.15], target: [0.08, E - 0.16, 0], fov: 28 },
      low: { pos: [0.5, 0.98, 1.7], target: [0, E - 0.08, 0], fov: 34 },
      side: { pos: [1.15, E + 0.02, 1.45], target: [0, E - 0.12, 0], fov: 30 },
      hymn: { pos: [Math.sin(a) * 2.25, E - 0.1 + Math.sin(t * 0.2) * 0.12, Math.cos(a) * 2.25], target: [0, E - 0.1, 0], fov: 32 },
      pip: { pos: [0, E + 0.01, 1.05], target: [0, E - 0.07, 0], fov: 30 },
    };
  }

  set(preset, { cut = false, speed = 2.5 } = {}) {
    this.preset = preset;
    this.speed = speed;
    if (cut) this.snap = true;
  }

  update(t, dt) {
    const p = this.presets(t)[this.preset] || this.presets(t).main;
    const tp = new THREE.Vector3(...p.pos);
    const tt = new THREE.Vector3(...p.target);
    const k = this.snap ? 1 : 1 - Math.exp(-dt * this.speed);
    this.snap = false;
    this.pos.lerp(tp, k);
    this.target.lerp(tt, k);
    this.fov += (p.fov - this.fov) * k;
    const h = this.handheld;
    const shake = new THREE.Vector3(Math.sin(t * 0.73) * 0.006 * h, Math.sin(t * 0.91 + 1) * 0.004 * h, 0);
    this.cam.position.copy(this.pos).add(shake);
    this.cam.fov = this.fov;
    this.cam.updateProjectionMatrix();
    this.cam.lookAt(this.target);
  }
}
const rig = new CameraRig(camera);

// ---------- 起動 ----------
let set;
const avatar = new Avatar(scene);
let game;
let currentMode = 'confession';
let modeBusy = false;

async function boot() {
  overlay.setLoading(0.05, '懺悔室の扉をひらいています…');
  const emblem = await loadImage('assets/emblem.png');
  set = buildConfessional(scene, renderer, emblem);
  game = new DemoGame(document.getElementById('game'), emblem);
  overlay.setLoading(0.15, '教祖さまをお呼びしています…');
  const vrmUrl = params.get('vrm') || 'model.vrm';
  try {
    await avatar.load(vrmUrl, (e) => {
      if (e.total) overlay.setLoading(0.15 + Math.min(1, e.loaded / e.total) * 0.8);
    });
    rig.face = avatar.headHeight + 0.05;
  } catch (err) {
    console.error(err);
    overlay.loadingError(staticMode
      ? `教祖さまをお呼びできませんでした。時間をおいて再読み込みしてください。\n${err.message || err}`
      : `VRMを読み込めませんでした（${vrmUrl}）。\nサーバー起動時に VRM_PATH を指定するか、?vrm=URL を付けてください。\n${err.message || err}`);
    return;
  }
  applyMode('confession');
  rig.set('wide', { cut: true });
  await soundGate();
  overlay.loadingDone();
  sendStageInfo();
  requestAnimationFrame(loop);
  if (initialState) applyState(initialState);
  ready = true;
  for (const msg of pendingMessages.splice(0)) dispatch(msg);
  if (params.has('demo') || staticMode) setTimeout(() => startDemo(staticMode || params.get('demo') === 'loop'), 600);
  else setTimeout(() => rig.set(MODES[currentMode].camera === 'pip' ? 'pip' : MODES[currentMode].camera, { speed: 1.2 }), 400);
}

const clock = new THREE.Clock();
let simTime = 0;
function step(dt) {
  simTime += dt;
  set.update(simTime, dt);
  rig.update(simTime, dt);
  avatar.update(dt, camera);
  bloom.strength = set.getBloom();
}
function loop() {
  step(Math.min(0.05, clock.getDelta()));
  composer.render();
  requestAnimationFrame(loop);
}

// ---------- 視聴者用の音量 ----------
// 音量は見ている人のブラウザだけに保存する（使えない環境では毎回既定値）
const VOLUME_KEY = 'zannenin-stream-world:volume';
const volumeEl = document.getElementById('volume');
const volSlider = document.getElementById('vol-slider');
let volumeState = { level: 1, muted: false };
try { Object.assign(volumeState, JSON.parse(localStorage.getItem(VOLUME_KEY)) || {}); } catch { /* 保存なし */ }
function applyVolume(save = true) {
  volSlider.value = volumeState.level;
  volumeEl.classList.toggle('muted', volumeState.muted || volumeState.level === 0);
  audio.setViewerVolume(volumeState.muted ? 0 : volumeState.level);
  if (save) { try { localStorage.setItem(VOLUME_KEY, JSON.stringify(volumeState)); } catch { /* 保存不可 */ } }
}
volSlider.addEventListener('input', () => {
  if (!audio.ready) audio.unlock();
  volumeState.level = Number(volSlider.value);
  volumeState.muted = false;
  applyVolume();
});
document.getElementById('vol-mute').addEventListener('click', async () => {
  if (!audio.ready) await audio.unlock();
  volumeState.muted = !volumeState.muted;
  applyVolume();
});
let volumeHide;
function showVolume() {
  volumeEl.classList.add('show');
  clearTimeout(volumeHide);
  volumeHide = setTimeout(() => volumeEl.classList.remove('show'), 2500);
}
addEventListener('pointermove', showVolume);
addEventListener('pointerdown', showVolume);
applyVolume(false);

// ---------- 音の許可 ----------
// ブラウザは操作なしに音を鳴らせないため、必要なときだけ「入堂」ボタンを出す（OBSでは自動で鳴る）
async function soundGate() {
  if (muted) return;
  if (await audio.unlock()) return;
  const gate = document.getElementById('sound-gate');
  gate.hidden = false;
  await new Promise((resolve) => {
    gate.querySelector('.enter').onclick = async () => { await audio.unlock(); resolve(); };
    gate.querySelector('.silent').onclick = () => resolve();
  });
  gate.hidden = true;
}

// ---------- 儀（モード） ----------
function applyMode(mode) {
  const m = MODES[mode];
  currentMode = mode;
  if (mode !== 'hymn') stopHymn();
  overlay.applyMode(mode);
  audio.setMode(mode);
  set.setLook(mode);
  set.screen.visible = false;
  applyViewShift(m.layout === 'full');
  rig.set(m.camera, { cut: true });
  if (mode === 'trial' && !params.has('obs')) { game.reset(); game.start(); } else game.stop();
  if (mode === 'sermon') overlay.renderSlide(0, false);
}

// 扉の演出中に届いた儀の指示は、最新のものだけ覚えておき、演出が終わってから反映する
let pendingMode = null;
async function setMode(mode, { instant = false } = {}) {
  if (!MODES[mode]) return;
  if (modeBusy) { pendingMode = { mode, instant }; return; }
  if (instant || mode === currentMode) { applyMode(mode); return; }
  modeBusy = true;
  try {
    await overlay.transition(mode, async () => applyMode(mode));
  } finally {
    modeBusy = false;
    const next = pendingMode;
    pendingMode = null;
    if (next && next.mode !== currentMode) setMode(next.mode, { instant: next.instant });
  }
}

function setCamera(preset) {
  set.screen.visible = preset === 'lattice';
  rig.set(preset, { speed: preset === 'hymn' ? 1.5 : 3 });
}

// ---------- 発話 ----------
let speechSeq = 0;
async function speak(msg) {
  const seq = ++speechSeq;
  const speaker = msg.speaker || SHOW.speaker;
  const resetExpression = () => { if (seq === speechSeq && msg.expression && !msg.hold) avatar.setExpression('neutral'); };
  // 声は1本だけ。聖歌の途中で話したら歌は止める（止めないと次の行が重なる）
  if (hymnActive) stopHymn();
  if (msg.expression) avatar.setExpression(msg.expression, msg.hold ?? 0);
  if (msg.gesture) avatar.playGesture(msg.gesture);
  // 音が許可されていない（音なしで見る・プレビュー）ときは文字口パクで話す
  if (msg.audioUrl && !muted && audio.ready) {
    const analyser = audio.playVoice(msg.audioUrl, {
      onStart: (d) => { if (seq === speechSeq) overlay.showSubtitle(msg.text || '', { speaker, duration: d * 0.9, hold: msg.holdSubtitle ?? 2.5 }); },
      onEnd: () => { if (seq === speechSeq) avatar.detachAudio(); resetExpression(); },
      // 音声が読めなかったら、そのセリフは文字口パクで話す
      onError: () => { if (seq === speechSeq) speak({ ...msg, audioUrl: undefined }); },
    });
    avatar.stopSpeaking();
    avatar.attachAudio(analyser);
    return;
  }
  audio.stopVoice();
  const dur = msg.duration || avatar.speakText(msg.text || '');
  audio.duckFor(dur);
  overlay.showSubtitle(msg.text || '', { speaker, duration: dur, hold: msg.holdSubtitle ?? 2.5 });
  setTimeout(resetExpression, (dur + 1.5) * 1000);
}

// ---------- 聖歌 ----------
// 録音済みの歌声（tools/generate-demo-voice.mjs で生成）があれば1行ずつ歌い、歌詞と口パクを歌声に合わせる。
// voice:false、音が許可されていない、歌声が未生成のときは、歌詞を時間で送り文字口パクで歌う
let hymnRun = 0;
let hymnActive = false;
function singHymn({ lines = HYMN.lines, secondsPerLine = HYMN.secondsPerLine, voice = true } = {}) {
  stopHymn();
  const run = ++hymnRun;
  hymnActive = true;
  const urls = (HYMN.sing || []).map((t) => DEMO_VOICE[t]?.src);
  const voiced = voice && !muted && audio.ready && lines === HYMN.lines && urls.length === lines.length && urls.every(Boolean);
  if (!voiced) {
    overlay.startLyrics(lines, secondsPerLine, (i, line, sec) => avatar.speakText(line, { rate: Math.max(3, [...line].length / (sec * 0.85)) }));
    hymnActive = false;
    return;
  }
  overlay.openLyrics();
  const next = (i) => {
    if (run !== hymnRun) return;
    if (i >= lines.length) { overlay.stopLyrics(); hymnActive = false; return; }
    let failed = false;
    const analyser = audio.playVoice(urls[i], {
      singing: true,
      onStart: (d) => { if (run === hymnRun) overlay.showLyricLine(lines, i, d); },
      onEnd: () => {
        if (run !== hymnRun || failed) return;
        avatar.detachAudio();
        setTimeout(() => next(i + 1), 550);
      },
      onError: () => {
        if (run !== hymnRun) return;
        failed = true;
        overlay.showLyricLine(lines, i, secondsPerLine * 0.92);
        avatar.speakText(lines[i], { rate: Math.max(3, [...lines[i]].length / (secondsPerLine * 0.85)) });
        setTimeout(() => next(i + 1), secondsPerLine * 1000);
      },
    });
    avatar.stopSpeaking();
    avatar.attachAudio(analyser);
  };
  next(0);
}

function stopHymn() {
  hymnRun++;
  hymnActive = false;
  overlay.stopLyrics();
  if (audio.singing) audio.stopVoice();
}

// ---------- デモ ----------
let demoTimers = [];
let ambientTimer = null;
// デモや弾幕の予約（止めたときにまとめて取り消す）
function later(fn, ms) {
  const id = setTimeout(() => { demoTimers = demoTimers.filter((x) => x !== id); fn(); }, ms);
  demoTimers.push(id);
}
function startDemo(loopDemo = false) {
  stopDemo();
  stopHymn();
  overlay.resetForDemo();
  overlay.setViewers(SHOW.viewers ?? 96);
  const total = DEMO_SCRIPT[DEMO_SCRIPT.length - 1][0] + 4;
  for (const [time, cmd] of DEMO_SCRIPT) {
    // デモのセリフは事前生成した声で話す
    const voiced = cmd.type === 'speak' && !cmd.audioUrl && DEMO_VOICE[cmd.text] ? { ...cmd, audioUrl: DEMO_VOICE[cmd.text].src } : cmd;
    demoTimers.push(setTimeout(() => dispatch(voiced), time * 1000));
  }
  if (loopDemo) demoTimers.push(setTimeout(() => startDemo(true), total * 1000));
  else demoTimers.push(setTimeout(() => clearTimeout(ambientTimer), total * 1000));
  const ambient = () => {
    if (!modeBusy) handle({ type: 'demo-comments', count: 1 });
    ambientTimer = setTimeout(ambient, 2600 + Math.random() * 2600);
  };
  ambientTimer = setTimeout(ambient, 6000);
}

function stopDemo() {
  demoTimers.forEach(clearTimeout);
  demoTimers = [];
  clearTimeout(ambientTimer);
}

// 操作パネルの「停止」: 予約だけでなく、流れている聖歌・セリフ・口パク・字幕も止める
function haltDemo() {
  stopDemo();
  stopHymn();
  speechSeq++;
  audio.stopVoice();
  avatar.stopSpeaking();
  avatar.detachAudio();
  overlay.clearSubtitle();
}

function demoComment() {
  const list = DEMO_COMMENTS[currentMode] || DEMO_COMMENTS.confession;
  return { name: DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)], text: list[Math.floor(Math.random() * list.length)] };
}

// ---------- 命令 ----------
async function handle(msg) {
  switch (msg.type) {
    case 'hello': if (set) applyState(msg.state); else initialState = msg.state; break;
    case 'mode': await setMode(msg.mode, { instant: msg.instant }); break;
    case 'camera': setCamera(msg.preset); break;
    case 'speak': speak(msg); break;
    case 'subtitle': overlay.showSubtitle(msg.text, { speaker: msg.speaker, duration: msg.duration || 0, hold: msg.hold ?? 0, kind: 'explicit' }); break;
    case 'subtitle-clear': overlay.clearSubtitle(); avatar.stopSpeaking(); audio.stopVoice(); break;
    case 'sound': audio.set(msg); break;
    case 'sfx': audio.play(msg.name); break;
    case 'expression': avatar.setExpression(msg.name, msg.hold || 0); break;
    case 'gesture': avatar.playGesture(msg.name); break;
    case 'mouth': avatar.setMouthLevel(msg.level, msg.vowel); break;
    case 'track': avatar.setTracking(msg); break;
    case 'tracking-options': applyTrackingOptions(msg.options); break;
    case 'comment': overlay.addComment(msg); break;
    case 'offering':
      overlay.showOffering(msg);
      avatar.setExpression('happy', 3);
      avatar.playGesture('nod');
      break;
    case 'poll-start': overlay.startPoll(msg); break;
    case 'poll-vote': overlay.vote(msg.option, msg.count || 1); break;
    case 'poll-votes': overlay.setVotes(msg.votes); break;
    case 'poll-end': overlay.endPoll(msg.winner); break;
    case 'slide': overlay.renderSlide(msg.index); break;
    case 'slide-next': overlay.renderSlide(overlay.slideIndex + 1); break;
    case 'slide-prev': overlay.renderSlide(overlay.slideIndex - 1); break;
    case 'slides-set': overlay.setSlides(msg.slides); break;
    case 'lyrics-start': singHymn(msg); break;
    case 'lyrics-stop': stopHymn(); break;
    case 'ticker': overlay.setTicker(msg.text); break;
    case 'program': overlay.setProgram(msg); break;
    case 'program-style': overlay.setProgramStyle(msg.style); break;
    case 'viewers': overlay.setViewers(msg.count); break;
    case 'demo-badge': overlay.setDemoBadge(msg.visible); break;
    case 'pose':
      if (typeof msg.bone === 'string' && Array.isArray(msg.rot) && msg.rot.length === 3 && msg.rot.every(Number.isFinite)) avatar.pose[msg.bone] = msg.rot;
      break;
    case 'demo-start': startDemo(!!msg.loop); break;
    case 'demo-stop': haltDemo(); break;
    case 'demo-comments':
      for (let i = 0; i < (msg.count || 1); i++) later(() => overlay.addComment(demoComment()), i * 900);
      break;
    case 'barrage': {
      // 挨拶の弾幕: 懺悔箱へ一気に流し込み、ときどき浮かぶ札にもする（投函音は間引く）
      const texts = msg.texts || GREETINGS[msg.kind] || GREETINGS.open;
      // 締めの弾幕のあとに雑談の見本コメントが混ざらないよう、見本の懺悔はここで止める
      if (msg.kind === 'close') clearTimeout(ambientTimer);
      const count = msg.count || 16;
      for (let i = 0; i < count; i++) {
        later(() => {
          const name = DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)];
          overlay.addComment({ name, text: texts[i % texts.length] }, { float: i % 4 === 1, silent: i % 5 !== 0 });
        }, i * (msg.interval || 0.18) * 1000);
      }
      break;
    }
    case 'demo-votes': {
      const steps = 10;
      for (let s = 1; s <= steps; s++) {
        later(() => overlay.setVotes(msg.votes.map((v) => Math.round((v * s) / steps))), (msg.duration * 1000 * s) / steps);
      }
      break;
    }
    case 'intro':
      if (currentMode !== 'confession') applyMode('confession');
      overlay.setTicker('ようこそ、満足教大聖堂の懺悔室へ');
      rig.set('wide', { cut: true });
      overlay.openingDoors();
      setTimeout(() => rig.set('main', { speed: 0.9 }), 900);
      break;
    case 'outro':
      overlay.setTicker('本日の懺悔室は閉堂いたしました　またのお越しを');
      rig.set('wide', { speed: 0.6 });
      break;
    default: break;
  }
}

// トラッキングの向きの設定は決まった値だけ受け付ける
function applyTrackingOptions(o) {
  if (!o || typeof o !== 'object') return;
  if (typeof o.mirror === 'boolean') avatar.trackingOptions.mirror = o.mirror;
  if (['head', 'upper', 'all'].includes(o.vmcBones)) avatar.trackingOptions.vmcBones = o.vmcBones;
  if (['vrm0', 'vrm1'].includes(o.vmcFlip)) avatar.trackingOptions.vmcFlip = o.vmcFlip;
}

let initialState = null;
let ready = false;
// 読み込み中に届いた命令（口パク・トラッキングのような高頻度のものは捨てる）
const pendingMessages = [];
function dispatch(msg) {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type !== 'hello' && !ready) {
    if (msg.type !== 'mouth' && msg.type !== 'track' && pendingMessages.length < 200) pendingMessages.push(msg);
    return;
  }
  Promise.resolve().then(() => handle(msg)).catch((err) => console.error('命令の処理に失敗しました', msg.type, err));
}

function applyState(state) {
  if (!state) return;
  if (MODES[state.mode] && state.mode !== currentMode) applyMode(state.mode);
  if (state.viewers != null) overlay.setViewers(state.viewers);
  if (state.demoBadge != null) overlay.setDemoBadge(state.demoBadge);
  if (state.ticker) overlay.setTicker(state.ticker.text);
  // サーバーの状態を正とする。無いもの（切断中に消された字幕・締め切られた神託）はこちらでも片付ける
  // 明示的に出した字幕を復元する（時間切れのものはサーバー側で除かれている）。セリフの字幕は消さない
  if (state.subtitle?.text) {
    const remaining = state.subtitle.until ? Math.max(0.5, (state.subtitle.until - Date.now()) / 1000) : 0;
    overlay.showSubtitle(state.subtitle.text, { speaker: state.subtitle.speaker, hold: remaining, kind: 'explicit' });
  } else if (overlay.subtitleKind === 'explicit') {
    overlay.clearSubtitle();
  }
  if (state.program) overlay.setProgram(state.program);
  if (Number.isInteger(state.slideIndex) && state.slideIndex !== overlay.slideIndex) overlay.renderSlide(state.slideIndex, false);
  if (state.camera) setCamera(state.camera);
  // 懺悔はサーバーが振った番号で重複を除く（再接続のたびに同じコメントが足されないように）
  for (const c of state.comments || []) overlay.addComment(c, { float: false, silent: true });
  if (state.sound) audio.set(state.sound);
  if (state.trackingOptions) applyTrackingOptions(state.trackingOptions);
  if (state.poll) { overlay.startPoll(state.poll, { silent: true }); overlay.setVotes(state.poll.votes); }
  else if (overlay.poll) overlay.hidePoll();
}

// ---------- 通信 ----------
let ws;
function connect() {
  if (location.protocol === 'file:' || staticMode) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    dispatch(msg);
  };
  // 再接続したらステージの情報を送り直す（コントロールの表示用）
  ws.onopen = () => { if (ready) sendStageInfo(); };
  ws.onclose = () => setTimeout(connect, 1500);
}
function sendStageInfo() {
  send({ type: 'stage-info', expressions: avatar.availableExpressions, headHeight: avatar.headHeight });
}
function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}
connect();

// ---------- キーボード（ステージ単体での確認用） ----------
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const keys = { 1: 'confession', 2: 'sermon', 3: 'hymn', 4: 'trial' };
  if (keys[e.key]) handle({ type: 'mode', mode: keys[e.key] });
  if (e.key === 'd') startDemo(false);
  if (e.key === 'ArrowRight') handle({ type: 'slide-next' });
  if (e.key === 'ArrowLeft') handle({ type: 'slide-prev' });
  if (e.key === 'c') handle({ type: 'comment', ...demoComment() });
  const cams = { q: 'main', w: 'close', e: 'wide', r: 'lattice', t: 'low', y: 'side' };
  if (cams[e.key]) handle({ type: 'camera', preset: cams[e.key] });
});

// 開発用: 描画結果の一部をサーバーへPNG保存する（__stage.snap('name', [x, y, w, h])）
async function snap(name = 'snap', rect = [0, 0, 1920, 1080], advance = 0) {
  if (staticMode) return null;
  // 背面タブでは rAF が止まるので、指定秒数ぶん手動で進めてから描画する
  for (let i = 0; i < Math.round(advance * 30); i++) step(1 / 30);
  step(1 / 60);
  composer.render();
  const c = document.createElement('canvas');
  c.width = rect[2];
  c.height = rect[3];
  c.getContext('2d').drawImage(canvas, rect[0], rect[1], rect[2], rect[3], 0, 0, rect[2], rect[3]);
  const r = await fetch(`/api/snap?name=${encodeURIComponent(name)}`, { method: 'POST', body: c.toDataURL('image/png') });
  return r.json();
}

// 開発用: BGMを儀ごとにオフラインで書き出して試聴ファイルにする（__stage.renderMusic(['confession', ...], 16)）
async function renderMusic(modes = ['confession', 'sermon', 'hymn', 'trial'], seconds = 16, name = 'bgm-preview') {
  if (staticMode) return null;
  const { GenerativeMusic } = await import('./music.js');
  const sr = 44100;
  const total = modes.length * seconds;
  const off = new OfflineAudioContext(2, sr * total, sr);
  const reverb = off.createConvolver();
  const len = sr * 3;
  const ir = off.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6; }
  reverb.buffer = ir;
  const wet = off.createGain();
  wet.gain.value = 0.55;
  reverb.connect(wet).connect(off.destination);
  const master = off.createGain();
  master.gain.value = 0.9 * 0.8;
  master.connect(off.destination);
  modes.forEach((mode, k) => {
    const g = off.createGain();
    g.gain.value = SOUND_LEVEL(mode);
    g.connect(master);
    const m = new GenerativeMusic(off, g, reverb);
    m.useMode(mode);
    m.out.gain.value = 0;
    m.out.gain.setValueAtTime(0, k * seconds);
    m.out.gain.linearRampToValueAtTime(1, k * seconds + 0.5);
    m.out.gain.setValueAtTime(1, (k + 1) * seconds - 0.8);
    m.out.gain.linearRampToValueAtTime(0, (k + 1) * seconds);
    m.nextTime = k * seconds;
    m.scheduleUntil((k + 1) * seconds - 0.8);
  });
  const buf = await off.startRendering();
  const wav = encodeWav(buf);
  const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(new Blob([wav], { type: 'audio/wav' })); });
  return fetch(`/api/snap?name=${encodeURIComponent(name)}&ext=wav`, { method: 'POST', body: dataUrl }).then((r) => r.json());
}
const SOUND_LEVEL = (mode) => ({ confession: 0.8, sermon: 0.65, hymn: 0.9, trial: 0.7 }[mode] ?? 0.8);
function encodeWav(buf) {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, sr, true);
  out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true); o += 2; }
  return out.buffer;
}

window.__stage = { handle, avatar, rig, set: () => set, scene, camera, renderer, snap, audio, renderMusic };
boot().catch((err) => {
  console.error(err);
  overlay.loadingError(`起動できませんでした。再読み込みしても直らない場合は、この画面を添えてお知らせください。
${err?.message || err}`);
});
