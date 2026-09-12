// A single gallery visitor. Route decisions are independent of anomaly/seal RNG.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const angle = value => Math.atan2(Math.sin(value), Math.cos(value));
export const visitorBounds = { left: -3.35, right: 3.35, back: -59, front: -2.3 };
export function createVisitorState({ x = 1.65, z = -5.4, wait = 2.5 } = {}) {
  return { x, z, yaw: Math.PI, targetX: x, targetZ: z, lookX: 0, lookZ: .8, wait, phase: 0, speed: 0, behavior: 'resting', decisions: 0, blocked: 0 };
}
function chooseDestination(state, random) {
  const nextZ = clamp(state.z + (random() - .5) * 25, visitorBounds.back, visitorBounds.front);
  if (random() < .7) {
    const room = clamp(Math.floor((2 - nextZ) / 16), 0, 3);
    const slot = Math.floor(random() * 3);
    state.targetZ = room === 0 ? -4.8 - slot * 3.6 : -3 - slot * 4.5 - room * 16;
    state.targetX = random() < .5 ? -3.25 : 3.25;
    state.lookX = Math.sign(state.targetX) * 5.13; state.lookZ = state.targetZ;
  } else {
    state.targetX = (random() - .5) * 5.7; state.targetZ = nextZ;
    state.lookX = -state.targetX; state.lookZ = nextZ - 3;
  }
  state.behavior = 'walking'; state.decisions++; state.blocked = 0;
}
export function advanceVisitor(state, seconds, viewer, random = Math.random) {
  const dt = clamp(Number.isFinite(seconds) ? seconds : 0, 0, .05);
  if (!dt) return state;
  state.phase += dt;
  if (state.wait > 0) {
    state.wait = Math.max(0, state.wait - dt); state.speed *= Math.exp(-dt * 10);
    const dx = state.lookX - state.x, dz = state.lookZ - state.z;
    state.yaw += angle(Math.atan2(-dx, -dz) - state.yaw) * (1 - Math.exp(-dt * 2));
    if (!state.wait) chooseDestination(state, random);
    return state;
  }
  let dx = state.targetX - state.x, dz = state.targetZ - state.z;
  const distance = Math.hypot(dx, dz);
  if (distance < .12) {
    state.wait = 2.5 + random() * 4.5; state.behavior = 'looking'; state.speed = 0; return state;
  }
  dx /= distance; dz /= distance;
  const vx = state.x - viewer.x, vz = state.z - viewer.z, viewerDistance = Math.hypot(vx, vz);
  // Yield near the visitor; players retain unrestricted WASD/door movement.
  if (viewerDistance < 1.05) {
    state.speed *= Math.exp(-dt * 10); state.blocked += dt; state.behavior = 'yielding';
    state.yaw += angle(Math.atan2(vx, vz) - state.yaw) * (1 - Math.exp(-dt * 2));
    if (state.blocked > 3) { chooseDestination(state, random); state.wait = 1; }
    return state;
  }
  if (viewerDistance < 2) {
    const strength = (2 - viewerDistance) * 1.8;
    dx += vx / viewerDistance * strength; dz += vz / viewerDistance * strength;
    const length = Math.hypot(dx, dz) || 1; dx /= length; dz /= length;
  }
  state.behavior = 'walking'; state.blocked = 0;
  const heading = Math.atan2(-dx, -dz);
  const turn = angle(heading - state.yaw);
  state.yaw = angle(state.yaw + clamp(turn, -dt * 1.9, dt * 1.9));
  const desiredSpeed = Math.abs(turn) > 1 ? .1 : .62;
  state.speed += (desiredSpeed - state.speed) * (1 - Math.exp(-dt * 5));
  const step = Math.min(distance, state.speed * dt);
  state.x = clamp(state.x + dx * step, visitorBounds.left, visitorBounds.right);
  state.z = clamp(state.z + dz * step, visitorBounds.back, visitorBounds.front);
  return state;
}

export async function loadGalleryVisitor(T, { scene, url, Loader, kind = 'darenin' }) {
  const GLTFLoader = Loader || (await import(new URL('../../manzokukyo-preview/vendor/GLTFLoader.js', import.meta.url))).GLTFLoader;
  const gltf = await new GLTFLoader().loadAsync(url.href);
  return createGalleryVisitor(T, { scene, figure: gltf.scene, kind });
}

function createGalleryVisitor(T, { scene, figure, kind = 'darenin', spawn, sharedFinish }) {
  const official = kind === 'zannenin';
  const root = new T.Group(); root.name = official ? 'Zannenin gallery visitor' : 'Darenin gallery visitor';
  const resources = new Set();
  const finish = official ? null : sharedFinish || new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  if (finish && !sharedFinish) resources.add(finish);
  const bones = {}, blinkMeshes = [], bitmaps = new Set(), skeletons = new Set();
  let draws = 0;
  figure.traverse(object => {
    if (object.isBone) bones[object.name] = object;
    if (!object.isMesh) return;
    draws += Array.isArray(object.material) ? object.geometry.groups.length : 1;
    if (official) {
      for (const material of [object.material].flat()) {
        material.toneMapped = false; material.forceSinglePass = true; resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) { resources.add(value); if (value.image?.close) bitmaps.add(value.image); }
      }
    } else {
      if (!sharedFinish) for (const material of [object.material].flat()) material.dispose();
      object.material = finish;
    }
    if (!sharedFinish) resources.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    if (object.morphTargetDictionary?.Blink !== undefined) blinkMeshes.push(object);
    // Quantized skin bounds change with the rig. Cull the whole visitor below
    // instead of recalculating every skinned mesh's bounds every frame.
    object.frustumCulled = false;
  });
  figure.updateMatrixWorld(true);
  figure.traverse(object => { if (object.isSkinnedMesh) object.skeleton.update(); });
  const bounds = new T.Box3().setFromObject(figure);
  const scale = 1.95 / (bounds.max.y - bounds.min.y);
  figure.scale.multiplyScalar(scale); figure.position.y = .045 - bounds.min.y * scale;
  root.add(figure);
  // A soft contact shadow needs no shadow map or extra lights.
  const shadowGeometry = new T.PlaneGeometry(1.3, .9);
  const shadowMaterial = new T.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: {},
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec2 vUv; void main(){float r=length((vUv-.5)*2.0); gl_FragColor=vec4(.03,.035,.04,.22*(1.0-smoothstep(.1,1.0,r)));}',
  });
  resources.add(shadowGeometry); resources.add(shadowMaterial);
  const shadow = new T.Mesh(shadowGeometry, shadowMaterial); shadow.rotation.x = -Math.PI / 2; shadow.position.y = .04; root.add(shadow);
  scene.add(root);
  let state = createVisitorState(spawn), gait = 0, walkingWeight = 0, enabled = true, visible = false, disposed = false;
  const frustum = new T.Frustum(), projection = new T.Matrix4(), sphere = new T.Sphere(new T.Vector3(), 1.3);
  const bind = Object.fromEntries(Object.entries(bones).map(([name, bone]) => [name, bone.rotation.clone()]));
  const hairBones = official ? Object.keys(bones).filter(name => /^J_Sec_Hair\d+_02$/.test(name)) : [];
  function rotate(name, axis, radians) { const bone = bones[name]; if (bone) bone.rotation[axis] = bind[name][axis] + radians; }
  function pose(dt, viewer, running = false) {
    gait += (running ? Math.min(state.speed, 1) * 12 : state.speed * 10) * dt;
    const speedWeight = clamp(state.speed / .62, 0, 1);
    walkingWeight += (speedWeight - walkingWeight) * (1 - Math.exp(-dt * 8));
    const stride = official ? walkingWeight : speedWeight, swing = Math.sin(gait) * stride;
    for (const [side, sign] of [['L', 1], ['R', -1]]) {
      rotate(`J_Bip_${side}_UpperLeg`, 'x', swing * (running ? .66 : .24) * sign);
      rotate(`J_Bip_${side}_LowerLeg`, 'x', Math.max(0, -swing * sign) * (official ? -.32 : running ? .8 : .28));
      rotate(`J_Bip_${side}_UpperArm`, 'x', -swing * (running ? .58 : official ? .15 : .18) * sign);
      if (official) {
        // This VRoid rig's arms extend along local X. Z lowers the shoulder;
        // mirrored Y bends the elbow forward. X at the elbow only twists it.
        rotate(`J_Bip_${side}_UpperArm`, 'z', sign * (1.36 + Math.cos(gait * 2) * stride * .012));
        rotate(`J_Bip_${side}_LowerArm`, 'y', -sign * (.16 + Math.max(0, swing * sign) * .07));
        rotate(`J_Bip_${side}_Hand`, 'z', sign * .035);
        rotate(`J_Bip_${side}_Foot`, 'x', Math.max(0, -swing * sign) * .1);
      } else {
        rotate(`J_Bip_${side}_LowerArm`, 'x', (running ? -.6 : -.06) - Math.max(0, swing * sign) * .08);
      }
      rotate(`J_Sec_${side}_TwinTail`, 'z', Math.sin(state.phase * 2.4 + sign) * .025 * (stride + .2));
    }
    rotate('J_Bip_C_Spine', 'z', swing * .016);
    rotate('J_Bip_C_Spine', 'x', running ? -.13 * stride : 0);
    if (official) {
      rotate('J_Bip_C_Hips', 'y', swing * .025);
      rotate('J_Bip_C_Chest', 'y', -swing * .035);
    }
    const viewerDistance = Math.hypot(viewer.x - state.x, viewer.z - state.z);
    const headTurn = viewerDistance < 5 ? clamp(angle(Math.atan2(state.x - viewer.x, state.z - viewer.z) - state.yaw), -.45, .45) : Math.sin(state.phase * .55) * .12;
    rotate('J_Bip_C_Head', 'y', headTurn);
    for (const [index, name] of hairBones.entries()) rotate(name, 'x', Math.sin(state.phase * 2.1 + index * .6) * .018 * (stride + .15));
    const blinkPhase = state.phase % 5.3;
    const blink = blinkPhase > 4.95 ? Math.sin((blinkPhase - 4.95) / .35 * Math.PI) : 0;
    for (const mesh of blinkMeshes) mesh.morphTargetInfluences[mesh.morphTargetDictionary.Blink] = blink;
    root.position.set(state.x, Math.abs(Math.sin(gait)) * stride * (running ? .045 : .012), state.z); root.rotation.y = state.yaw;
  }
  const api = {
    update(dt, viewer, { paused = false, reduced = false, inspecting = false, camera, formation } = {}) {
      if (disposed) return false;
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, .05);
      if (enabled && !paused && !inspecting) {
        if (formation) {
          Object.assign(state, formation, { behavior: formation.speed ? 'running' : 'watching' });
          if (!reduced) state.phase += clamp(Number.isFinite(dt) ? dt : 0, 0, .05);
          pose(reduced ? 0 : dt, viewer, true);
        } else if (!reduced) { advanceVisitor(state, dt, viewer); pose(dt, viewer); }
      }
      const distance = Math.hypot(viewer.x - state.x, viewer.z - state.z);
      visible = enabled && !inspecting && distance > .7 && distance < (formation ? 70 : 30);
      if (visible && camera) {
        camera.updateMatrixWorld(); projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projection); sphere.center.set(state.x, 1, state.z);
        visible = frustum.intersectsSphere(sphere);
      }
      root.visible = visible;
      return enabled && !paused && !reduced && !inspecting;
    },
    reset() { state = createVisitorState(spawn); gait = 0; walkingWeight = 0; pose(0, { x: 0, z: .8 }); },
    setEnabled(value) { enabled = value; visible = enabled; root.visible = enabled; },
    isVisible: () => visible,
    snapshot: () => ({ loaded: true, kind, enabled, visible, behavior: state.behavior, position: [state.x, state.z], yaw: state.yaw, decisions: state.decisions, draws, blink: blinkMeshes.length > 0 }),
    dispose() { if (disposed) return; disposed = true; scene.remove(root); for (const resource of resources) resource.dispose(); for (const bitmap of bitmaps) bitmap.close(); for (const skeleton of skeletons) skeleton.dispose(); },
  };
  api.reset(); return api;
}

export const rushLanes = [-2.7, -.9, .9, 2.7];
export function createRushState() { return { z: -58, elapsed: 0, speed: 0, steps: 0 }; }
export function advanceRush(state, seconds, viewer, { paused = false, reduced = false, inspecting = false, camera } = {}) {
  if (paused || inspecting) return state;
  // Stop where the whole row remains legible, including on narrow screens.
  const distance = Math.max(5.3, camera ? 3.5 / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect) : 0);
  if (reduced) { state.z = -Math.max(8, distance); state.speed = 0; return state; }
  const dt = clamp(Number.isFinite(seconds) ? seconds : 0, 0, .05);
  state.elapsed += dt;
  const target = Math.min(1.4, viewer.z - distance);
  const previous = state.z;
  if (state.elapsed > 1.3) state.z += Math.min(Math.max(0, target - state.z), dt * 5.2);
  state.speed = dt ? (state.z - previous) / dt : state.speed;
  if (state.speed > .1) state.steps += dt;
  return state;
}

function releaseModel(scene) {
  const resources = new Set(), bitmaps = new Set();
  scene.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    if (object.skeleton) resources.add(object.skeleton);
    if (object.material) for (const material of [object.material].flat()) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) {
        resources.add(value); if (value.image?.close) bitmaps.add(value.image);
      }
    }
  });
  for (const resource of resources) resource.dispose();
  for (const bitmap of bitmaps) bitmap.close();
}

// Bake the head, shoulders and chest from the loaded model. Clip triangles at
// the chest line so the bust has a clean base, without an extra animated skin.
export function createGiantBustGeometry(T, figure) {
  figure.updateMatrixWorld(true);
  const chest = figure.getObjectByName('J_Bip_C_Chest');
  if (!chest) throw Error('Darenin chest bone is missing');
  const cutoff = chest.getWorldPosition(new T.Vector3()).y - .1;
  const positions = [], colors = [], vertex = new T.Vector3();
  figure.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.skeleton?.update();
    const geometry = mesh.geometry, color = geometry.getAttribute('color');
    const vertices = Array.from({ length: geometry.getAttribute('position').count }, (_, index) => mesh.getVertexPosition(index, vertex).applyMatrix4(mesh.matrixWorld).clone());
    const count = geometry.index?.count ?? vertices.length;
    for (let offset = 0; offset < count; offset += 3) {
      const indices = [0, 1, 2].map(n => geometry.index ? geometry.index.getX(offset + n) : offset + n);
      const triangle = indices.map(index => ({ p: vertices[index], c: new T.Vector3(color ? color.getX(index) : .8, color ? color.getY(index) : .8, color ? color.getZ(index) : .8) }));
      const clipped = [];
      for (let i = 0; i < 3; i++) {
        const a = triangle[i], b = triangle[(i + 1) % 3];
        if (a.p.y >= cutoff) clipped.push(a);
        if ((a.p.y >= cutoff) !== (b.p.y >= cutoff)) {
          const t = (cutoff - a.p.y) / (b.p.y - a.p.y);
          clipped.push({ p: a.p.clone().lerp(b.p, t), c: a.c.clone().lerp(b.c, t) });
        }
      }
      for (let i = 1; i + 1 < clipped.length; i++) for (const vertex of [clipped[0], clipped[i], clipped[i + 1]]) {
        positions.push(...vertex.p.toArray()); colors.push(...vertex.c.toArray());
      }
    }
  });
  if (!positions.length) throw Error('Darenin bust geometry is empty');
  const result = new T.BufferGeometry();
  result.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  result.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  result.computeVertexNormals(); result.computeBoundingBox();
  const center = result.boundingBox.getCenter(new T.Vector3());
  result.translate(-center.x, -result.boundingBox.min.y, -center.z);
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}

// Two downloads total. Four independent Darenin skeletons reuse one geometry;
// the three extra actors stay hidden outside the running-row anomaly.
export async function loadGalleryVisitors(T, { scene, urls, Loader, cloneSkeleton, onStep = () => {} }) {
  if (!Loader || !cloneSkeleton) {
    const url = new URL('../../manzokukyo-preview/vendor/GLTFLoader.js', import.meta.url);
    url.search = new URL(import.meta.url).search;
    const module = await import(url);
    Loader ||= module.GLTFLoader; cloneSkeleton ||= module.cloneSkeleton;
  }
  const results = await Promise.allSettled(['zannenin', 'darenin'].map(kind => new Loader().loadAsync(urls[kind].href)));
  if (results.some(result => result.status === 'rejected')) {
    for (const result of results) if (result.status === 'fulfilled') releaseModel(result.value.scene);
    throw results.find(result => result.status === 'rejected').reason;
  }
  const official = createGalleryVisitor(T, { scene, figure: results[0].value.scene, kind: 'zannenin', spawn: { x: 1.65, z: -6.4, wait: 3.8 } });
  const template = results[1].value.scene;
  const sharedFinish = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  const giantGeometry = createGiantBustGeometry(T, template);
  const giant = new T.Group(); giant.name = 'Giant Darenin bust';
  const bust = new T.Mesh(giantGeometry, sharedFinish); bust.name = 'Darenin head shoulders and chest';
  const bustSize = giantGeometry.boundingBox.getSize(new T.Vector3());
  const bustScale = 4.25 / bustSize.y;
  bust.scale.setScalar(bustScale); bust.position.y = 1.65;
  // A low plinth conceals the cut and anchors the chest in the gallery.
  const plinthGeometry = new T.BoxGeometry(bustSize.x * bustScale + .18, 1.7, bustSize.z * bustScale + .14);
  const plinthMaterial = new T.MeshLambertMaterial({ color: 0x24302d });
  const plinth = new T.Mesh(plinthGeometry, plinthMaterial); plinth.position.y = .85;
  giant.add(bust, plinth);
  scene.add(giant);
  const copies = rushLanes.map(() => createGalleryVisitor(T, { scene, figure: cloneSkeleton(template), sharedFinish, spawn: { x: -1.65, z: -5.4, wait: 1.8 } }));
  const everyone = [official, ...copies];
  let rushing = false, giantActive = false, giantTime = 0, rush = createRushState(), disposed = false, step = 0;
  const api = {
    setAnomaly(anomaly) {
      if (disposed) return;
      rushing = anomaly?.kind === 'darenin-rush'; rush = createRushState(); step = 0;
      giantActive = anomaly?.kind === 'giant-darenin'; giantTime = 0;
      giant.visible = giantActive; giant.position.set(-1.1, 0, -60.6); giant.rotation.set(0, Math.PI, 0);
      bust.rotation.set(0, 0, 0);
      for (const actor of everyone) actor.reset();
      official.setEnabled(!rushing);
      copies.forEach((actor, index) => actor.setEnabled(rushing || index === 0));
    },
    update(dt, viewer, options = {}) {
      if (disposed) return false;
      let moving = false;
      if (rushing) {
        advanceRush(rush, dt, viewer, options);
        copies.forEach((actor, index) => {
          moving = actor.update(dt, viewer, { ...options, formation: { x: rushLanes[index], z: rush.z, yaw: Math.PI, speed: rush.speed } }) || moving;
        });
        const nextStep = Math.floor(rush.steps / .28);
        if (nextStep > step && !options.paused && !options.inspecting && !options.reduced) {
          step = nextStep;
          const distance = Math.abs(viewer.z - rush.z);
          if (distance < 28) onStep(step % 2 ? 'step-1' : 'step-2', { level: .15 + .42 * (1 - distance / 28), rate: .78 });
        }
      } else {
        moving = official.update(dt, viewer, options);
        moving = copies[0].update(dt, viewer, options) || moving;
      }
      giant.visible = giantActive && !options.inspecting;
      if (giantActive && !options.paused && !options.inspecting) {
        if (!options.reduced) giantTime += clamp(Number.isFinite(dt) ? dt : 0, 0, .05);
        bust.rotation.y = Math.sin(giantTime * .4) * .045;
        moving = !options.reduced || moving;
      }
      return moving;
    },
    isVisible: () => giant.visible || everyone.some(actor => actor.isVisible()),
    snapshot: () => ({ loaded: true, count: rushing ? 4 : giantActive ? 3 : 2, people: everyone.map(actor => actor.snapshot()).filter(actor => actor.enabled), ...(giantActive ? { giant: { visible: giant.visible, framing: 'bust', position: giant.position.toArray(), yaw: giant.rotation.y + bust.rotation.y } } : {}), ...(rushing ? { formation: { z: rush.z, speed: rush.speed } } : {}) }),
    dispose() {
      if (disposed) return; disposed = true;
      for (const actor of everyone) actor.dispose();
      scene.remove(giant); giantGeometry.dispose(); plinthGeometry.dispose(); plinthMaterial.dispose();
      releaseModel(template); sharedFinish.dispose();
    },
  };
  api.setAnomaly(null);
  return api;
}
