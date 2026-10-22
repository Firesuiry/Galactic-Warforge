import * as THREE from 'three';
import { createOreDeposit, disposeOreDeposits, oreAssets, oreProfile, setOreDepositTime } from './ore-deposits';

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

  it('reuses one asset cache entry per kind/variant and disposes it', () => {
    const a = oreAssets('coal', 0), b = oreAssets('coal', 0);
    expect(a).toBe(b);
    disposeOreDeposits();
    expect(oreAssets('coal', 0)).not.toBe(a);
  });
});
