import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Building, BuildingSorterState } from '@shared/types';

import { LogisticsDirectionMarks, beltChevronTexture, directionArrowTexture, filterLabelTexture } from './logistics-marks';

/** 分拣器方向只由 rotation 决定（服务端 SorterState 已无方向字段）。 */
const sorter = (id: string, x: number, y: number, rotation: '0' | '90' | '180' | '270' = '90', items: string[] = []): Building => ({
  id, type: 'sorter_mk1', position: { x, y, z: 0 }, owner_id: 'p', rotation,
  sorter: {
    cycle_ticks: 6, range: 1,
    filter: { mode: 'allow', items },
  } as unknown as BuildingSorterState,
} as Building);

describe('3D 物流方向标记', () => {
  it('方向纹理只创建一次并缓存（同 key 同实例）', () => {
    expect(beltChevronTexture()).toBe(beltChevronTexture());
    expect(directionArrowTexture()).toBe(directionArrowTexture());
    expect(filterLabelTexture('铁', '#fff')).toBe(filterLabelTexture('铁', '#fff'));
    expect(filterLabelTexture('铁', '#fff')).not.toBe(filterLabelTexture('铜', '#fff'));
  });

  it('分拣器顶面箭头：每个分拣器一支箭头，合并成 1 个 mesh，签名不变时不重建', () => {
    const marks = new LogisticsDirectionMarks();
    const buildings = [sorter('s1', 4, 4, '90'), sorter('s2', 6, 6, '180')];
    expect(marks.refresh(buildings, 16, 100)).toBe(true);
    const meshes = marks.group.children.filter(child => child instanceof THREE.Mesh);
    expect(meshes).toHaveLength(1);
    const mesh = meshes[0] as THREE.Mesh;
    // 2 条箭头 × 6 顶点 = 12 个顶点。
    expect(mesh.geometry.getAttribute('position').count).toBe(12);
    expect(marks.refresh(buildings, 16, 100)).toBe(false);
    // rotation 变化 → 签名变化 → 重建（方向跟着转）。
    expect(marks.refresh([sorter('s1', 4, 4, '270'), sorter('s2', 6, 6, '180')], 16, 100)).toBe(true);
    marks.dispose();
  });

  it('分拣器方向跟 rotation 走，不存在「四向皆可」的枢纽标记（第 16 轮契约）', () => {
    const marks = new LogisticsDirectionMarks();
    marks.refresh([sorter('hub', 4, 4, '0')], 16, 100);
    // 单支箭头 × 6 顶点，而不是四条向外的枢纽标记。
    expect((marks.group.children[0] as THREE.Mesh).geometry.getAttribute('position').count).toBe(6);
    expect(marks.refresh([sorter('hub', 4, 4, '90')], 16, 100)).toBe(true);
    marks.dispose();
  });

  it('过滤物品标签：配了过滤的分拣器才挂 sprite（首字 + catalog 色）', () => {
    const marks = new LogisticsDirectionMarks();
    const buildings = [sorter('s1', 4, 4, '90', ['iron_ore']), sorter('s2', 6, 6, '90')];
    marks.refresh(buildings, 16, 100);
    marks.refreshLabels(buildings, 16, 100, () => ({ text: '铁', color: '#cccccc' }));
    const sprites = marks.group.children.filter(child => child instanceof THREE.Sprite);
    expect(sprites).toHaveLength(1);
    // 标签随数据变化重建（不累积）。
    marks.refreshLabels([], 16, 100, () => ({ text: '铁', color: '#cccccc' }));
    expect(marks.group.children.filter(child => child instanceof THREE.Sprite)).toHaveLength(0);
    marks.dispose();
  });

  it('无分拣器时不产生任何 draw', () => {
    const marks = new LogisticsDirectionMarks();
    marks.refresh([{ id: 'b', type: 'arc_smelter', position: { x: 1, y: 1, z: 0 }, owner_id: 'p' } as Building], 16, 100);
    expect(marks.group.children).toHaveLength(0);
    marks.dispose();
  });
});
