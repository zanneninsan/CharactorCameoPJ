// Camera-relative walking, with a margin around the frames, pillars and end wall.
export const walkKeys = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', KeyQ: 'turnLeft', KeyE: 'turnRight', ShiftLeft: 'sprint', ShiftRight: 'sprint' };
export function advanceWalk(position, yaw, actions, seconds) {
  const dt = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, .05));
  const turn = Number(actions.has('turnLeft')) - Number(actions.has('turnRight'));
  yaw = Math.atan2(Math.sin(yaw + turn * 1.45 * dt), Math.cos(yaw + turn * 1.45 * dt));
  const forward = Number(actions.has('forward')) - Number(actions.has('back'));
  const right = Number(actions.has('right')) - Number(actions.has('left'));
  const length = Math.hypot(forward, right) || 1;
  const speed = 4.2 * (actions.has('sprint') ? 2 : 1) * dt / length;
  const x = Math.max(-4.3, Math.min(4.3, position.x + (right * Math.cos(yaw) - forward * Math.sin(yaw)) * speed));
  const z = Math.max(-62.5, Math.min(3, position.z - (forward * Math.cos(yaw) + right * Math.sin(yaw)) * speed));
  return { x, z, yaw, distance: Math.hypot(x - position.x, z - position.z) };
}
export function walkRoom(z) { return Math.max(0, Math.min(3, Math.floor((2 - z) / 16))); }
