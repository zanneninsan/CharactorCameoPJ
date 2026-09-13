// One small render target, reused by a single framed window. The off-axis camera
// keeps the landscape behind the aperture as the visitor moves past either wall.
export function worldWindowCamera(T, camera, eye, width, height) {
  const z = Math.max(.15, eye.z), near = .08;
  camera.position.set(eye.x, eye.y, z); camera.quaternion.identity();
  camera.projectionMatrix.makePerspective((-width / 2 - eye.x) * near / z, (width / 2 - eye.x) * near / z,
    (height / 2 - eye.y) * near / z, (-height / 2 - eye.y) * near / z, near, 100);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert(); camera.updateMatrixWorld(true);
}

export function mountGalleryWorld(T, { frames, targets, gallery }) {
  const geometries = new Set(), materials = new Set();
  const own = g => { geometries.add(g); return g; };
  const material = options => { const m = new T.MeshStandardMaterial(options); materials.add(m); return m; };
  const world = new T.Scene(); world.background = new T.Color(0xb5def0); world.fog = new T.Fog(0xc8e4df, 22, 65);
  world.add(new T.HemisphereLight(0xffffe5, 0x749a4f, 2.5));
  const sun = new T.DirectionalLight(0xfff2ca, 2.3); sun.position.set(-7, 12, 4); world.add(sun);
  const cube = own(new T.BoxGeometry()), sphere = own(new T.SphereGeometry(1, 20, 12));
  const box = (size, at, m) => { const mesh = new T.Mesh(cube, m); mesh.scale.set(...size); mesh.position.set(...at); world.add(mesh); return mesh; };
  const meadow = material({ color: 0x85ae50, roughness: 1 });
  box([100, .1, 100], [0, -1.85, -30], meadow);
  const hillMaterial = material({ color: 0x739b58, roughness: 1 });
  for (const [x, y, z, sx, sy, sz] of [[-18, -4, -36, 20, 7, 14], [17, -4, -42, 22, 9, 15], [-1, -5, -58, 32, 9, 18]]) {
    const hill = new T.Mesh(sphere, hillMaterial); hill.position.set(x, y, z); hill.scale.set(sx, sy, sz); world.add(hill);
  }
  const cloudMaterial = new T.MeshBasicMaterial({ color: 0xf6f8e9 }); materials.add(cloudMaterial);
  for (let i = 0; i < 7; i++) {
    const cloud = new T.Mesh(sphere, cloudMaterial); cloud.position.set(-24 + i * 8, 12 + Math.sin(i * 3) * 2, -38 - i % 2 * 9); cloud.scale.set(6, 1.25, 2); world.add(cloud);
  }
  const brass = material({ color: 0xbf974b, metalness: .45, roughness: .45 });
  const red = material({ color: 0x7d2731, roughness: .65 });
  const shape = new T.Shape(); shape.moveTo(-.69, 0); shape.lineTo(.69, 0); shape.lineTo(.69, 1.95); shape.absarc(0, 1.95, .69, 0, Math.PI); shape.closePath();
  const door = new T.Mesh(own(new T.ExtrudeGeometry(shape, { depth: .15, bevelEnabled: false, curveSegments: 20 })), red);
  door.position.set(.28, -1.8, -8); world.add(door);
  box([1.55, .09, .5], [.28, -1.77, -7.93], brass);
  for (const side of [-1, 1]) {
    box([.04, 1.94, .07], [.28 + side * .67, -.83, -7.82], brass);
    box([.025, 1.8, .06], [.28 + side * .50, -.79, -7.80], brass);
  }
  for (const y of [-1.65, -.85, .10]) box([1.05, .025, .06], [.28, y, -7.79], brass);
  const rim = new T.Mesh(own(new T.TorusGeometry(.67, .025, 5, 24, Math.PI)), brass); rim.position.set(.28, .15, -7.80); world.add(rim);
  const knob = new T.Mesh(sphere, brass); knob.scale.setScalar(.045); knob.position.set(.73, -.77, -7.74); world.add(knob);
  // A few hundred instanced blades sway in their vertex shader, not on the CPU.
  const wind = { value: 0 };
  const blade = own(new T.PlaneGeometry(.065, .65, 1, 3)); blade.translate(0, .325, 0);
  const grassMaterial = material({ color: 0x68973b, roughness: 1, side: T.DoubleSide });
  grassMaterial.onBeforeCompile = shader => {
    shader.uniforms.worldWind = wind;
    shader.vertexShader = 'uniform float worldWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.x += position.y * position.y * sin(worldWind * 1.3 + instanceMatrix[3].x * 1.7 + instanceMatrix[3].z) * .30;');
  };
  const grass = new T.InstancedMesh(blade, grassMaterial, 780), placement = new T.Object3D();
  for (let i = 0; i < grass.count; i++) {
    const x = Math.sin(i * 127.1) * 11, z = -1 - ((i * 71) % 251) / 12;
    placement.position.set(x, -1.78, z); placement.rotation.y = i * 2.399;
    placement.scale.setScalar(.45 + ((i * 29) % 101) / 120); placement.updateMatrix(); grass.setMatrixAt(i, placement.matrix);
  }
  world.add(grass);
  const target = new T.WebGLRenderTarget(384, 540); target.texture.colorSpace = T.SRGBColorSpace;
  const surface = new T.MeshBasicMaterial({ map: target.texture, toneMapped: false }); materials.add(surface);
  const windowMesh = new T.Mesh(own(new T.PlaneGeometry()), surface); windowMesh.name = 'Window into another world';
  windowMesh.position.z = .132;
  const camera = new T.PerspectiveCamera(), localEye = new T.Vector3(), frustum = new T.Frustum(), matrix = new T.Matrix4();
  let frame = null, visible = false, near = false, paused = false, reduced = false, elapsed = 0, rendered = false, cooldown = 0, cancelWind;
  let lastEye = new T.Vector3(Infinity, Infinity, Infinity), lastWind = -1, disposed = false;
  function silence() { cancelWind?.(); cancelWind = null; cooldown = 0; }
  function setAnomaly(anomaly) {
    silence(); windowMesh.removeFromParent(); const old = targets.indexOf(windowMesh); if (old >= 0) targets.splice(old, 1);
    frame = anomaly?.kind === 'other-world' ? frames[anomaly.index] : null;
    visible = near = rendered = false; elapsed = 0; wind.value = 0; lastWind = -1; lastEye.set(Infinity, Infinity, Infinity);
    if (frame) { windowMesh.scale.set(frame.width, frame.height, 1); windowMesh.userData.index = frame.index; frame.group.add(windowMesh); targets.push(windowMesh); }
  }
  function update(dt, viewer, options = {}) {
    paused = Boolean(options.paused); reduced = Boolean(options.reduced);
    if (!frame || disposed) { visible = near = false; silence(); return false; }
    frame.group.updateWorldMatrix(true, true); localEye.copy(viewer.position); frame.group.worldToLocal(localEye);
    viewer.updateMatrixWorld(true); matrix.multiplyMatrices(viewer.projectionMatrix, viewer.matrixWorldInverse); frustum.setFromProjectionMatrix(matrix);
    visible = localEye.z > .05 && frustum.intersectsObject(windowMesh); near = visible && localEye.length() < 16;
    if (!paused && near && !reduced) { elapsed += Math.min(.05, Math.max(0, dt)); wind.value = elapsed; }
    const sound = gallery.state().sound;
    const audible = !paused && visible && localEye.length() < 6 && sound?.enabled && sound.effectsVolume > 0;
    if (!audible) silence();
    else {
      cooldown -= dt;
      if (cooldown <= 0) { cancelWind?.(); cancelWind = gallery.play('gallery-world-wind', { level: .38 * (1 - localEye.length() / 7) }); cooldown = cancelWind ? 4 : .5; }
    }
    return !paused && near && (!reduced || Boolean(audible));
  }
  function render(renderer, viewer, force = false) {
    if (!frame || disposed || (!force && !visible && rendered)) return;
    frame.group.updateWorldMatrix(true, true); localEye.copy(viewer.position); frame.group.worldToLocal(localEye);
    if (localEye.z < .05) return;
    if (!force && rendered && localEye.distanceToSquared(lastEye) < .000001 && lastWind === wind.value) return;
    worldWindowCamera(T, camera, localEye, frame.width, frame.height);
    const previous = renderer.getRenderTarget();
    try { renderer.setRenderTarget(target); renderer.render(world, camera); rendered = true; lastEye.copy(localEye); lastWind = wind.value; }
    finally { renderer.setRenderTarget(previous); }
  }
  return {
    setAnomaly, update, render, silence, isVisible: () => near,
    snapshot: () => ({ record: frame ? frame.index + 1 : null, visible, animated: near && !paused && !reduced, windPlaying: Boolean(cancelWind), renderSize: [384, 540] }),
    dispose() { if (disposed) return; setAnomaly(null); disposed = true; grass.dispose(); target.dispose(); for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); },
  };
}
