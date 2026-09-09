// A single gallery visitor. Route decisions are independent of anomaly/seal RNG.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const angle = value => Math.atan2(Math.sin(value), Math.cos(value));
export const visitorBounds = { left: -3.35, right: 3.35, back: -59, front: -2.3 };
export function createVisitorState() {
  return { x: 1.65, z: -5.4, yaw: Math.PI, targetX: 1.65, targetZ: -5.4, lookX: 0, lookZ: .8, wait: 2.5, phase: 0, speed: 0, behavior: 'resting', decisions: 0, blocked: 0 };
}
function chooseDestination(state, random) {
  const nextZ = clamp(state.z + (random() - .5) * 25, visitorBounds.back, visitorBounds.front);
  if (random() < .7) {
    const room = clamp(Math.floor((2 - nextZ) / 16), 0, 3);
    const slot = Math.floor(random() * 3);
    state.targetZ = -3 - slot * 4.5 - room * 16;
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

export async function loadGalleryVisitor(T, { scene, url, Loader }) {
  const GLTFLoader = Loader || (await import(new URL('../../manzokukyo-preview/vendor/GLTFLoader.js', import.meta.url))).GLTFLoader;
  const gltf = await new GLTFLoader().loadAsync(url.href);
  const figure = gltf.scene;
  const root = new T.Group(); root.name = 'Darenin gallery visitor';
  const resources = new Set();
  const finish = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  resources.add(finish);
  const bones = {};
  figure.traverse(object => {
    if (object.isBone) bones[object.name] = object;
    if (!object.isMesh) return;
    for (const material of [object.material].flat()) material.dispose();
    object.material = finish; resources.add(object.geometry);
    // Quantized skin bounds change with the animated rig. One tiny mesh avoids
    // expensive per-frame bound recalculation; the visitor is distance-culled.
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
  let state = createVisitorState(), gait = 0, enabled = true, visible = false, disposed = false;
  const frustum = new T.Frustum(), projection = new T.Matrix4(), sphere = new T.Sphere(new T.Vector3(), 1.3);
  const bind = Object.fromEntries(Object.entries(bones).map(([name, bone]) => [name, bone.rotation.clone()]));
  function rotate(name, axis, radians) { const bone = bones[name]; if (bone) bone.rotation[axis] = bind[name][axis] + radians; }
  function pose(dt, viewer) {
    gait += state.speed * dt * 10;
    const stride = clamp(state.speed / .62, 0, 1), swing = Math.sin(gait) * stride;
    for (const [side, sign] of [['L', 1], ['R', -1]]) {
      rotate(`J_Bip_${side}_UpperLeg`, 'x', swing * .24 * sign);
      rotate(`J_Bip_${side}_LowerLeg`, 'x', Math.max(0, -swing * sign) * .28);
      rotate(`J_Bip_${side}_UpperArm`, 'x', -swing * .18 * sign);
      rotate(`J_Bip_${side}_LowerArm`, 'x', -.06 - Math.max(0, swing * sign) * .08);
      rotate(`J_Sec_${side}_TwinTail`, 'z', Math.sin(state.phase * 2.4 + sign) * .025 * (stride + .2));
    }
    rotate('J_Bip_C_Spine', 'z', swing * .016);
    const viewerDistance = Math.hypot(viewer.x - state.x, viewer.z - state.z);
    const headTurn = viewerDistance < 5 ? clamp(angle(Math.atan2(state.x - viewer.x, state.z - viewer.z) - state.yaw), -.45, .45) : Math.sin(state.phase * .55) * .12;
    rotate('J_Bip_C_Head', 'y', headTurn);
    root.position.set(state.x, Math.abs(Math.sin(gait)) * stride * .012, state.z); root.rotation.y = state.yaw;
  }
  const api = {
    update(dt, viewer, { paused = false, reduced = false, inspecting = false, camera } = {}) {
      if (disposed) return false;
      const distance = Math.hypot(viewer.x - state.x, viewer.z - state.z);
      visible = enabled && !inspecting && distance > .7 && distance < 30;
      if (visible && camera) {
        camera.updateMatrixWorld(); projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projection); sphere.center.set(state.x, 1, state.z);
        visible = frustum.intersectsSphere(sphere);
      }
      root.visible = visible;
      if (enabled && !paused && !reduced && !inspecting) { advanceVisitor(state, dt, viewer); pose(dt, viewer); }
      return enabled && !paused && !reduced && !inspecting;
    },
    reset() { state = createVisitorState(); gait = 0; pose(0, { x: 0, z: .8 }); },
    setEnabled(value) { enabled = value; root.visible = enabled; },
    isVisible: () => visible,
    snapshot: () => ({ loaded: true, enabled, visible, behavior: state.behavior, position: [state.x, state.z], yaw: state.yaw, decisions: state.decisions, draws: 1 }),
    dispose() { disposed = true; scene.remove(root); for (const resource of resources) resource.dispose(); figure.traverse(object => { if (object.isSkinnedMesh) object.skeleton.dispose(); }); },
  };
  api.reset(); return api;
}
