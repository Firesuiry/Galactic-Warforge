import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { IndustrialModels } from './industrial-models';

import {
  GHOST_HORIZONTAL_SCALE,
  GHOST_VERTICAL_SQUASH,
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

  it('尺寸与正片分拣器模型一致（总高 ≤ .5、本体直径 ≤ .62，不垫方形底板）', () => {
    const group = sorterGhostGroup();
    const { body } = collect(group);
    const arm = group.getObjectByName('sorter-ghost-arm')!;
    const bodyBox = new THREE.Box3(), nonArmBox = new THREE.Box3();
    for (const mesh of body) {
      bodyBox.expandByObject(mesh);
      if (!arm.getObjectById(mesh.id)) nonArmBox.expandByObject(mesh);
    }
    const size = bodyBox.max.clone().sub(bodyBox.min);
    expect(size.y).toBeLessThanOrEqual(.5);
    expect(size.y).toBeGreaterThan(.4);
    // 本体（底座 + 立柱）不铺满一格：正片分拣器已删掉方形 foundation，ghost 也不许垫底板。
    const footprint = nonArmBox.max.clone().sub(nonArmBox.min);
    expect(Math.max(footprint.x, footprint.z)).toBeLessThanOrEqual(.62);
    // 贴地：最低点在 y ≈ 0。
    expect(bodyBox.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(bodyBox.min.y).toBeLessThanOrEqual(.02);

    // 与正片模型不漂移：高度/底座宽度差 20% 以内（并发重写时最容易在这里对不上）。
    const real = new IndustrialModels().building('sorter_mk1', .86, .86, true);
    real.updateMatrixWorld(true);
    const realBox = new THREE.Box3().setFromObject(real);
    const realSize = realBox.max.clone().sub(realBox.min);
    // ghost 的原始几何要按场景侧放置缩放（`GHOST_HORIZONTAL_SCALE` / `GHOST_VERTICAL_SQUASH`）
    // 换算，才能和正片模型（`building()` 里已经带 .86/.8 缩放）同口径比较。
    expect(Math.abs(realSize.y - size.y * GHOST_VERTICAL_SQUASH) / realSize.y).toBeLessThan(.02);
    // 底座直径：ghost 原始几何 .58 × 水平缩放 .86 = .5，与正片模型同口径（差异 1% 内）。
    expect(GHOST_HORIZONTAL_SCALE).toBeCloseTo(.86, 6);
    expect(Math.max(footprint.x, footprint.z) * GHOST_HORIZONTAL_SCALE).toBeCloseTo(.58 * GHOST_HORIZONTAL_SCALE, 2);
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
