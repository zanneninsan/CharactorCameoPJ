const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function createBowingState() { return { x: 0, z: -8, phase: 0, bow: 0, speed: 0, cycles: 0 }; }
export function advanceBowing(state, seconds, viewer, { paused = false, inspecting = false, reduced = false } = {}) {
  if (paused || inspecting) return state;
  const dt = clamp(Number.isFinite(seconds) ? seconds : 0, 0, .05);
  const dx = viewer.x - state.x, dz = viewer.z - state.z, distance = Math.hypot(dx, dz);
  state.speed = 0;
  if (reduced) { state.x = clamp(viewer.x, -2, 2); state.z = clamp(viewer.z - 3, -58, 0); state.bow = 1.25; return state; }
  if (!state.phase && distance > 4.5) {
    state.speed = .7; state.x = clamp(state.x + dx / distance * dt * state.speed, -2, 2); state.z = clamp(state.z + dz / distance * dt * state.speed, -58, 0);
  } else {
    state.phase += dt;
    if (state.phase < .8 && distance > 3.2) {
      state.speed = .4; state.x = clamp(state.x + dx / distance * dt * state.speed, -2, 2); state.z = clamp(state.z + dz / distance * dt * state.speed, -58, 0);
    }
    const t = clamp((state.phase - .8) / 2.8, 0, 1);
    state.bow = Math.sin(Math.PI * t) ** 2 * (1.2 + clamp((4.5 - distance) / 1.3, 0, 1) * .4);
    if (state.phase > 4.2) { state.phase = 0; state.bow = 0; state.cycles++; }
  }
  return state;
}

export function createWatchingState() { return { armed: false, revealed: false, z: 0 }; }
export function advanceWatching(state, viewer, direction, { paused = false, inspecting = false } = {}) {
  if (paused || inspecting) return false;
  if (viewer.z < -9 && direction.z < -.65) state.armed = true;
  if (!state.revealed && state.armed && direction.z > .45) { state.revealed = true; state.z = Math.min(-5, viewer.z + 3); return true; }
  return false;
}

// Static spectators share one baked geometry and one instanced draw call.
export function bakeGallerySpectator(T, figure) {
  figure.updateMatrixWorld(true);
  const positions = [], colors = [], vertex = new T.Vector3();
  figure.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.skeleton?.update();
    const geometry = mesh.geometry, color = geometry.getAttribute('color');
    const count = geometry.index?.count ?? geometry.getAttribute('position').count;
    for (let i = 0; i < count; i++) {
      const index = geometry.index ? geometry.index.getX(i) : i;
      mesh.getVertexPosition(index, vertex).applyMatrix4(mesh.matrixWorld); positions.push(...vertex.toArray());
      colors.push(color ? color.getX(index) : .8, color ? color.getY(index) : .8, color ? color.getZ(index) : .8);
    }
  });
  const result = new T.BufferGeometry(); result.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); result.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  result.computeBoundingBox(); const bounds = result.boundingBox, scale = 1.95 / (bounds.max.y - bounds.min.y);
  result.translate(0, -bounds.min.y, 0); result.scale(scale, scale, scale); result.computeVertexNormals(); result.computeBoundingSphere();
  return result;
}
