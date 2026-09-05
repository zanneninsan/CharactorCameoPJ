import * as THREE from '../vendor/three.module.js';

const STATES = new Set(['waiting', 'listening', 'denied', 'accepted']);
const DENIAL_DURATION = 2.8;
const clamp01 = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };

// All animation times below use active seconds, so a paused chamber cannot finish offscreen.
export function createTruthChamber(canvas, { onUnavailable, onFrame } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  } catch (error) {
    onUnavailable?.(error);
    return null;
  }
  renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151d28);
  scene.fog = new THREE.FogExp2(0x151d28, .023);
  const camera = new THREE.PerspectiveCamera(50, 1, .08, 70);
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduceMotion = motionQuery.matches;
  let disposed = false, lost = false, active = true, frameId = 0;
  let previousTime = null, elapsed = 0, stateAt = 0, state = 'waiting', denials = 0;
  let denialAt = -Infinity, denialFrom = 0, denialPeak = 1;
  let pointerX = 0, pointerY = 0, orbitAngle = 0, runes = ['', ''];
  const runeChangedAt = [-100, -100];
  const geometrySet = new Set(), materialSet = new Set(), textureSet = new Set();
  const geometryCache = new Map();
  const geometry = (key, factory) => {
    if (!geometryCache.has(key)) {
      const value = factory(); geometryCache.set(key, value); geometrySet.add(value);
    }
    return geometryCache.get(key);
  };
  const material = value => { materialSet.add(value); return value; };
  const standard = options => material(new THREE.MeshStandardMaterial(options));
  const basic = options => material(new THREE.MeshBasicMaterial(options));
  const stone = standard({ color: 0x4a505b, roughness: .88, metalness: .04 });
  const darkStone = standard({ color: 0x2c333e, roughness: .92 });
  const brass = standard({ color: 0xc3a66f, metalness: .7, roughness: .43 });
  const blackMetal = standard({ color: 0x242831, metalness: .58, roughness: .5 });
  const floor = standard({ color: 0x424a55, metalness: .22, roughness: .6 });
  const cyan = basic({ color: 0x8cd7ce });
  const rose = basic({ color: 0xd990a0 });
  const ivory = standard({ color: 0xd2c6ab, roughness: .69, metalness: .04 });

  function mesh(parent, shape, surface, position = [0, 0, 0]) {
    const object = new THREE.Mesh(shape, surface); object.position.set(...position); parent.add(object); return object;
  }
  function box(parent, size, position, surface) {
    return mesh(parent, geometry('box:' + size.join(':'), () => new THREE.BoxGeometry(...size)), surface, position);
  }
  function cylinder(parent, radius, height, position, surface, segments = 20) {
    return mesh(parent, geometry('cylinder:' + [radius, height, segments].join(':'), () => new THREE.CylinderGeometry(radius, radius, height, segments)), surface, position);
  }
  function ring(parent, radius, thickness, position, surface) {
    return mesh(parent, geometry('torus:' + radius + ':' + thickness, () => new THREE.TorusGeometry(radius, thickness, 8, 64)), surface, position);
  }
  function sphere(parent, radius, position, surface) {
    return mesh(parent, geometry('sphere:' + radius, () => new THREE.SphereGeometry(radius, 24, 16)), surface, position);
  }

  scene.add(new THREE.HemisphereLight(0xc4d9ee, 0x5e4238, 1.7));
  const highLight = new THREE.DirectionalLight(0xe9e2ce, 2);
  highLight.position.set(-5, 9, 8); scene.add(highLight);
  const tealLight = new THREE.PointLight(0x87d8cd, 26, 20, 2);
  tealLight.position.set(-3.6, 4.8, -4); scene.add(tealLight);
  const roseLight = new THREE.PointLight(0xd491a0, 21, 19, 2);
  roseLight.position.set(3.6, 4.5, -3); scene.add(roseLight);
  const doorwayLight = new THREE.PointLight(0xafdcd4, 28, 16, 2);
  doorwayLight.position.set(0, 4.6, -12.5); scene.add(doorwayLight);
  const nearLight = new THREE.PointLight(0xe6d7b7, 15, 16, 2);
  nearLight.position.set(0, 5.6, 5); scene.add(nearLight);

  // Shared meshes keep the stonework light enough for a phone.
  box(scene, [12.8, .38, 36], [0, -.25, -5], darkStone);
  const tileShape = geometry('floor-tile', () => new THREE.BoxGeometry(1.51, .07, 1.91));
  const tiles = new THREE.InstancedMesh(tileShape, floor, 8 * 18);
  const transform = new THREE.Object3D();
  let tileIndex = 0;
  for (let z = 0; z < 18; z++) for (let x = 0; x < 8; x++) {
    transform.position.set((x - 3.5) * 1.54, -.025, 11 - z * 1.94);
    transform.updateMatrix(); tiles.setMatrixAt(tileIndex++, transform.matrix);
  }
  scene.add(tiles);
  for (const side of [-1, 1]) {
    box(scene, [.4, 8.8, 36], [side * 6.35, 4.35, -5], darkStone);
    for (let course = 1; course <= 10; course++) box(scene, [.04, .035, 35.8], [side * 6.13, course * .8, -5], stone);
    box(scene, [.2, .14, 35.8], [side * 6.03, .22, -5], brass);
    box(scene, [.18, .065, 35.8], [side * 6.03, 4.5, -5], brass);
  }
  box(scene, [12.8, .3, 36], [0, 8.9, -5], darkStone);

  const archCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-5.45, 4.55, 0), new THREE.Vector3(-4.8, 6.1, 0),
    new THREE.Vector3(-2.9, 7.8, 0), new THREE.Vector3(0, 8.55, 0),
    new THREE.Vector3(2.9, 7.8, 0), new THREE.Vector3(4.8, 6.1, 0), new THREE.Vector3(5.45, 4.55, 0)
  ]);
  const archShape = geometry('arch', () => new THREE.TubeGeometry(archCurve, 56, .18, 8, false));
  const archTrim = geometry('arch-trim', () => new THREE.TubeGeometry(archCurve, 56, .025, 6, false));
  for (const z of [8.5, 3.8, -1.1, -6.2, -10.8, -17]) {
    mesh(scene, archShape, stone, [0, 0, z]);
    mesh(scene, archTrim, brass, [0, 0, z + .2]);
    for (const side of [-1, 1]) {
      cylinder(scene, .23, 4.5, [side * 5.45, 2.25, z], stone);
      box(scene, [.75, .19, .75], [side * 5.45, .12, z], blackMetal);
      box(scene, [.64, .14, .64], [side * 5.45, 4.48, z], brass);
      box(scene, [.1, 2.4, .065], [side * 5.22, 2.4, z + .24], brass);
      box(scene, [.17, .67, .23], [side * 5.12, 3.75, z + .12], blackMetal);
      box(scene, [.14, .38, .055], [side * 5.12, 3.75, z + .26], side < 0 ? cyan : rose);
    }
  }
  for (const [z, radius] of [[2.2, 2.8], [-2.3, 3.9], [-9.2, 2.4]]) {
    const inlay = new THREE.Group(); inlay.position.set(0, .025, z); scene.add(inlay);
    for (const r of [radius, radius - .16, radius * .52]) ring(inlay, r, .015, [0, .018, 0], brass).rotation.x = -Math.PI / 2;
    for (let index = 0; index < 16; index++) {
      const a = index * Math.PI / 8;
      const mark = box(inlay, [.032, .014, .18], [Math.sin(a) * (radius - .08), .027, Math.cos(a) * (radius - .08)], brass);
      mark.rotation.y = a;
    }
  }

  // The eye hangs above the line of travel, leaving the upper half readable behind the form.
  const eye = new THREE.Group(); eye.position.set(0, 4.9, -5); scene.add(eye);
  const eyeSupports = [-1.38, 1.38].map(x => ({ x, anchor: new THREE.Vector3(x, 8.275, -5), mesh: cylinder(scene, .022, 1, [x, 7.05, -5], brass, 10) }));
  const supportEnd = new THREE.Vector3(), supportDirection = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const outerRing = ring(eye, 1.53, .06, [0, 0, -.04], brass);
  const orbit = new THREE.Group(); eye.add(orbit);
  ring(orbit, 1.3, .024, [0, 0, .02], cyan);
  for (let index = 0; index < 12; index++) {
    const a = index * Math.PI / 6;
    const mark = box(orbit, [.025, .15, .045], [Math.sin(a) * 1.45, Math.cos(a) * 1.45, .06], index % 3 ? brass : rose);
    mark.rotation.z = -a;
  }
  const eyeFace = new THREE.Group(); eye.add(eyeFace);
  const eyeShape = new THREE.Shape();
  eyeShape.moveTo(-1.13, 0); eyeShape.quadraticCurveTo(0, .74, 1.13, 0);
  eyeShape.quadraticCurveTo(0, -.74, -1.13, 0);
  mesh(eyeFace, geometry('almond-eye', () => new THREE.ShapeGeometry(eyeShape, 40)), ivory, [0, 0, .035]);
  const outlinePoints = eyeShape.getPoints(48).map(p => new THREE.Vector3(p.x, p.y, .075));
  const outlineGeometry = geometry('eye-outline', () => new THREE.BufferGeometry().setFromPoints(outlinePoints));
  const outline = new THREE.LineLoop(outlineGeometry, material(new THREE.LineBasicMaterial({ color: 0xbc995e }))); eyeFace.add(outline);
  const iris = new THREE.Group(); iris.position.z = .1; eyeFace.add(iris);
  const irisMaterial = standard({ color: 0x3f9b90, emissive: 0x235e56, emissiveIntensity: .22, roughness: .55, metalness: .3 });
  ring(iris, .34, .087, [0, 0, 0], irisMaterial);
  const pupil = sphere(iris, .245, [0, 0, 0], blackMetal); pupil.scale.set(.64, 1.12, .2);
  const highlight = sphere(iris, .035, [-.07, .105, .072], cyan);
  const denialMaterial = basic({ color: 0xc69076, transparent: true, opacity: 0, depthWrite: false });
  const denialWave = ring(eye, 1.4, .022, [0, 0, .15], denialMaterial);
  denialWave.visible = false;

  // Two tactile stone blocks; canvas is used only to render the current two glyphs.
  const altar = new THREE.Group(); altar.position.set(0, 0, -1.7); scene.add(altar);
  box(altar, [3.8, .25, 1.6], [0, .15, 0], blackMetal);
  box(altar, [3.22, 1.15, 1.16], [0, .85, 0], stone);
  box(altar, [3.7, .2, 1.55], [0, 1.56, 0], brass);
  box(altar, [3.47, .08, 1.34], [0, 1.7, 0], blackMetal);
  const runeGroups = [], runeCanvases = [], runeTextures = [], pickables = [];
  for (let index = 0; index < 2; index++) {
    const group = new THREE.Group(); group.position.set(index ? .96 : -.96, 2.49, -1.7); scene.add(group);
    box(group, [1.17, 1.28, .45], [0, 0, 0], stone);
    for (const side of [-1, 1]) box(group, [.034, 1.17, .04], [side * .515, 0, .248], brass);
    for (const y of [-.54, .54]) box(group, [1.06, .033, .04], [0, y, .248], brass);
    const glyphCanvas = document.createElement('canvas'); glyphCanvas.width = 256; glyphCanvas.height = 256;
    const glyphTexture = new THREE.CanvasTexture(glyphCanvas); glyphTexture.colorSpace = THREE.SRGBColorSpace;
    textureSet.add(glyphTexture);
    const glyphMaterial = basic({ map: glyphTexture, transparent: true, depthWrite: false, color: 0xffe7b5 });
    mesh(group, geometry('rune-plane', () => new THREE.PlaneGeometry(1, 1)), glyphMaterial, [0, 0, .256]);
    group.traverse(object => { if (object.isMesh) { object.userData.runeIndex = index; pickables.push(object); } });
    runeGroups.push(group); runeCanvases.push(glyphCanvas); runeTextures.push(glyphTexture);
  }

  // The center really is a doorway: only its sides and lintel have stone behind the hinged leaves.
  const gate = new THREE.Group(); gate.position.z = -11; scene.add(gate);
  for (const side of [-1, 1]) {
    box(gate, [4.12, 8.8, .5], [side * 4.14, 4.4, -.3], darkStone);
    box(gate, [.3, 6.95, .66], [side * 2.16, 3.475, 0], stone);
    box(gate, [.05, 6.7, .72], [side * 2, 3.38, .05], brass);
  }
  box(gate, [4.05, 1.76, .5], [0, 7.92, -.3], darkStone);
  box(gate, [4.6, .25, .72], [0, 6.98, .04], stone);
  const hinges = [];
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group(); hinge.position.set(side * 1.97, 0, .2); gate.add(hinge); hinges.push(hinge);
    const cx = -side * .975;
    box(hinge, [1.95, 6.75, .2], [cx, 3.38, 0], blackMetal);
    for (const edge of [-.87, .87]) box(hinge, [.033, 6.43, .045], [cx + edge, 3.38, .14], brass);
    for (const y of [.2, 1.75, 4.95, 6.6]) box(hinge, [1.8, .035, .045], [cx, y, .14], brass);
    for (const tilt of [-1, 1]) {
      const diagonal = box(hinge, [.028, 3.55, .035], [cx, 3.38, .16], brass); diagonal.rotation.z = tilt * .36;
    }
    ring(hinge, .14, .032, [cx - side * .65, 3.15, .2], brass);
  }
  const emblemMaterial = basic({ color: 0xffffff, transparent: true, alphaTest: .02, depthWrite: false, toneMapped: false });
  const emblem = mesh(gate, geometry('emblem-plane', () => new THREE.PlaneGeometry(.84, .84 * 1312 / 1199)), emblemMaterial, [0, 7.63, .06]);
  emblem.visible = false;
  const loader = new THREE.TextureLoader();
  const emblemTexture = loader.load('../assets/emblem.webp', texture => {
    if (disposed) { texture.dispose(); return; }
    texture.colorSpace = THREE.SRGBColorSpace;
    emblemMaterial.map = texture; emblemMaterial.needsUpdate = true; emblem.visible = true;
  }, undefined, () => { /* The physical lintel remains visible if the decorative texture cannot load. */ });
  textureSet.add(emblemTexture);
  box(scene, [4, 6.6, .1], [0, 3.32, -23], basic({ color: 0x638781 }));
  for (const x of [-1.7, 1.7]) box(scene, [.04, 5.2, .04], [x, 2.8, -18.5], cyan);

  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const projected = new THREE.Vector3();
  const restingIrisColor = new THREE.Color(0x3f9b90), deniedIrisColor = new THREE.Color(0xad6d75);
  const viewport = { width: 1, height: 1 };
  function resize() {
    if (disposed || lost) return;
    const bounds = canvas.getBoundingClientRect();
    viewport.width = Math.max(1, bounds.width || window.innerWidth || 1);
    viewport.height = Math.max(1, bounds.height || window.innerHeight || 1);
    renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5));
    renderer.setSize(viewport.width, viewport.height, false);
    camera.aspect = viewport.width / viewport.height;
    camera.fov = camera.aspect < .85 ? 57 : 50;
    camera.updateProjectionMatrix();
    if (!active) draw(false);
  }
  function glyph(index, value) {
    const context = runeCanvases[index].getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, 256, 256);
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillStyle = '#ffffff';
    context.font = '600 168px "Noto Serif JP", "Yu Mincho", serif';
    const measured = context.measureText(value).width;
    if (measured > 214) context.font = '600 ' + Math.max(12, 168 * 214 / measured).toFixed(1) + 'px "Noto Serif JP", "Yu Mincho", serif';
    context.fillText(value, 128, 136, 214); runeTextures[index].needsUpdate = true;
  }
  function screenPoint(object) {
    object.getWorldPosition(projected); projected.project(camera);
    return { x: (projected.x * .5 + .5) * viewport.width, y: (-projected.y * .5 + .5) * viewport.height, visible: projected.z > -1 && projected.z < 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 };
  }
  function denialPressure() {
    const age = elapsed - denialAt;
    if (age < 0 || age >= DENIAL_DURATION) return 0;
    if (age < .18) return THREE.MathUtils.lerp(denialFrom, denialPeak, 1 - (1 - age / .18) ** 3);
    if (age < .64) return denialPeak;
    return denialPeak * (1 - smooth((age - .64) / (DENIAL_DURATION - .64)));
  }
  function draw(emit = true) {
    if (disposed || lost) return;
    const age = Math.max(0, elapsed - stateAt);
    const acceptedProgress = state === 'accepted' ? (reduceMotion ? 1 : smooth(age / 2.08)) : 0;
    const entrance = reduceMotion ? 1 : smooth(elapsed / 1.35);
    const baseZ = THREE.MathUtils.lerp(10.5, 8.2, entrance);
    const sway = reduceMotion || state === 'accepted' ? 0 : pointerX * .13;
    camera.position.set(sway, 3.3, THREE.MathUtils.lerp(baseZ, -8.2, acceptedProgress));
    camera.lookAt(sway * .28, 3.28 + (reduceMotion ? 0 : pointerY * .06), -18);
    const open = state === 'accepted' ? (reduceMotion ? 1 : smooth(age / 1.18)) : 0;
    hinges[0].rotation.y = -open * 1.35; hinges[1].rotation.y = open * 1.35;
    doorwayLight.intensity = 28 + open * 9;
    orbit.rotation.z = reduceMotion ? 0 : orbitAngle;
    outerRing.rotation.z = reduceMotion ? 0 : -elapsed * .035;
    const deniedAge = elapsed - denialAt;
    const denialActive = deniedAge >= 0 && deniedAge < DENIAL_DURATION;
    const pressure = denialPressure();
    const motionPressure = reduceMotion ? 0 : pressure;
    const gaze = reduceMotion ? Number(denialActive) : clamp01(pressure * 1.6);
    const blinkPhase = elapsed % 5.7;
    const blink = !reduceMotion && !denialActive && state !== 'accepted' && blinkPhase > 5.42 ? Math.sin((blinkPhase - 5.42) / .28 * Math.PI) : 0;
    const openness = reduceMotion ? (denialActive ? 1.4 : 1) : 1 + motionPressure * 1.35;
    eyeFace.scale.y = Math.max(.07, openness * (1 - blink * .93));
    iris.scale.y = 1 / openness;
    pupil.scale.x = THREE.MathUtils.lerp(.64, .3, gaze);
    irisMaterial.color.lerpColors(restingIrisColor, deniedIrisColor, reduceMotion ? gaze * .6 : clamp01(pressure));
    irisMaterial.emissiveIntensity = .22 + gaze * .38;
    iris.position.x = reduceMotion ? 0 : (pointerX * .12 + Math.sin(elapsed * .56) * .085) * (1 - gaze);
    iris.position.y = reduceMotion ? 0 : (-pointerY * .06 + Math.sin(elapsed * .37) * .032) * (1 - gaze);
    const listeningScale = !reduceMotion && state === 'listening' ? 1 + Math.sin(age * 2.1) * .018 : 1;
    const approachScale = camera.aspect < .85 ? .1 : .68;
    eye.scale.setScalar(THREE.MathUtils.lerp(listeningScale, 1, gaze) + motionPressure * approachScale);
    eye.position.set(0, 4.9 - motionPressure * .62, -5 + motionPressure * 5.4);
    outerRing.rotation.x = motionPressure * .13;
    orbit.rotation.y = motionPressure * .2;
    for (const support of eyeSupports) {
      supportEnd.set(support.x * eye.scale.x, eye.position.y + .925 * eye.scale.y, eye.position.z);
      supportDirection.subVectors(supportEnd, support.anchor);
      support.mesh.position.copy(support.anchor).add(supportEnd).multiplyScalar(.5);
      support.mesh.scale.y = supportDirection.length();
      support.mesh.quaternion.setFromUnitVectors(up, supportDirection.normalize());
    }
    highlight.visible = state !== 'accepted';
    denialWave.visible = motionPressure > .005;
    denialWave.scale.setScalar(1 + clamp01(deniedAge / DENIAL_DURATION) * .65);
    denialMaterial.opacity = motionPressure * .32;
    roseLight.intensity = 21 + (reduceMotion ? gaze * 6 : motionPressure * 30);
    tealLight.intensity = 26 + (!reduceMotion && state === 'listening' ? Math.sin(age * 1.3) * .6 : 0);
    for (let index = 0; index < runeGroups.length; index++) {
      const t = elapsed - runeChangedAt[index];
      const tap = !reduceMotion && t >= 0 && t < .5 ? Math.sin(t / .5 * Math.PI) : 0;
      runeGroups[index].rotation.y = (index ? -1 : 1) * tap * .16;
      runeGroups[index].position.y = 2.49 + tap * .055;
    }
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    renderer.render(scene, camera);
    if (emit) onFrame?.({ elapsed, state, denials, acceptedProgress, doorOpen: open, denial: { active: denialActive, pressure: motionPressure, openness, scale: eye.scale.x }, runestones: runeGroups.map(screenPoint), eye: screenPoint(eye) });
  }
  function tick(now) {
    if (!active || disposed || lost) return;
    const dt = previousTime === null ? 0 : Math.max(0, Math.min((now - previousTime) / 1000, .06));
    previousTime = now; elapsed += dt;
    if (!reduceMotion) orbitAngle += dt * (state === 'listening' ? .13 : .045);
    draw(); frameId = requestAnimationFrame(tick);
  }
  function pause() {
    active = false; previousTime = null; cancelAnimationFrame(frameId); frameId = 0;
  }
  function resume() {
    if (active || disposed || lost) return;
    active = true; previousTime = null; frameId = requestAnimationFrame(tick);
  }
  function onLoss(event) {
    event.preventDefault();
    if (disposed || lost) return;
    lost = true; pause(); onUnavailable?.(new Error('Truth chamber WebGL context was lost'));
  }
  function onMotionChange(event) {
    reduceMotion = event.matches;
    if (!active) draw(false);
  }
  window.addEventListener('resize', resize);
  canvas.addEventListener('webglcontextlost', onLoss);
  motionQuery.addEventListener?.('change', onMotionChange);
  resize();
  glyph(0, '？'); glyph(1, '？'); runes = ['？', '？'];
  draw(false);
  frameId = requestAnimationFrame(tick);

  return {
    setRunes(values) {
      if (disposed) return;
      if (!Array.isArray(values) || values.length !== 2 || values.some(value => typeof value !== 'string')) throw TypeError('setRunes expects exactly two strings');
      values.forEach((value, index) => {
        if (runes[index] === value) return;
        runes[index] = value; glyph(index, value); runeChangedAt[index] = elapsed;
      });
      if (!active) draw(false);
    },
    setState(nextState, nextDenials = 0) {
      if (disposed) return;
      if (!STATES.has(nextState)) throw TypeError('Unknown truth chamber state');
      denials = Number.isFinite(nextDenials) ? Math.max(0, Math.floor(nextDenials)) : 0;
      if (nextState === 'denied') {
        denialFrom = denialPressure(); denialPeak = 1 + Math.max(0, Math.min(denials, 3) - 1) * .06; denialAt = elapsed;
      } else if (nextState === 'accepted' || nextState === 'waiting') denialAt = -Infinity;
      state = nextState; stateAt = elapsed;
      draw(false);
    },
    setPointer(x, y) {
      pointerX = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
      pointerY = Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0;
    },
    hitTest(clientX, clientY) {
      if (disposed || lost || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height || clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return null;
      pointer.set((clientX - bounds.left) / bounds.width * 2 - 1, -(clientY - bounds.top) / bounds.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickables, false)[0];
      return hit && hit.distance < 24 ? hit.object.userData.runeIndex : null;
    },
    pause, resume,
    reset() {
      if (disposed) return;
      state = 'waiting'; denials = 0; elapsed = 0; stateAt = 0; previousTime = null;
      denialAt = -Infinity; denialFrom = 0; denialPeak = 1;
      pointerX = 0; pointerY = 0; orbitAngle = 0; runeChangedAt.fill(-100);
      draw(false);
    },
    dispose() {
      if (disposed) return;
      disposed = true; pause();
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('webglcontextlost', onLoss);
      motionQuery.removeEventListener?.('change', onMotionChange);
      tiles.dispose();
      for (const resource of geometrySet) resource.dispose();
      for (const resource of materialSet) resource.dispose();
      for (const resource of textureSet) resource.dispose();
      geometrySet.clear(); geometryCache.clear(); materialSet.clear(); textureSet.clear();
      scene.clear(); renderer.renderLists?.dispose(); renderer.dispose();
    }
  };
}
