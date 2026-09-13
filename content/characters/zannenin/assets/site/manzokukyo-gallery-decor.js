// Shared, low-poly fixtures: no shadow maps, postprocessing or transparent glass.
export function mountGalleryDecor(T, { scene, exitGroup, extension, geometry, textures, material, basic, box, plane, gold, black }) {
  const batches = [];
  const own = shape => { geometry.add(shape); return shape; };
  const mesh = (parent, shape, surface, position) => {
    const object = new T.Mesh(shape, surface); object.position.set(...position); parent.add(object); return object;
  };
  const archPath = (radius, spring, bottom = 0) => {
    const shape = new T.Shape(); shape.moveTo(-radius, bottom); shape.lineTo(radius, bottom);
    shape.lineTo(radius, spring); shape.absarc(0, spring, radius, 0, Math.PI, false);
    shape.lineTo(-radius, bottom); return shape;
  };
  const extrusion = shape => own(new T.ExtrudeGeometry(shape, { depth: .10, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .018, bevelThickness: .015, curveSegments: 24 }));
  const door = new T.Group(); door.name = 'Brass arched archive door'; door.position.z = -64.12; exitGroup.add(door);
  const woodCanvas = document.createElement('canvas'); woodCanvas.width = 256; woodCanvas.height = 512;
  const ink = woodCanvas.getContext('2d'); ink.fillStyle = '#71383c'; ink.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 96; i++) {
    ink.strokeStyle = i % 3 ? '#401c2330' : '#ae6a5228'; ink.lineWidth = i % 3 + 1;
    ink.beginPath(); ink.moveTo(i * 2.73, 0); ink.bezierCurveTo(i * 2.73 + 7, 130, i * 2.73 - 6, 360, i * 2.73, 512); ink.stroke();
  }
  const woodMap = new T.CanvasTexture(woodCanvas); woodMap.colorSpace = T.SRGBColorSpace; textures.add(woodMap);
  const wood = material({ map: woodMap, roughness: .63, color: 0xd8b4aa });
  const insetWood = material({ color: 0x482328, roughness: .72 });
  mesh(door, extrusion(archPath(1.82, 3.14)), black, [0, .03, -.07]);
  const trim = archPath(1.79, 3.14); trim.holes.push(archPath(1.60, 3.14, .14));
  mesh(door, extrusion(trim), gold, [0, .03, .02]);
  const leaf = extrusion(archPath(1.60, 3.14, .14)), uv = leaf.getAttribute('uv'), vertices = leaf.getAttribute('position');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (vertices.getX(i) + 1.60) / 3.20, vertices.getY(i) / 4.74);
  mesh(door, leaf, wood, [0, .03, 0]);
  // Recessed panels and raised brass mouldings give the door depth at close range.
  for (const side of [-1, 1]) {
    for (const [y, h] of [[1.08, 1.25], [2.83, 1.62]]) {
      box(door, [1.19, h, .035], [side * .80, y, .118], insetWood);
      for (const edge of [-1, 1]) {
        box(door, [.023, h + .06, .04], [side * .80 + edge * .61, y, .145], gold);
        box(door, [1.24, .023, .04], [side * .80, y + edge * (h / 2 + .03), .145], gold);
      }
    }
    box(door, [.052, .40, .14], [side * .21, 1.94, .23], gold);
  }
  box(door, [.045, 4.56, .035], [0, 2.43, .14], gold);
  box(door, [3.65, .10, .50], [0, .045, .09], gold);
  // The eye is sculpted metal, separate from the wooden leaves.
  for (const sign of [-1, 1]) {
    const curve = new T.QuadraticBezierCurve3(new T.Vector3(-.58, 2.56, .28), new T.Vector3(0, 2.56 + sign * .48, .28), new T.Vector3(.58, 2.56, .28));
    mesh(door, own(new T.TubeGeometry(curve, 20, .035, 6, false)), gold, [0, 0, 0]);
  }
  mesh(door, own(new T.TorusGeometry(.15, .035, 6, 24)), gold, [0, 2.56, .28]);
  const pupil = mesh(door, own(new T.SphereGeometry(.073, 12, 8)), black, [0, 2.56, .30]); pupil.scale.z = .35;
  const fan = new T.QuadraticBezierCurve3(new T.Vector3(-1.35, 3.73, .15), new T.Vector3(0, 5.5, .15), new T.Vector3(1.35, 3.73, .15));
  mesh(door, own(new T.TubeGeometry(fan, 28, .025, 5, false)), gold, [0, 0, 0]);

  const fixtureZ = Array.from({ length: 8 }, (_, i) => -5 - i * 8);
  const extensionZ = [-69, -77];
  const glass = material({ color: 0xfff2d4, emissive: 0xffdba0, emissiveIntensity: .85, roughness: .42 });
  const cylinder = own(new T.CylinderGeometry(1, 1, 1, 12));
  const globe = own(new T.SphereGeometry(1, 16, 12));
  const rim = own(new T.TorusGeometry(1, .075, 6, 20));
  const parts = [
    [cylinder, gold, [0, 6.29, 0], [.26, .10, .26]],
    [cylinder, gold, [0, 6.155, 0], [.034, .20, .034]],
    [cylinder, gold, [0, 6.00, 0], [.16, .12, .16]],
    [globe, glass, [0, 5.65, 0], [.34, .37, .34]],
    [rim, gold, [0, 5.92, 0], [.245, .245, .245], Math.PI / 2],
    [cylinder, gold, [0, 5.27, 0], [.07, .07, .07]],
  ];
  const placement = new T.Object3D();
  for (const [parent, positions] of [[scene, fixtureZ], [extension, extensionZ]]) {
    for (const [shape, surface, at, scale, rotation = 0] of parts) {
      const batch = new T.InstancedMesh(shape, surface, positions.length); batch.name = 'Archive pendant fixture';
      positions.forEach((z, i) => {
        placement.position.set(at[0], at[1], z); placement.scale.set(...scale); placement.rotation.set(rotation, 0, 0);
        placement.updateMatrix(); batch.setMatrixAt(i, placement.matrix);
      });
      parent.add(batch); batches.push(batch);
    }
  }
  // A shared soft pool suggests bounce light without expensive per-lamp shadows.
  const poolCanvas = document.createElement('canvas'); poolCanvas.width = poolCanvas.height = 128;
  const poolInk = poolCanvas.getContext('2d');
  const gradient = poolInk.createRadialGradient(64, 64, 3, 64, 64, 63);
  gradient.addColorStop(0, 'rgba(255,225,163,0.19)'); gradient.addColorStop(.5, 'rgba(255,225,163,0.09)'); gradient.addColorStop(1, 'rgba(255,225,163,0)');
  poolInk.fillStyle = gradient; poolInk.fillRect(0, 0, 128, 128);
  const poolMap = new T.CanvasTexture(poolCanvas); poolMap.colorSpace = T.SRGBColorSpace; textures.add(poolMap);
  const poolSurface = basic({ map: poolMap, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1 });
  for (const [parent, positions] of [[scene, fixtureZ], [extension, extensionZ]]) {
    const pools = new T.InstancedMesh(plane, poolSurface, positions.length);
    positions.forEach((z, i) => {
      placement.position.set(0, .047, z); placement.rotation.set(-Math.PI / 2, 0, 0); placement.scale.set(5.8, 7.2, 1); placement.updateMatrix(); pools.setMatrixAt(i, placement.matrix);
    });
    parent.add(pools); batches.push(pools);
  }
  // Fixed two-light budget. Lamp positions stay fixed in the room; distant lights
  // fade out before the pool is reassigned, so walking never drags the light along.
  const lights = Array.from({ length: 2 }, () => { const light = new T.PointLight(0xffdba9, 0, 12, 2); light.position.y = 5.40; scene.add(light); return light; });
  const candidates = [...fixtureZ, ...extensionZ];
  return {
    update(camera) {
      const nearest = candidates.filter(z => z >= -61 || extension.visible).sort((a, b) => Math.abs(a - camera.position.z) - Math.abs(b - camera.position.z));
      lights.forEach((light, i) => {
        light.position.z = nearest[i];
        const distance = Math.abs(nearest[i] - camera.position.z);
        light.intensity = 48 * (1 - T.MathUtils.smoothstep(distance, 8, 12));
      });
    },
    dispose: () => { for (const batch of batches) batch.dispose(); },
    snapshot: () => ({ fixtures: extension.visible ? 10 : 8, pointLights: lights.length, shadows: false }),
  };
}
