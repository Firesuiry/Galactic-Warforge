import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Building, BuildingSorterState } from '@shared/types';

import { LogisticsDirectionMarks, beltChevronTexture, directionArrowTexture, filterLabelTexture } from './logistics-marks';

const sorter = (id: string, x: number, y: number, inputs: string[], outputs: string[], items: string[] = []): Building => ({
  id, type: 'sorter_mk1', position: { x, y, z: 0 }, owner_id: 'p',
  sorter: {
    input_directions: inputs, output_directions: outputs, speed: 1, range: 1,
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

  it('分拣器顶面箭头：按取料×放料组合合并成 1 个 mesh，签名不变时不重建', () => {
    const marks = new LogisticsDirectionMarks();
    const buildings = [sorter('s1', 4, 4, ['west'], ['east']), sorter('s2', 6, 6, ['north', 'west'], ['east'])];
    expect(marks.refresh(buildings, 16, 100)).toBe(true);
    const meshes = marks.group.children.filter(child => child instanceof THREE.Mesh);
    expect(meshes).toHaveLength(1);
    const mesh = meshes[0] as THREE.Mesh;
    // 3 条箭头 × 6 顶点 = 18 个顶点。
    expect(mesh.geometry.getAttribute('position').count).toBe(18);
    expect(marks.refresh(buildings, 16, 100)).toBe(false);
    expect(marks.refresh([sorter('s1', 4, 4, ['west'], ['south'])], 16, 100)).toBe(true);
    marks.dispose();
  });

  it('四向皆可的分拣器画枢纽标记（4 条向外箭头），不猜单一流向', () => {
    const marks = new LogisticsDirectionMarks();
    const hub = sorter('hub', 4, 4, ['north', 'east', 'south', 'west'], ['north', 'east', 'south', 'west']);
    marks.refresh([hub], 16, 100);
    const mesh = marks.group.children[0] as THREE.Mesh;
    expect(mesh.geometry.getAttribute('position').count).toBe(4 * 6);
    marks.dispose();
  });

  it('过滤物品标签：配了过滤的分拣器才挂 sprite（首字 + catalog 色）', () => {
    const marks = new LogisticsDirectionMarks();
    const buildings = [sorter('s1', 4, 4, ['west'], ['east'], ['iron_ore']), sorter('s2', 6, 6, ['west'], ['east'])];
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
