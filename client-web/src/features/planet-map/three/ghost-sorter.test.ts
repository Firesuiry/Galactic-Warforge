import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  SORTER_GHOST_COLOR,
  SORTER_GHOST_OPACITY,
  SORTER_GHOST_OUTLINE,
  sorterGhostGroup,
} from './ghost-sorter';

/**
 * 建造 ghost 的分拣器本体（DSP 放置预览）：半透明机体必须**一眼认出是分拣器**，
 * 尺寸按 docs/guide/传送带与分拣器DSP化.md §1.1（低矮圆底座 + 立柱 + 横臂 + 夹爪，
 * 总高 ≤ .55 格），并且不依赖 industrial-models（那份模型由分拣器代理并发重写）。
 */
describe('分拣器建造 ghost 机体', () => {
  const collect = (group: THREE.Group) => {
    const body: THREE.Mesh[] = [];
    const outline: THREE.Mesh[] = [];
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.userData.ghostRole === 'body') body.push(object);
      if (object.userData.ghostRole === 'outline') outline.push(object);
    });
    return { body, outline };
  };

  it('机体 = 真光照半透明绿色（写深度/单面），每个部件都有一圈深色反向外壳', () => {
    const group = sorterGhostGroup();
    const { body, outline } = collect(group);
    expect(body.length).toBeGreaterThanOrEqual(12);
    expect(outline.length).toBe(body.length);
    for (const mesh of body) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(material.transparent).toBe(true);
      // 写深度：不写的话 10+ 个重叠透明面会叠成一团亮斑（1018 实测）。
      expect(material.depthWrite).toBe(true);
      expect(material.side).toBe(THREE.FrontSide);
      expect(material.color.getHexString()).toBe(new THREE.Color(SORTER_GHOST_COLOR).getHexString());
      // 自发光用更饱和的绿（只加亮度会把机体冲成惨白）。
      expect(material.emissive.getHexString()).toBe(new THREE.Color('#2fd489').getHexString());
      expect(material.emissiveIntensity).toBeGreaterThan(0);
      expect(material.opacity).toBeGreaterThanOrEqual(SORTER_GHOST_OPACITY);
      expect(material.opacity).toBeLessThanOrEqual(SORTER_GHOST_OPACITY + .2);
    }
    for (const mesh of outline) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      expect(material.side).toBe(THREE.BackSide);
      expect(material.depthWrite).toBe(false);
      expect(material.color.getHexString()).toBe(new THREE.Color(SORTER_GHOST_OUTLINE).getHexString());
      // 外壳比本体大一圈，只在剪影外缘露出一道深色轮廓。
      expect(mesh.scale.x).toBeGreaterThan(1);
      expect(mesh.renderOrder).toBeLessThan(body[0].renderOrder);
    }
  });

  it('尺寸按 §1.1：总高 ≤ .55 格、机体直径 ≤ .62 格（底板按 foundation 铺满一格）', () => {
    const group = sorterGhostGroup();
    const { body } = collect(group);
    const bodyBox = new THREE.Box3();
    for (const mesh of body) {
      if (mesh.geometry.type === 'BoxGeometry' && (mesh.geometry as THREE.BoxGeometry).parameters.width > .9) continue; // foundation 底板
      bodyBox.expandByObject(mesh);
    }
    const size = bodyBox.max.clone().sub(bodyBox.min);
    expect(size.y).toBeLessThanOrEqual(.55 + 1e-6);
    expect(size.y).toBeGreaterThan(.4);
    // 机体水平范围 = foundation 底板 .96 格（外壳 1.12 倍 ≈ 1.075）；横臂伸向取货端
    // （会探出格边）是分拣器的特征，所以只量非横臂部件。
    const nonArmBox = new THREE.Box3();
    const arm = group.getObjectByName('sorter-ghost-arm')!;
    for (const mesh of body) if (!arm.getObjectById(mesh.id)) nonArmBox.expandByObject(mesh);
    const footprint = nonArmBox.max.clone().sub(nonArmBox.min);
    expect(Math.max(footprint.x, footprint.z)).toBeLessThanOrEqual(.96 + 1e-6);
    // 贴地：最低点在 y ≈ 0。
    expect(bodyBox.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(bodyBox.min.y).toBeLessThanOrEqual(.02);
  });

  it('机械臂旋到取货端（模型 +Z = 背面）：ghost 上能读出取货侧', () => {
    const group = sorterGhostGroup();
    const arm = group.getObjectByName('sorter-ghost-arm');
    expect(arm).toBeDefined();
    expect(arm!.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
    const direction = new THREE.Vector3(1, 0, 0).applyQuaternion(arm!.quaternion);
    expect(direction.z).toBeCloseTo(1, 6);
    expect(direction.x).toBeCloseTo(0, 6);
  });

  it('每次重建返回新 group，但共享几何/材质（hover 重建不制造 GPU 垃圾）', () => {
    const first = sorterGhostGroup();
    const second = sorterGhostGroup();
    expect(second).not.toBe(first);
    const meshes = (group: THREE.Group) => {
      const found: THREE.Mesh[] = [];
      group.traverse((object) => { if (object instanceof THREE.Mesh) found.push(object); });
      return found;
    };
    const a = meshes(first);
    const b = meshes(second);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 1) {
      expect(a[i].geometry).toBe(b[i].geometry);
      // `clearMarks` 靠这个标记跳过共享几何的 dispose。
      expect(a[i].geometry.userData.shared).toBe(true);
      expect(a[i].material).toBe(b[i].material);
      expect((a[i].material as THREE.Material).userData.shared).toBe(true);
    }
  });
});
