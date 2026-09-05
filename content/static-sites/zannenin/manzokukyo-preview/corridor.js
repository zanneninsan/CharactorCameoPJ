import * as THREE from './vendor/three.module.js';
import { STOPS, TRAVEL_DISTANCE } from './route.js';

// A navigable space, with real camera translation and individually lit objects.
// Existing character artwork appears only inside an in-world frame.
export function createCorridor(canvas, { onFrame, onUnavailable }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x121922);
  scene.fog = new THREE.FogExp2(0x121922, .027);
  const camera = new THREE.PerspectiveCamera(54, 1, .08, 90);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const loader = new THREE.TextureLoader();
  const stone = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: .92, metalness: .05 });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x222931, roughness: .85 });
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x424750, roughness: .5, metalness: .18 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb99a60, metalness: .7, roughness: .42 });
  const blackMetal = new THREE.MeshStandardMaterial({ color: 0x22262a, metalness: .65, roughness: .42 });
  const ivory = new THREE.MeshStandardMaterial({ color: 0xc9c4b4, roughness: .75 });
  const warmGlow = new THREE.MeshBasicMaterial({ color: 0xffd698 });
  const cyanGlow = new THREE.MeshBasicMaterial({ color: 0x9dd4d7 });
  const materials = [stone, darkStone, floorMaterial, brass, blackMetal, ivory, warmGlow, cyanGlow];
  const geometries = new Map();
  const boxGeometry = (w, h, d) => {
    const key = `box:${w}:${h}:${d}`;
    if (!geometries.has(key)) geometries.set(key, new THREE.BoxGeometry(w, h, d));
    return geometries.get(key);
  };
  function box(parent, size, position, material) {
    const mesh = new THREE.Mesh(boxGeometry(...size), material);
    mesh.position.set(...position); parent.add(mesh); return mesh;
  }
  function cylinder(parent, radius, length, position, material, radial = 24) {
    const geometry = new THREE.CylinderGeometry(radius, radius, length, radial);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); parent.add(mesh); return mesh;
  }
  function sphere(parent, radius, position, material) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 10), material);
    mesh.position.set(...position); parent.add(mesh); return mesh;
  }
  function torus(parent, radius, thickness, position, material) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 8, 40), material);
    mesh.position.set(...position); parent.add(mesh); return mesh;
  }
  scene.add(new THREE.HemisphereLight(0xb5cce2, 0x443324, 1.65));
  const moon = new THREE.DirectionalLight(0xd5e3f4, 2.1); moon.position.set(-3, 7, 7); scene.add(moon);
  const lanterns = [];
  const doorZ = 4 - TRAVEL_DISTANCE - 7;
  const corridorLength = TRAVEL_DISTANCE + 20;
  const corridorCenter = 12 - corridorLength / 2;
  for (const z of [3, ...STOPS.map(stop => stop.z), doorZ]) {
    const light = new THREE.PointLight(0xffc88a, 18, 17, 2);
    light.position.set(STOPS.find(stop => stop.z === z)?.x || 0, 3.5, z);
    scene.add(light); lanterns.push(light);
  }
  const doorwayLight = new THREE.PointLight(0xb6dae0, 30, 14, 2); doorwayLight.position.set(0, 3.5, doorZ); scene.add(doorwayLight);
  const lamp = new THREE.PointLight(0xd8dfe5, 7, 13, 2); scene.add(lamp);

  // Stone courses, bronze inlays and repeated vaults create motion parallax.
  box(scene, [8.8, .4, corridorLength], [0, -.25, corridorCenter], darkStone);
  const tileRows = Math.ceil(corridorLength / 2.01);
  const tiles = new THREE.InstancedMesh(boxGeometry(1.29, .08, 1.99), floorMaterial, 6 * tileRows);
  const transform = new THREE.Object3D(); let tileIndex = 0;
  for (let row = 0; row < tileRows; row++) for (let col = 0; col < 6; col++) {
    transform.position.set((col - 2.5) * 1.31, -.025, 9 - row * 2.01);
    transform.updateMatrix(); tiles.setMatrixAt(tileIndex++, transform.matrix);
  }
  scene.add(tiles);
  for (const x of [-1.25, 1.25]) box(scene, [.025, .015, corridorLength], [x, .022, corridorCenter], brass);

  // Thin bronze fittings sit above the tile and rail surfaces, without coplanar decals.
  for (const z of [-2, ...STOPS.map(stop => stop.z + 3), doorZ + 4]) {
    const inlay = new THREE.Group(); inlay.position.set(0, .046, z); scene.add(inlay);
    for (const radius of [.98, .81, .19]) {
      const ring = torus(inlay, radius, .008, [0, 0, 0], brass); ring.rotation.x = -Math.PI / 2;
    }
    for (let index = 0; index < 12; index++) {
      const angle = index * Math.PI / 6;
      const mark = box(inlay, [.012, .008, .09], [Math.sin(angle) * .895, 0, Math.cos(angle) * .895], brass);
      mark.rotation.y = angle;
    }
    for (let index = 0; index < 4; index++) {
      const angle = Math.PI / 4 + index * Math.PI / 2;
      const edge = box(inlay, [.012, .008, .66], [Math.sin(angle) * .33, 0, Math.cos(angle) * .33], brass);
      edge.rotation.y = angle + Math.PI / 2;
    }
  }
  for (const side of [-1, 1]) {
    box(scene, [.35, 6.8, corridorLength], [side * 4.2, 3.3, corridorCenter], darkStone);
    for (let row = 0; row < 8; row++) {
      box(scene, [.045, .025, corridorLength], [side * 4, .35 + row * .7, corridorCenter], stone);
    }
    box(scene, [.45, .18, corridorLength], [side * 3.96, .12, corridorCenter], stone);
    box(scene, [.35, .12, corridorLength], [side * 3.99, 3.4, corridorCenter], brass);
  }
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-3.8, 3.3, 0), new THREE.Vector3(-3.45, 4.5, 0),
    new THREE.Vector3(-2.4, 5.35, 0), new THREE.Vector3(0, 6.65, 0),
    new THREE.Vector3(2.4, 5.35, 0), new THREE.Vector3(3.45, 4.5, 0), new THREE.Vector3(3.8, 3.3, 0)
  ]);
  const vaultGeometry = new THREE.TubeGeometry(curve, 48, .12, 8, false);
  const trimGeometry = new THREE.TubeGeometry(curve, 48, .028, 6, false);
  for (let z = 7; z >= doorZ - 2; z -= 4.4) {
    for (const side of [-1, 1]) {
      box(scene, [.3, 3.3, .36], [side * 3.8, 1.65, z], stone);
      box(scene, [.055, 3.4, .06], [side * 3.6, 1.7, z + .1], brass);
      box(scene, [.6, .23, .65], [side * 3.8, .17, z], darkStone);
      box(scene, [.5, .17, .55], [side * 3.8, 3.32, z], brass);
      box(scene, [.1, .55, .13], [side * 3.72, 2.05, z + .2], brass);
      box(scene, [.09, .3, .08], [side * 3.69, 2.15, z + .28], warmGlow);
    }
    const arch = new THREE.Mesh(vaultGeometry, stone); arch.position.z = z; scene.add(arch);
    const edge = new THREE.Mesh(trimGeometry, brass); edge.position.z = z + .14; scene.add(edge);
    box(scene, [2.52, .012, .018], [0, .025, z], brass);
  }
  box(scene, [8.7, .25, corridorLength], [0, 6.95, corridorCenter], darkStone);

  // Small wall ornaments remain separate from the interactive exhibit meshes.
  const watchers = [];
  const eyeOutline = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.22, 0, .052), new THREE.Vector3(-.11, .085, .052),
    new THREE.Vector3(0, .105, .052), new THREE.Vector3(.11, .085, .052),
    new THREE.Vector3(.22, 0, .052), new THREE.Vector3(.11, -.085, .052),
    new THREE.Vector3(0, -.105, .052), new THREE.Vector3(-.11, -.085, .052)
  ], true);
  const eyeOutlineGeometry = new THREE.TubeGeometry(eyeOutline, 48, .009, 6, true);
  for (let z = 4.8; z > doorZ + 2; z -= 13.2) {
    for (const side of [-1, 1]) {
      const medallion = new THREE.Group(); medallion.position.set(side * 3.955, 2.65, z);
      medallion.rotation.y = -side * Math.PI / 2; scene.add(medallion);
      const plate = cylinder(medallion, .31, .035, [0, 0, 0], blackMetal, 32); plate.rotation.x = Math.PI / 2;
      torus(medallion, .285, .012, [0, 0, .025], brass);
      medallion.add(new THREE.Mesh(eyeOutlineGeometry, brass));
      const eye = sphere(medallion, .105, [0, 0, .053], ivory); eye.scale.set(1, .66, .19);
      const pupil = new THREE.Group(); pupil.position.z = .079; medallion.add(pupil);
      const center = sphere(pupil, .04, [0, 0, 0], blackMetal); center.scale.z = .45;
      torus(pupil, .045, .006, [0, 0, .003], brass);
      sphere(pupil, .008, [-.012, .014, .019], ivory);
      watchers.push({ medallion, pupil });
    }
  }
  const gaze = new THREE.Vector3();

  const objects = {};
  const pickables = [];
  function station(id) {
    const { x, z } = STOPS.find(stop => stop.id === id);
    const group = new THREE.Group(); group.position.set(x, 0, z); scene.add(group);
    objects[id] = { group, position: new THREE.Vector3(x, 1.3, z), meshes: [] };
    box(group, [1.65, .15, 1.35], [0, .075, 0], blackMetal);
    box(group, [1.2, 1, .95], [0, .65, 0], stone);
    box(group, [1.42, .08, 1.15], [0, 1.19, 0], brass);
    return group;
  }
  const projector = station('projector');
  box(projector, [.85, .65, .55], [0, 1.66, 0], blackMetal);
  box(projector, [.68, .05, .5], [0, 1.33, 0], brass);
  const lens = cylinder(projector, .18, .33, [.34, 1.75, .43], brass); lens.rotation.x = Math.PI / 2;
  const glass = cylinder(projector, .145, .015, [.34, 1.75, .607], cyanGlow); glass.rotation.x = Math.PI / 2;
  const reels = [];
  for (const x of [-.38, .32]) {
    const reel = new THREE.Group(); reel.position.set(x, 2.17, .02); projector.add(reel); reels.push(reel);
    torus(reel, .31, .035, [0, 0, 0], brass);
    for (let i = 0; i < 6; i++) { const spoke = box(reel, [.5, .025, .025], [0, 0, 0], brass); spoke.rotation.z = i * Math.PI / 3; }
    sphere(reel, .065, [0, 0, 0], blackMetal);
  }
  // The small screen is physically framed and belongs to the projector station.
  const posterMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff }); materials.push(posterMaterial);
  loader.load('./assets/anime.webp', texture => { texture.colorSpace = THREE.SRGBColorSpace; posterMaterial.map = texture; posterMaterial.needsUpdate = true; }, undefined, () => {});
  box(projector, [1.98, 1.36, .1], [0, 2.96, -.3], brass);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.86, 1.24), posterMaterial); screen.position.set(0, 2.96, -.238); projector.add(screen);

  const radio = station('radio');
  box(radio, [1.25, .77, .5], [0, 1.64, 0], blackMetal);
  box(radio, [1.13, .65, .035], [0, 1.64, .27], brass);
  box(radio, [.55, .51, .035], [-.22, 1.65, .3], blackMetal);
  for (let i = 0; i < 9; i++) box(radio, [.49, .012, .015], [-.22, 1.43 + i * .05, .325], brass);
  for (const y of [1.45, 1.85]) {
    const dial = cylinder(radio, .095, .065, [.37, y, .34], blackMetal); dial.rotation.x = Math.PI / 2;
    box(radio, [.013, .1, .012], [.37, y, .38], ivory);
  }
  box(radio, [.32, .12, .015], [.34, 1.66, .31], cyanGlow);
  const aerial = cylinder(radio, .017, 1.25, [.4, 2.63, -.1], brass, 8); aerial.rotation.z = -.2;
  torus(radio, .39, .018, [0, 2.25, -.12], brass);

  const tiktok = station('tiktok');
  box(tiktok, [.12, .35, .14], [0, 1.4, 0], brass);
  box(tiktok, [1.295, 1.86, .18], [0, 2.4, 0], blackMetal);
  box(tiktok, [1.215, 1.78, .055], [0, 2.4, .11], brass);
  const shortScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.095, 1.46), posterMaterial);
  shortScreen.position.set(0, 2.44, .15); tiktok.add(shortScreen);
  // Match the supplied 3:4 artwork so the full portrait and peace sign remain visible.
  const shortMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff }); materials.push(shortMaterial);
  loader.load('./assets/tiktok-entry.webp', texture => { texture.colorSpace = THREE.SRGBColorSpace; shortMaterial.map = texture; shortMaterial.needsUpdate = true; }, undefined, () => {});
  shortScreen.material = shortMaterial;
  for (const x of [-.6475, .6475]) box(tiktok, [.014, 1.65, .025], [x, 2.4, .1], x < 0 ? cyanGlow : warmGlow);
  sphere(tiktok, .028, [0, 1.62, .16], cyanGlow);

  const games = station('games');
  box(games, [1.3, 1.65, .66], [0, 2.04, -.08], blackMetal);
  box(games, [1.2, .26, .76], [0, 1.6, .16], brass);
  box(games, [1.13, .035, .72], [0, 1.75, .17], blackMetal);
  box(games, [1.1, .8, .06], [0, 2.37, .29], brass);
  const gameScreenMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff }); materials.push(gameScreenMaterial);
  loader.load('./assets/game-screen.webp', texture => { texture.colorSpace = THREE.SRGBColorSpace; gameScreenMaterial.map = texture; gameScreenMaterial.needsUpdate = true; }, undefined, () => {});
  const gameScreen = new THREE.Mesh(new THREE.PlaneGeometry(.97, .65), gameScreenMaterial); gameScreen.position.set(0, 2.37, .335); games.add(gameScreen);
  const stick = cylinder(games, .025, .24, [-.31, 1.86, .35], brass, 12);
  sphere(games, .085, [-.31, 2, .35], blackMetal);
  for (let i = 0; i < 3; i++) cylinder(games, .07, .035, [.12 + i * .14, 1.79, .35], i % 2 ? warmGlow : cyanGlow, 16);
  box(games, [1.3, .22, .7], [0, 2.98, -.08], brass);
  box(games, [1.04, .1, .025], [0, 2.98, .29], warmGlow);

  const portrait = station('portrait');
  box(portrait, [1.72, 2.19, .17], [0, 2.27, -.08], blackMetal);
  const portraitMaterial = new THREE.MeshBasicMaterial({ color: 0xd4cabb }); materials.push(portraitMaterial);
  loader.load('./assets/profile.webp', texture => { texture.colorSpace = THREE.SRGBColorSpace; portraitMaterial.map = texture; portraitMaterial.needsUpdate = true; }, undefined, () => {});
  const picture = new THREE.Mesh(new THREE.PlaneGeometry(1.49, 1.95), portraitMaterial); picture.position.set(0, 2.27, .014); portrait.add(picture);
  for (const x of [-.8, .8]) box(portrait, [.09, 2.15, .13], [x, 2.27, .025], brass);
  for (const y of [1.23, 3.31]) box(portrait, [1.69, .09, .13], [0, y, .025], brass);

  // A small slotted box sits opposite the portrait, outside the numbered route stops.
  const offering = new THREE.Group(); offering.position.set(2.1, 0, -57); scene.add(offering);
  objects.offering = { group: offering, position: new THREE.Vector3(2.1, 1, -57), labelHeight: 1, meshes: [] };
  box(offering, [1.36, .1, 1.02], [0, .07, 0], blackMetal);
  box(offering, [1.2, .05, .86], [0, .145, 0], brass);
  for (const z of [-.3575, .3575]) box(offering, [1.15, .815, .065], [0, .5775, z], blackMetal);
  for (const x of [-.5425, .5425]) box(offering, [.065, .815, .65], [x, .5775, 0], blackMetal);
  box(offering, [1.02, .05, .65], [0, .2, 0], blackMetal);
  for (const x of [-.55, .55]) for (const z of [-.37, .4]) box(offering, [.03, .71, .035], [x, .54, z], brass);
  box(offering, [.86, .42, .018], [0, .54, .402], darkStone);
  for (const x of [-.26, 0, .26]) box(offering, [.015, .3, .016], [x, .54, .419], brass);
  // Four separate lid pieces leave a real central slot above the dark box interior.
  for (const z of [-.255, .255]) box(offering, [1.28, .055, .34], [0, 1.01, z], blackMetal);
  for (const x of [-.505, .505]) box(offering, [.27, .055, .17], [x, 1.01, 0], blackMetal);
  for (const z of [-.425, .425]) box(offering, [1.31, .035, .028], [0, 1.035, z], brass);
  for (const x of [-.64, .64]) box(offering, [.028, .035, .85], [x, 1.035, 0], brass);
  for (const z of [-.085, .085]) box(offering, [.74, .016, .018], [0, 1.043, z], brass);

  for (const object of Object.values(objects)) object.group.traverse(mesh => {
    if (mesh.isMesh) { mesh.userData.objectId = Object.keys(objects).find(id => objects[id] === object); pickables.push(mesh); }
  });

  // Real hinged door leaves reveal the lit void; the destination remains the existing page.
  const door = new THREE.Group(); door.position.set(0, 0, doorZ); scene.add(door);
  box(door, [8, 7, .5], [0, 3.5, -.3], darkStone);
  const voidMaterial = new THREE.MeshBasicMaterial({ color: 0x8daaaa }); materials.push(voidMaterial);
  box(door, [3.35, 4.95, .1], [0, 2.52, .02], voidMaterial);
  const hinges = [];
  for (const side of [-1, 1]) {
    box(door, [.21, 5.2, .4], [side * 1.8, 2.6, .24], stone);
    box(door, [.055, 5.1, .43], [side * 1.66, 2.6, .26], brass);
    const hinge = new THREE.Group(); hinge.position.set(side * 1.62, 0, .22); door.add(hinge); hinges.push(hinge);
    const cx = -side * .8;
    box(hinge, [1.59, 4.95, .18], [cx, 2.5, 0], blackMetal);
    for (const edge of [-.7, .7]) box(hinge, [.025, 4.66, .06], [cx + edge, 2.5, .12], brass);
    for (const y of [.2, 1.5, 3.5, 4.82]) box(hinge, [1.48, .035, .08], [cx, y, .13], brass);
    torus(hinge, .15, .032, [cx - side * .45, 2.1, .2], brass);
    const diagonal = box(hinge, [.024, 3.1, .04], [cx, 2.52, .14], brass); diagonal.rotation.z = side * .35;
  }
  box(door, [3.8, .21, .43], [0, 5.15, .24], stone);
  const emblemMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, alphaTest: .02, depthWrite: false, toneMapped: false });
  materials.push(emblemMaterial);
  const emblem = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), emblemMaterial);
  emblem.position.set(0, 5.95, .26); emblem.visible = false; door.add(emblem);
  loader.load('./assets/emblem.webp', texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    emblemMaterial.map = texture; emblemMaterial.needsUpdate = true;
    emblem.scale.y = texture.image.height / texture.image.width;
    emblem.visible = true;
  }, undefined, () => {});

  // Sparse, low contrast airborne dust provides depth without a full-screen image overlay.
  let seed = 17;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const dustGeometry = new THREE.BufferGeometry();
  const points = new Float32Array(240 * 3);
  for (let i = 0; i < 240; i++) { points[i * 3] = (random() - .5) * 7; points[i * 3 + 1] = random() * 5; points[i * 3 + 2] = 8 - random() * (TRAVEL_DISTANCE + 13); }
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xc8b58f, size: .017, transparent: true, opacity: .32, depthWrite: false })); scene.add(dust);

  let target = 0, current = 0, pointerX = 0, pointerY = 0, frame = 0, previousTime = 0, openingAt = 0, active = true;
  const raycaster = new THREE.Raycaster();
  const projected = new THREE.Vector3();
  const viewport = { width: 1, height: 1 };
  function resize() {
    viewport.width = window.innerWidth; viewport.height = window.innerHeight;
    renderer.setSize(viewport.width, viewport.height, false);
    camera.aspect = viewport.width / viewport.height;
    camera.fov = viewport.width < 650 ? 67 : 54; camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  function render(now) {
    if (!active) return;
    const dt = Math.min((now - previousTime) / 1000 || .016, .06); previousTime = now;
    const old = current;
    current = reducedMotion.matches ? target : THREE.MathUtils.lerp(current, target, 1 - Math.exp(-dt * 8));
    if (Math.abs(current - target) < .00002) current = target;
    const z = 4 - current * TRAVEL_DISTANCE;
    const nearest = STOPS.map(({ id }) => ({ id, object: objects[id], distance: z - objects[id].position.z })).filter(o => o.distance > 1 && o.distance < 15).sort((a, b) => Math.abs(a.distance - 7) - Math.abs(b.distance - 7))[0];
    const attention = nearest ? Math.exp(-Math.pow((nearest.distance - 7) / 4.3, 2)) : 0;
    const side = nearest ? nearest.object.position.x * attention : 0;
    const moving = Math.abs(current - old) > .00003;
    const bob = !reducedMotion.matches && moving ? Math.sin(current * 230) * .025 : 0;
    const sway = reducedMotion.matches ? 0 : pointerX * .065;
    camera.position.set(side * .16 + sway, 1.76 + bob, z);
    camera.lookAt(side * (viewport.width < 650 ? .85 : .53) + sway, 1.9 + (reducedMotion.matches ? 0 : pointerY * .04), z - 9);
    lamp.position.copy(camera.position); lamp.position.y = 2.8;
    if (!reducedMotion.matches) {
      reels.forEach((reel, index) => { reel.rotation.z = now * .00025 * (index ? -1 : 1); });
      dust.rotation.z = Math.sin(now * .00008) * .004;
    }
    lanterns.forEach((light, index) => {
      light.intensity = reducedMotion.matches ? 18 : 18 + Math.sin(now * .00055 + index * .45) * .65;
    });
    for (const { medallion, pupil } of watchers) {
      if (reducedMotion.matches) { pupil.position.set(0, 0, .079); continue; }
      const nearby = medallion.position.distanceTo(camera.position) < 11;
      gaze.copy(camera.position); medallion.worldToLocal(gaze);
      const x = nearby ? THREE.MathUtils.clamp(gaze.x / 8, -1, 1) * .027 : 0;
      const y = nearby ? THREE.MathUtils.clamp(gaze.y / 3, -1, 1) * .012 : 0;
      const ease = 1 - Math.exp(-dt * 3.5);
      pupil.position.x = THREE.MathUtils.lerp(pupil.position.x, x, ease);
      pupil.position.y = THREE.MathUtils.lerp(pupil.position.y, y, ease);
    }
    const opening = openingAt ? THREE.MathUtils.smoothstep((now - openingAt) / 1650, 0, 1) : 0;
    hinges[0].rotation.y = -opening * 1.16; hinges[1].rotation.y = opening * 1.16;
    doorwayLight.intensity = 30 + opening * 30;
    camera.updateMatrixWorld();
    const labels = {};
    for (const [id, object] of Object.entries(objects)) {
      projected.copy(object.position); projected.y = object.labelHeight ?? 1.05; projected.project(camera);
      const distance = z - object.position.z;
      labels[id] = { x: (projected.x * .5 + .5) * viewport.width, y: (-projected.y * .5 + .5) * viewport.height, visible: distance > 1.5 && distance < 13.5 && projected.z < 1 && Math.abs(projected.x) < 1.5 };
    }
    renderer.render(scene, camera);
    onFrame?.({ progress: current, moved: Math.abs(current - old) * TRAVEL_DISTANCE, labels, nearest: nearest?.id, now });
    frame = requestAnimationFrame(render);
  }
  frame = requestAnimationFrame(render);
  const onLoss = event => { event.preventDefault(); active = false; cancelAnimationFrame(frame); onUnavailable?.(); };
  canvas.addEventListener('webglcontextlost', onLoss);
  return {
    setProgress(value) { target = THREE.MathUtils.clamp(value, 0, 1); },
    setPointer(x, y) { pointerX = x; pointerY = y; },
    openDoor() { openingAt = performance.now(); },
    resetDoor() { openingAt = 0; },
    hitTest(x, y) {
      raycaster.setFromCamera(new THREE.Vector2(x / viewport.width * 2 - 1, -(y / viewport.height) * 2 + 1), camera);
      const hit = raycaster.intersectObjects(pickables, false)[0];
      return hit && hit.distance < 14 ? hit.object.userData.objectId : null;
    },
    pause() { active = false; cancelAnimationFrame(frame); },
    resume() { if (!active) { active = true; previousTime = performance.now(); frame = requestAnimationFrame(render); } },
    dispose() { active = false; cancelAnimationFrame(frame); window.removeEventListener('resize', resize); canvas.removeEventListener('webglcontextlost', onLoss); renderer.dispose(); scene.traverse(o => { o.geometry?.dispose(); }); materials.forEach(m => { m.map?.dispose(); m.dispose(); }); }
  };
}
