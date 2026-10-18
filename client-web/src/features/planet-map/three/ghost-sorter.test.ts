import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { SORTER_GHOST_COLOR, SORTER_GHOST_OPACITY, sorterGhostGroup } from './ghost-sorter';

/**
 * 建造 ghost 的分拣器本体（DSP 放置预览）：半透明机体必须**一眼认出是分拣器**，
 * 尺寸按 docs/guide/传送带与分拣器DSP化.md §1.1（低矮圆底座 + 立柱 + 横臂 + 夹爪，
 * 总高 ≤ .55 格），并且不依赖 industrial-models（那份模型由分拣器代理并发重写）。
 */
describe('分拣器建造 ghost 机体', () => {
  it('半透明绿色、不写深度（DSP 玻璃感），所有部件同一口径', () => {
    const group = sorterGhostGroup();
    const meshes: THREE.Mesh[] = [];
    group.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });
    expect(meshes.length).toBeGreaterThanOrEqual(10);
    for (const mesh of meshes) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.toneMapped).toBe(false);
      expect(material.color.getHexString()).toBe(new THREE.Color(SORTER_GHOST_COLOR).getHexString());
      // 主色 .42；铜环/夹爪指等点缀略亮一档（机体有层次，不是一团绿）。
      expect(material.opacity).toBeGreaterThanOrEqual(SORTER_GHOST_OPACITY);
      expect(material.opacity).toBeLessThanOrEqual(SORTER_GHOST_OPACITY + .15);
    }
  });

  it('尺寸按 §1.1：总高 ≤ .55 格、直径 ≤ .62 格（不能比熔炉抢眼）', () => {
    const group = sorterGhostGroup();
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const size = box.max.clone().sub(box.min);
    expect(size.y).toBeLessThanOrEqual(.55 + 1e-6);
    expect(size.y).toBeGreaterThan(.4);
    // 底座/立柱/铜环等本体不超过 Φ.62；横臂伸向取货端（会探出格边）是分拣器的特征。
    const body = new THREE.Box3();
    for (const child of group.children) if (child.name !== 'sorter-ghost-arm') body.expandByObject(child);
    const bodySize = body.max.clone().sub(body.min);
    expect(Math.max(bodySize.x, bodySize.z)).toBeLessThanOrEqual(.62 + 1e-6);
    // 贴地：最低点在 y ≈ 0（底座盘底面）。
    expect(box.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(box.min.y).toBeLessThanOrEqual(.01);
  });

  it('机械臂旋到取货端（模型 +Z = 背面）：ghost 上能读出取货侧', () => {
    const group = sorterGhostGroup();
    const arm = group.getObjectByName('sorter-ghost-arm');
    expect(arm).toBeDefined();
    expect(arm!.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
    // +X 生长的手臂绕 Y 转 -90° 后指向 +Z。
    const direction = new THREE.Vector3(1, 0, 0).applyQuaternion(arm!.quaternion);
    expect(direction.z).toBeCloseTo(1, 6);
    expect(direction.x).toBeCloseTo(0, 6);
  });

  it('每次重建返回新 group，但共享几何/材质（hover 重建不制造 GPU 垃圾）', () => {
    const first = sorterGhostGroup();
    const second = sorterGhostGroup();
    expect(second).not.toBe(first);
    const geometriesOf = (group: THREE.Group) => {
      const found: THREE.BufferGeometry[] = [];
      group.traverse((object) => { if (object instanceof THREE.Mesh) found.push(object.geometry); });
      return found;
    };
    const a = geometriesOf(first);
    const b = geometriesOf(second);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 1) {
      expect(a[i]).toBe(b[i]);
      // `clearMarks` 靠这个标记跳过共享几何的 dispose。
      expect(a[i].userData.shared).toBe(true);
    }
    const materialsOf = (group: THREE.Group) => {
      const found: THREE.Material[] = [];
      group.traverse((object) => { if (object instanceof THREE.Mesh) found.push(object.material as THREE.Material); });
      return found;
    };
    for (let i = 0; i < materialsOf(first).length; i += 1) {
      expect(materialsOf(first)[i]).toBe(materialsOf(second)[i]);
      expect(materialsOf(first)[i].userData.shared).toBe(true);
    }
  });
});
