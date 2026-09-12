// A single reusable sculpted arm, in the painting's local coordinates.
// Shared low-poly geometry keeps the anomaly independent of model downloads.
export function mountFrameHand(T, { frames, targets }) {
  const root = new T.Group(); root.name = 'Hand outside the frame'; root.visible = false;
  const round = new T.SphereGeometry(1, 12, 8);
  const tube = new T.CylinderGeometry(1, 1, 1, 10);
  const skin = new T.MeshStandardMaterial({ color: 0xd8c9bc, roughness: .73 });
  const nail = new T.MeshStandardMaterial({ color: 0x645267, roughness: .5 });
  const sleeve = new T.MeshStandardMaterial({ color: 0x1b2428, roughness: .9 });
  const meshes = [], fingers = [];
  const up = new T.Vector3(0, 1, 0);
  function oval(parent, at, scale, material = skin) {
    const mesh = new T.Mesh(round, material); mesh.position.set(...at); mesh.scale.set(...scale); parent.add(mesh); meshes.push(mesh); return mesh;
  }
  function limb(parent, from, to, radius, material = skin) {
    const a = new T.Vector3(...from), b = new T.Vector3(...to), delta = b.clone().sub(a);
    const mesh = new T.Mesh(tube, material); mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.scale.set(radius, delta.length(), radius * .86); mesh.quaternion.setFromUnitVectors(up, delta.normalize());
    parent.add(mesh); meshes.push(mesh); return mesh;
  }
  // The cuff begins behind the image plane; the wrist clears the gold frame.
  oval(root, [.73, -.93, .1], [.19, .23, .16], sleeve);
  limb(root, [.74, -.91, .09], [1.08, -.63, .4], .14);
  oval(root, [1.08, -.63, .4], [.14, .14, .13]);
  limb(root, [1.08, -.63, .4], [1.17, -.29, .65], .115);
  oval(root, [1.16, -.08, .75], [.205, .27, .115]);
  // Four separate knuckles, bent joints and dark nails make the silhouette a hand.
  for (const [i, length] of [.29, .37, .34, .25].entries()) {
    const finger = new T.Group(); finger.position.set(.995 + i * .108, .1, .79); finger.rotation.z = (.5 - i / 3) * .18; root.add(finger); fingers.push(finger);
    const end = [0, length * .67, .075], tip = [0, length, .22];
    oval(finger, [0, 0, 0], [.062, .075, .06]);
    limb(finger, [0, 0, 0], end, .049);
    oval(finger, end, [.052, .055, .052]);
    limb(finger, end, tip, .042); oval(finger, tip, [.044, .052, .045]);
    oval(finger, [0, tip[1] + .014, tip[2] + .037], [.032, .04, .009], nail);
  }
  limb(root, [.99, -.14, .79], [.82, -.03, .91], .072);
  oval(root, [.82, -.03, .91], [.074, .07, .07]);
  limb(root, [.82, -.03, .91], [.84, .1, 1.04], .058);
  oval(root, [.84, .1, 1.04], [.06, .07, .06]);
  oval(root, [.84, .12, 1.087], [.04, .048, .012], nail);
  let active = false, nearby = false, phase = 0, disposed = false;
  function detach() {
    root.removeFromParent();
    for (const mesh of meshes) { const index = targets.indexOf(mesh); if (index >= 0) targets.splice(index, 1); }
  }
  return {
    root,
    setAnomaly(anomaly) {
      if (disposed) return;
      detach(); phase = 0; nearby = false;
      active = anomaly?.kind === 'frame-hand' && Number.isInteger(anomaly.index) && Boolean(frames[anomaly.index]);
      root.visible = active;
      for (const finger of fingers) finger.rotation.x = 0;
      if (active) {
        frames[anomaly.index].group.add(root);
        for (const mesh of meshes) { mesh.userData.index = anomaly.index; targets.push(mesh); }
      }
    },
    update(dt, camera, { paused = false, reduced = false } = {}) {
      if (!active || disposed) return false;
      const position = root.getWorldPosition(new T.Vector3());
      nearby = position.distanceTo(camera.position) < 18;
      if (paused || reduced || !nearby) return false;
      phase += Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, .05));
      fingers.forEach((finger, i) => { finger.rotation.x = .08 * Math.sin(phase * 1.3 + i * .35); });
      return true;
    },
    isVisible: () => active && nearby,
    dispose() {
      if (disposed) return; disposed = true; active = false; root.visible = false; detach();
      for (const resource of [round, tube, skin, nail, sleeve]) resource.dispose();
    },
  };
}
