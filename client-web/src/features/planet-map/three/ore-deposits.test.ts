import * as THREE from 'three';
import { createOreDeposit, disposeOreDeposits, oreAssets, oreProfile, setOreDepositTime } from './ore-deposits';

// 扫描岩石在 jsdom 里没法真加载（fetch + Image）：用一个可辨识的替身网格，
// 验证「岩石类矿座改用扫描网格 + 金属类伴生件是闪点」这条契约。
vi.mock('./terrain/rock-meshes', () => {
  const geometry = new THREE.IcosahedronGeometry(1, 3);   // 320 面/块，远高于程序化岩块的 20 面
  geometry.translate(0, 0.5, 0);
  return {
    ROCK_MESH_NAMES: ['test_a'],
    preloadRockMeshes: () => Promise.resolve([
      { name: 'test_a', geometry, material: new THREE.MeshStandardMaterial(), faces: 1280 },
    ]),
  };
});

function meshes(group: THREE.Object3D) {
  const result: THREE.Mesh[] = [];
  group.traverse((object) => { if (object instanceof THREE.Mesh) result.push(object); });
  return result;
}

describe('ore deposits', () => {
  afterEach(() => disposeOreDeposits());

  it('picks distinct profiles for the catalog resource kinds', () => {
    expect(oreProfile('iron_ore').kind).toBe('rock');
    expect(oreProfile('silicon_ore').kind).toBe('crystal');
    expect(oreProfile('crude_oil').kind).toBe('liquid');
    expect(oreProfile('water').kind).toBe('liquid');
    expect(oreProfile('sulfuric_acid').kind).toBe('liquid');
    expect(oreProfile('log').kind).toBe('tree');
    expect(oreProfile('plant_fuel').kind).toBe('bush');
    // 未知稀有矿：走晶体变体，颜色来自物品配色表而不是随机色。
    expect(oreProfile('fire_ice').kind).toBe('crystal');
    expect(oreProfile('unknown_thing').kind).toBe('crystal');
  });

  it('shares geometry and materials between instances of the same kind (batchable)', () => {
    const first = createOreDeposit('iron_ore', { variant: 1 });
    const second = createOreDeposit('iron_ore', { variant: 1 });
    const [a] = meshes(first), [b] = meshes(second);
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    // 不同 kind 不能共享。
    const copper = createOreDeposit('copper_ore', { variant: 1 });
    expect(meshes(copper)[0].geometry).not.toBe(a.geometry);
  });

  it('is deterministic for a given kind and variant', () => {
    const first = createOreDeposit('silicon_ore', { variant: 2 });
    const second = createOreDeposit('silicon_ore', { variant: 2 });
    const positions = (group: THREE.Group) => meshes(group).map(mesh => Array.from(mesh.geometry.attributes.position.array as Float32Array));
    expect(positions(first)).toEqual(positions(second));
  });

  it('keeps the outcrop below the belt deck when a building covers the tile', () => {
    const open = createOreDeposit('stone_ore');
    const covered = createOreDeposit('stone_ore', { covered: true });
    expect(covered.scale.y).toBeLessThan(open.scale.y * 0.2);
  });

  it('drops the crystal/liquid layer when depleted and keeps a shared depleted material', () => {
    const full = createOreDeposit('silicon_ore');
    const depleted = createOreDeposit('silicon_ore', { depleted: true });
    expect(meshes(full)).toHaveLength(2);
    expect(meshes(depleted)).toHaveLength(1);
    expect(meshes(createOreDeposit('silicon_ore', { depleted: true }))[0].material).toBe(meshes(depleted)[0].material);
    expect(depleted.scale.y).toBeLessThan(1);
  });

  it('drives liquid shimmer from a freeze-safe time uniform', () => {
    const group = createOreDeposit('crude_oil');
    const material = meshes(group)[1].material as THREE.MeshStandardMaterial;
    expect(material.customProgramCacheKey()).toContain('ore-liquid-oil');
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' } as unknown as Parameters<typeof material.onBeforeCompile>[0];
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.swOreTime).toBeDefined();
    setOreDepositTime(3.5);
    expect(shader.uniforms.swOreTime.value).toBe(3.5);
    setOreDepositTime(0);
    expect(shader.uniforms.swOreTime.value).toBe(0);
  });

  it('uses scanned Poly Haven rocks for stone/iron/copper/coal/titanium once loaded', async () => {
    // 扫描岩石异步加载：就绪后岩石类矿座改用真实网格（三角数远高于 7 块二十面体的 140 面），
    // 金属类（铁/铜/钛）的伴生件是闪点而不是第二块岩。
    const { preloadOreRocks, oreAssets: assets } = await import('./ore-deposits');
    await preloadOreRocks();
    const faces = (kind: string) => {
      const entry = assets(kind, 0) as unknown as { baseGeometry: THREE.BufferGeometry; accentGeometry: THREE.BufferGeometry };
      return (entry.baseGeometry.index?.count ?? entry.baseGeometry.attributes.position.count) / 3;
    };
    expect(faces('stone_ore')).toBeGreaterThan(500);
    expect(faces('coal')).toBeGreaterThan(500);
    // 铁：矿座是扫描岩石，闪点是细碎八面体（三角数远小于矿座）。
    const iron = assets('iron_ore', 0) as unknown as { baseGeometry: THREE.BufferGeometry; accentGeometry: THREE.BufferGeometry };
    const ironAccent = (iron.accentGeometry.index?.count ?? iron.accentGeometry.attributes.position.count) / 3;
    expect(ironAccent).toBeLessThan(400);
    expect(faces('iron_ore')).toBeGreaterThan(500);
    // 钛矿按造型归到岩石类（不再用晶簇）。
    expect(oreProfile('titanium_ore').kind).toBe('rock');
  });

  it('reuses one asset cache entry per kind/variant and disposes it', () => {
    const a = oreAssets('coal', 0), b = oreAssets('coal', 0);
    expect(a).toBe(b);
    disposeOreDeposits();
    expect(oreAssets('coal', 0)).not.toBe(a);
  });
});
