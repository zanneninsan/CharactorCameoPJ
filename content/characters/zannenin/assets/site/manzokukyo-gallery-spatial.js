const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const maxExitOffset = 18;

// The door retreats with forward progress, then stops. Retreating never pulls
// it through the player, and even an incorrect forward exit remains reachable.
export function exitRetreat(previous, z) {
  return Math.max(previous, clamp((-z - 44) * 2, 0, maxExitOffset));
}

export function mountGallerySpatial(T, { frames, exitGroup, extension }) {
  const bases = frames.map(frame => ({ position: frame.group.position.clone(), quaternion: frame.group.quaternion.clone() }));
  const toward = new T.Vector3(), target = new T.Vector3(), rotation = new T.Quaternion(), up = new T.Vector3(0, 1, 0);
  let anomaly = null, offset = 0, portrait = null, activated = false;
  function reset(next) {
    for (let i = 0; i < frames.length; i++) { frames[i].group.position.copy(bases[i].position); frames[i].group.quaternion.copy(bases[i].quaternion); }
    anomaly = next; offset = 0; activated = false; portrait = next?.kind === 'approaching-portrait' ? frames[next.index] : null;
    exitGroup.position.z = 0; extension.visible = next?.kind === 'receding-exit';
  }
  function track(camera) {
    if (anomaly?.kind !== 'receding-exit') return;
    offset = exitRetreat(offset, camera.position.z); exitGroup.position.z = -offset;
  }
  return {
    reset, track,
    get exitOffset() { return offset; },
    get walkLimit() { return anomaly?.kind === 'receding-exit' ? maxExitOffset : 0; },
    update(seconds, camera, { paused = false, reduced = false } = {}) {
      if (paused) return false;
      track(camera);
      if (!portrait) return false;
      const base = bases[portrait.index].position, group = portrait.group;
      // Only a nearby, loaded painting can begin approaching. The whole frame
      // moves so raycasts, its plaque and provisional seal remain together.
      if (!portrait.surface.map || camera.position.distanceTo(base) > 10) return false;
      activated = true;
      toward.copy(camera.position).sub(base); toward.y = 0; toward.normalize();
      target.copy(base).addScaledVector(toward, 2.6);
      target.x = clamp(target.x, -4.1, 4.1);
      const dt = clamp(Number.isFinite(seconds) ? seconds : 0, 0, .05);
      if (reduced) group.position.copy(target);
      else {
        const distance = group.position.distanceTo(target);
        if (distance > .001) group.position.lerp(target, Math.min(1, dt * .65 / distance));
      }
      rotation.setFromAxisAngle(up, Math.atan2(camera.position.x - group.position.x, camera.position.z - group.position.z));
      if (reduced) group.quaternion.copy(rotation); else group.quaternion.slerp(rotation, 1 - Math.exp(-dt * .7));
      return !reduced && (group.position.distanceTo(target) > .005 || group.quaternion.angleTo(rotation) > .005);
    },
    isVisible: () => Boolean(portrait && activated),
    snapshot: () => ({ exitOffset: offset, portrait: portrait ? { record: portrait.index + 1, activated, position: portrait.group.position.toArray() } : null }),
  };
}
