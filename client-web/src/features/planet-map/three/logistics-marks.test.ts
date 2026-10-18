import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Building, BuildingSorterState, SplitterConfig } from '@shared/types';

import { LogisticsDirectionMarks, beltDeckTexture, directionArrowTexture, filterLabelTexture } from './logistics-marks';
import { TIER_COLOR } from '../logistics-tier';
import { tileFrame, tileNormal, surfaceTileSize } from './projection';

/** 分拣器方向只由 rotation 决定（服务端 SorterState 已无方向字段）。 */
const sorter = (id: string, x: number, y: number, rotation: '0' | '90' | '180' | '270' = '90', items: string[] = []): Building => ({
  id, type: 'sorter_mk1', position: { x, y, z: 0 }, owner_id: 'p', rotation,
  sorter: {
    cycle_ticks: 6, range: 3,
    filter: { mode: 'allow', items },
  } as unknown as BuildingSorterState,
} as Building);

const splitter = (id: string, x: number, y: number, config: SplitterConfig = { input_directions: ['west'], output_directions: ['east', 'north', 'south'] }): Building => ({
  id, type: 'splitter', position: { x, y, z: 0 }, owner_id: 'p',
  splitter: { ...config, input_cursor: 0, output_cursor: 0, transferred_items: 0, last_transfer_tick: 0 },
} as Building);

describe('3D 物流方向标记', () => {
  it('方向纹理只创建一次并缓存（同 key 同实例），带面按档位各一张', () => {
    expect(beltDeckTexture(1)).toBe(beltDeckTexture(1));
    expect(beltDeckTexture(2)).toBe(beltDeckTexture(2));
    expect(beltDeckTexture(3)).toBe(beltDeckTexture(3));
    // 三档各一张（档位色不同），不能共用一张。
    expect(new Set([beltDeckTexture(1), beltDeckTexture(2), beltDeckTexture(3)]).size).toBe(3);
    // 1 次重复 = 1 格：u 方向重复，滚动 offset 的单位就是「格」。
    expect(beltDeckTexture(1).wrapS).toBe(THREE.RepeatWrapping);
    expect(beltDeckTexture(1).wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(directionArrowTexture()).toBe(directionArrowTexture());
    expect(filterLabelTexture('铁', '#fff')).toBe(filterLabelTexture('铁', '#fff'));
    expect(filterLabelTexture('铁', '#fff')).not.toBe(filterLabelTexture('铜', '#fff'));
  });

  it('does not draw top-face arrows for sorters: their flow is the gate rig base plate', () => {
    const marks = new LogisticsDirectionMarks();
    // 分拣器不再画顶面箭头（第 19 轮：门控 rig 的底板三角表达流向）。
    expect(marks.refresh([sorter('s1', 4, 4, '90'), sorter('s2', 6, 6, '180')], 16, 100)).toBe(true);
    expect(marks.group.children).toHaveLength(0);
    // rotation 变化也不会凭空长出箭头。
    expect(marks.refresh([sorter('s1', 4, 4, '270')], 16, 100)).toBe(false);
    expect(marks.group.children).toHaveLength(0);
    marks.dispose();
  });

  it('draws one merged arrow mesh for splitters and rebuilds when their config changes', () => {
    const marks = new LogisticsDirectionMarks();
    const buildings = [splitter('s1', 4, 4), splitter('s2', 6, 6, { input_directions: ['west'], output_directions: ['east'] })];
    expect(marks.refresh(buildings, 16, 100)).toBe(true);
    const meshes = marks.group.children.filter(child => child instanceof THREE.Mesh);
    expect(meshes).toHaveLength(1);
    // s1 三条输出（3 支箭头），s2 一条输出（1 支）：每支 6 顶点。
    expect((meshes[0] as THREE.Mesh).geometry.getAttribute('position').count).toBe(4 * 6);
    expect(marks.refresh(buildings, 16, 100)).toBe(false);
    // 端口配置变化 → 签名变化 → 重建。
    expect(marks.refresh([buildings[0], splitter('s2', 6, 6, { input_directions: ['west'], output_directions: ['east', 'north'] })], 16, 100)).toBe(true);
    expect((marks.group.children[0] as THREE.Mesh).geometry.getAttribute('position').count).toBe(5 * 6);
    marks.dispose();
  });

  it('四向皆可的分流器画四条向外的枢纽标记（不猜单一流向）', () => {
    const marks = new LogisticsDirectionMarks();
    marks.refresh([splitter('hub', 4, 4, { input_directions: ['north', 'east', 'south', 'west'], output_directions: ['north', 'east', 'south', 'west'] })], 16, 100);
    // 四支短箭头 × 6 顶点。
    expect((marks.group.children[0] as THREE.Mesh).geometry.getAttribute('position').count).toBe(24);
    marks.dispose();
  });

  it('picks the splitter tile from the merged arrow mesh', () => {
    const marks = new LogisticsDirectionMarks();
    const buildings = [splitter('s1', 4, 4), splitter('s2', 6, 6)];
    marks.refresh(buildings, 16, 100);
    const mesh = marks.group.children[0] as THREE.Mesh;
    const indices = mesh.geometry.getAttribute('tileIndex');
    const triangleFor = (tile: number) => Array.from({ length: indices.count / 3 }, (_, i) => i).find(i => indices.getX(i * 3) === tile)!;
    const hit = (tile: number) => ({ object: mesh, faceIndex: triangleFor(tile), distance: 1, point: new THREE.Vector3() });
    expect(marks.resolveHit(hit(0))).toEqual({ x: 4, y: 4 });
    expect(marks.resolveHit(hit(1))).toEqual({ x: 6, y: 6 });
    expect(marks.resolveHit({ ...hit(0), object: new THREE.Mesh() })).toBeNull();
    marks.dispose();
  });

  it('过滤物品标签：配了过滤的分拣器才挂 sprite，挂在闸座侧面而不是格心正上方', () => {
    const marks = new LogisticsDirectionMarks();
    const buildings = [sorter('s1', 4, 4, '90', ['iron_ore']), sorter('s2', 6, 6, '90')];
    marks.refresh(buildings, 16, 100);
    marks.refreshLabels(buildings, 16, 100, () => ({ text: '铁', color: '#cccccc' }));
    const sprites = marks.group.children.filter(child => child instanceof THREE.Sprite);
    expect(sprites).toHaveLength(1);
    // 标签横向偏移 .42 格：位于闸座侧面（摆臂翻过头顶时不会穿过标签），不在格心法线上。
    const size = surfaceTileSize(100, 16);
    const sprite = sprites[0] as THREE.Sprite;
    const normal = tileNormal({ x: 4, y: 4 }, 16);
    const height = sprite.position.dot(normal);
    expect(height).toBeCloseTo(100 + size * .5, 5);
    const lateral = sprite.position.clone().sub(normal.clone().multiplyScalar(height));
    expect(lateral.length()).toBeCloseTo(size * .42, 6);
    // 偏移方向垂直于分拣器朝向轴（rotation=90 → 朝东），即沿南北。
    const frame = tileFrame({ x: 4, y: 4 }, 16);
    expect(Math.abs(lateral.dot(frame.east))).toBeLessThan(size * .02);
    expect(Math.abs(lateral.dot(frame.south))).toBeCloseTo(size * .42, 5);
    // 标签随数据变化重建（不累积）。
    marks.refreshLabels([], 16, 100, () => ({ text: '铁', color: '#cccccc' }));
    expect(marks.group.children.filter(child => child instanceof THREE.Sprite)).toHaveLength(0);
    marks.dispose();
  });

  it('无分流器时不产生任何 draw', () => {
    const marks = new LogisticsDirectionMarks();
    marks.refresh([{ id: 'b', type: 'arc_smelter', position: { x: 1, y: 1, z: 0 }, owner_id: 'p' } as Building], 16, 100);
    expect(marks.group.children).toHaveLength(0);
    marks.dispose();
  });

  it('uses the contracted tier colours for the deck textures', () => {
    expect(TIER_COLOR[1]).toBe('#f5b942');
    expect(TIER_COLOR[2]).toBe('#46d483');
    expect(TIER_COLOR[3]).toBe('#3ea6ff');
  });
});
