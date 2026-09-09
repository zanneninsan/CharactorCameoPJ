import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsUnlit, EXTTextureWebP } from '@gltf-transform/extensions';
import { weld, simplify, quantize, prune, dedup, joinPrimitives, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import validator from 'gltf-validator';

if (!process.argv[2]) throw Error('Usage: node tools/gallery-models/optimize-v11.mjs <original-v11.vrm>');
const bytes = await readFile(process.argv[2]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const json = await io.binaryToJSON(bytes);
const vrm = json.json.extensions.VRM;
const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
if (sourceSha256 !== '4f81cbd4785ef31e683816f3f560aa2c9a9634dfe514145b6de00603921f96c6') throw Error('This conversion is tuned for the supplied costume v11; source differs.');
const before = { bytes: bytes.length, draws: json.json.meshes.reduce((n, m) => n + m.primitives.length, 0), triangles: json.json.meshes.reduce((n, m) => n + m.primitives.reduce((s, p) => s + json.json.accessors[p.indices].count / 3, 0), 0) };
// Keep the real Blink expression, without downloading 56 unused expressions.
const blink = vrm.blendShapeMaster.blendShapeGroups.find(group => group.presetName === 'blink');
for (const [i, mesh] of json.json.meshes.entries()) {
  const binding = blink.binds.find(bind => bind.mesh === i);
  for (const primitive of mesh.primitives) {
    if (binding && primitive.targets) primitive.targets = [primitive.targets[binding.index]];
    else delete primitive.targets;
  }
  if (binding) { mesh.extras = { ...mesh.extras, targetNames: ['Blink'] }; mesh.weights = [0]; }
  else { delete mesh.weights; delete mesh.extras?.targetNames; }
}
delete json.json.extensions.VRM;
json.json.extensionsUsed = json.json.extensionsUsed.filter(name => name !== 'VRM');
json.json.extensionsRequired = (json.json.extensionsRequired || []).filter(name => name !== 'VRM');
// Source attribution and usage terms travel with the derivative GLB.
json.json.asset.extras = { source: path.basename(process.argv[2]), sourceSha256, vrmMeta: vrm.meta, galleryVisitor: { kind: 'zannenin', blink: 'Blink' } };
const document = await io.readJSON(json), root = document.getRoot();
for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) compactPrimitive(primitive);
await document.transform(dedup(), prune({ keepLeaves: true }));
// Standard unlit materials retain the painted cel shadows without MToon runtime.
const unlit = document.createExtension(KHRMaterialsUnlit);
for (const material of root.listMaterials()) {
  material.setExtension('KHR_materials_unlit', unlit.createUnlit());
  material.setNormalTexture(null).setOcclusionTexture(null).setEmissiveTexture(null).setMetallicRoughnessTexture(null);
}
await document.transform(prune({ keepLeaves: true }));
const textureStats = [];
document.createExtension(EXTTextureWebP).setRequired(true);
for (const texture of root.listTextures()) {
  const original = texture.getImage(); const info = await sharp(original).metadata();
  const webp = await sharp(original).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).webp({ quality: 87, alphaQuality: 100, effort: 5 }).toBuffer();
  texture.setImage(webp).setMimeType('image/webp');
  textureStats.push({ name: texture.getName(), before: original.length, after: webp.length, sourceSize: [info.width, info.height] });
}
await MeshoptSimplifier.ready;
await document.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: .55, error: .0008, lockBorder: true }),
  dedup(),
);
// The generic join transform skips skinned nodes. These source nodes have
// identity transforms and the same rig: join only identical skin/material/
// attribute layouts, keeping the face's one morph target separate.
const sourceNodes = root.listNodes().filter(node => node.getMesh());
const groups = new Map();
for (const node of sourceNodes) {
  if (JSON.stringify(node.getTranslation()) !== '[0,0,0]' || JSON.stringify(node.getRotation()) !== '[0,0,0,1]' || JSON.stringify(node.getScale()) !== '[1,1,1]') throw Error('Unexpected mesh transform');
  for (const primitive of node.getMesh().listPrimitives()) {
    const key = [root.listSkins().indexOf(node.getSkin()), root.listMaterials().indexOf(primitive.getMaterial()), primitive.listSemantics().sort().join(','), primitive.listTargets().length].join('/');
    if (!groups.has(key)) groups.set(key, { skin: node.getSkin(), primitives: [] });
    groups.get(key).primitives.push(primitive);
  }
}
for (const { skin, primitives } of groups.values()) {
  const morph = primitives[0].listTargets().length > 0;
  if (morph && primitives.length !== 1) throw Error('Blink primitives must stay separate');
  const mesh = document.createMesh(primitives[0].getMaterial().getName()).addPrimitive(morph ? primitives[0] : joinPrimitives(primitives));
  if (primitives[0].listTargets().length) mesh.setExtras({ targetNames: ['Blink'] }).setWeights([0]);
  root.getDefaultScene().addChild(document.createNode(mesh.getName()).setMesh(mesh).setSkin(skin));
}
for (const node of sourceNodes) node.dispose();
await document.transform(
  prune({ keepLeaves: true }),
  quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 12, quantizeWeight: 8 }),
  dedup(), prune({ keepLeaves: true }),
);
const optimized = await io.writeBinary(document);
const validation = await validator.validateBytes(optimized, { maxIssues: 30 });
if (validation.issues.numErrors) throw Error(JSON.stringify(validation.issues));
const output = new URL('../../content/characters/zannenin/assets/models/zannenin-v11-gallery.glb', import.meta.url);
await mkdir(new URL('.', output), { recursive: true }); await writeFile(output, optimized);
const report = {
  source: path.basename(process.argv[2]), sourceSha256, before,
  after: { bytes: optimized.length, draws: root.listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0), triangles: root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((s, p) => s + p.getIndices().getCount() / 3, 0), 0), textures: root.listTextures().length },
  textures: textureStats, validation: validation.issues,
};
await writeFile(new URL('v11-optimization.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ before: report.before, after: report.after, validation: report.validation }, null, 2));
