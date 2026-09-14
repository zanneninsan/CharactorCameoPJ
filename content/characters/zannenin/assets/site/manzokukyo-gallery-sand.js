// One reusable stream and pile; the artwork itself keeps its original texture.
export function mountGallerySand(T, { frames }) {
  const group = new T.Group(); group.name = 'Sand falling from artwork';
  const grains = 540, positions = new Float32Array(grains * 3), seeds = new Float32Array(grains * 3);
  let randomState = 7144;
  const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < seeds.length; i++) seeds[i] = random();
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new T.BufferAttribute(seeds, 3));
  const time = { value: 0 }, floor = { value: -2.78 }, width = { value: 2.12 }, height = { value: 2.98 };
  const material = new T.ShaderMaterial({
    uniforms: { time, floorY: floor, width, height }, transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 seed; uniform float time, floorY, width, height; varying float glow;
      void main() {
        float phase = fract(seed.z + time * (.38 + seed.y * .18));
        float startY = -height * .06 + .05 * sin(seed.x * 31.0);
        float y = mix(startY, floorY + .20, phase * phase);
        float x = (seed.x - .5) * width * mix(.92, .22, phase);
        vec4 p = modelViewMatrix * vec4(x, y, .16 + phase * .36 + seed.y * .035, 1.0);
        gl_Position = projectionMatrix * p;
        gl_PointSize = clamp((8.0 + seed.y * 9.0) / max(1.0, -p.z), .8, 2.5);
        glow = .65 + seed.y * .35;
      }`,
    fragmentShader: `varying float glow; void main() {
      if (length(gl_PointCoord - .5) > .5) discard;
      gl_FragColor = vec4(vec3(1.0, .70, .22) * glow, .94);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
  const stream = new T.Points(geometry, material); stream.frustumCulled = false; group.add(stream);
  const pileGeometry = new T.ConeGeometry(.65, .36, 36, 5);
  const pileMaterial = new T.MeshStandardMaterial({ color: 0xd4a24c, roughness: 1 });
  const pile = new T.Mesh(pileGeometry, pileMaterial); pile.scale.z = .68; group.add(pile);
  const voidGeometry = new T.PlaneGeometry(1, 1), voidMaterial = new T.MeshBasicMaterial({ color: 0x30281d });
  const voidPlane = new T.Mesh(voidGeometry, voidMaterial); voidPlane.position.z = .113; group.add(voidPlane);
  const frustum = new T.Frustum(), projection = new T.Matrix4(), sphere = new T.Sphere(new T.Vector3(), 2.2);
  let frame = null, visible = false, animated = false, disposed = false;
  function setAnomaly(anomaly) {
    if (disposed) return;
    if (frame) frame.erosion.value = 0;
    group.removeFromParent(); frame = anomaly?.kind === 'sand-painting' ? frames[anomaly.index] : null;
    time.value = 0; visible = false; animated = false; group.visible = false;
    if (!frame) return;
    frame.erosion.value = 1;
    width.value = frame.width; height.value = frame.height;
    floor.value = .02 - frame.group.position.y;
    pile.position.set(0, floor.value + .18, .50);
    voidPlane.scale.set(frame.width, frame.height, 1);
    frame.group.add(group);
  }
  return {
    setAnomaly,
    update(seconds, camera, { paused = false, reduced = false } = {}) {
      if (disposed || !frame) return false;
      frame.group.updateWorldMatrix(true, false); camera.updateMatrixWorld();
      sphere.center.set(0, -.7, .3).applyMatrix4(frame.group.matrixWorld);
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projection);
      visible = camera.position.distanceTo(sphere.center) < 18 && frustum.intersectsSphere(sphere);
      group.visible = true;
      animated = visible && Boolean(frame.surface.map) && !paused && !reduced;
      if (animated) time.value += Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, .05));
      return animated;
    },
    isVisible: () => visible,
    snapshot: () => ({ record: frame ? frame.index + 1 : null, visible, animated, time: time.value, grains: frame ? grains : 0 }),
    dispose() {
      if (disposed) return;
      setAnomaly(null); disposed = true;
      for (const resource of [geometry, material, pileGeometry, pileMaterial, voidGeometry, voidMaterial]) resource.dispose();
    },
  };
}
