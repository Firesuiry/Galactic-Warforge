/** 检查原始 GLB 的结构：节点树、材质、贴图、三角数、包围盒。用于规划规整参数与炮塔拆分。 */
import { readdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const here = dirname(fileURLToPath(import.meta.url));
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const args = process.argv.slice(2);
const dirs = args.length ? args : (await readdir(resolve(here, 'raw'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);

for (const dir of dirs) {
  const full = resolve(here, 'raw', dir);
  const files = (await readdir(full)).filter((f) => f.endsWith('.glb'));
  for (const file of files) {
    let doc;
    try {
      doc = await io.read(resolve(full, file));
    } catch (error) {
      console.log(`\n=== ${dir}/${file}  读取失败（可能仍在下载）：${error.message}`);
      continue;
    }
    const root = doc.getRoot();
    const prims = root.listMeshes().flatMap((m) => m.listPrimitives());
    const tris = Math.round(prims.reduce((sum, p) => sum + (p.getIndices() ? p.getIndices().getCount() / 3 : 0), 0));
    console.log(`\n=== ${dir}/${file}  tris=${tris} nodes=${root.listNodes().length} mats=${root.listMaterials().length} tex=${root.listTextures().length} anims=${root.listAnimations().length} skins=${root.listSkins().length}`);
    console.log('  tex:', root.listTextures().map((t) => `${t.getSize().join('x')} ${t.getMimeType()}`).join(', '));
    console.log('  mats:', root.listMaterials().map((m) => m.getName() || '(unnamed)').join(' | '));
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    const walk = (node, depth) => {
      const mesh = node.getMesh();
      const extras = [];
      if (mesh) {
        const p = mesh.listPrimitives();
        const t = p.reduce((s, x) => s + (x.getIndices() ? x.getIndices().getCount() / 3 : 0), 0);
        extras.push(`mesh ${Math.round(t)}t`);
      }
      if (node.getCamera()) extras.push('camera');
      console.log(`  ${'  '.repeat(depth)}- ${node.getName() || '(unnamed)'}${extras.length ? ' [' + extras.join(', ') + ']' : ''}`);
      for (const child of node.listChildren()) walk(child, depth + 1);
    };
    if (scene) for (const node of scene.listChildren()) walk(node, 1);
  }
}
