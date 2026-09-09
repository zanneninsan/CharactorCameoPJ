import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { joinPrimitives, weld, simplify, quantize, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import validator from 'gltf-validator';

// Offline conversion only. The website downloads the committed GLB, without
// VRM plugins, textures, physics or a mesh-compression decoder.
const input = new URL('zannenin-san-rough.vrm', import.meta.url);
const output = new URL('../../content/characters/zannenin/assets/models/darenin-gallery.glb', import.meta.url);
const bytes = await readFile(input);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const json = await io.binaryToJSON(bytes);
delete json.json.extensions?.VRM;
json.json.extensionsUsed = (json.json.extensionsUsed || []).filter(name => name !== 'VRM');
json.json.extensionsRequired = (json.json.extensionsRequired || []).filter(name => name !== 'VRM');
const document = await io.readJSON(json);
const root = document.getRoot();
const meshNodes = root.listNodes().filter(node => node.getMesh());
const primitives = meshNodes.flatMap(node => node.getMesh().listPrimitives());
const before = { bytes: bytes.length, draws: primitives.length, triangles: primitives.reduce((sum, p) => sum + p.getIndices().getCount() / 3, 0) };
const buffer = root.listBuffers()[0];
const material = document.createMaterial('Darenin vertex colors').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(.8).setMetallicFactor(0).setDoubleSided(true);
const skin = root.listMaterials().find(m => m.getName() === 'skin').getBaseColorFactor();
for (const primitive of primitives) {
  const original = primitive.getMaterial().getBaseColorFactor();
  // The two blush disks were translucent over skin: bake that composite color
  // so the entire character can stay opaque in one draw call.
  const color = original.slice(0, 3).map((v, i) => Math.round(255 * (v * original[3] + skin[i] * (1 - original[3]))));
  const colors = new Uint8Array(primitive.getAttribute('POSITION').getCount() * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set(color, i);
  primitive.setAttribute('COLOR_0', document.createAccessor().setType('VEC3').setArray(colors).setNormalized(true).setBuffer(buffer));
  primitive.setMaterial(material);
}
const joined = joinPrimitives(primitives);
meshNodes[0].setMesh(document.createMesh('Darenin').addPrimitive(joined));
for (const node of meshNodes.slice(1)) node.dispose();
await MeshoptSimplifier.ready;
await document.transform(
  prune({ keepLeaves: true }),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: .42, error: .001, lockBorder: true }),
  quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeColor: 8, quantizeWeight: 8 }),
  dedup(), prune({ keepLeaves: true }),
);
const optimized = await io.writeBinary(document);
const validation = await validator.validateBytes(optimized, { maxIssues: 20 });
if (validation.issues.numErrors) throw Error(JSON.stringify(validation.issues));
await mkdir(new URL('.', output), { recursive: true });
await writeFile(output, optimized);
const report = {
  source: input.pathname.split('/').pop(),
  sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  before,
  after: { bytes: optimized.length, draws: root.listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0), triangles: root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((sum, p) => sum + p.getIndices().getCount() / 3, 0), 0), textures: root.listTextures().length },
  validation: validation.issues,
};
await writeFile(new URL('optimization.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
