import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { IndustrialModels } from './industrial-models';
import { StaticBatches, type StaticBatchEntry } from './static-batches';

/**
 * 边界用例（plan §边界用例）：同类建筑 100 栋，静态批次数与单栋同量级
 * （同类共享几何/材质，不随实例数增长）。
 */
describe('100 identical buildings keep a constant static batch count', () => {
  const count = (entries: StaticBatchEntry[]) => {
    const batches = new StaticBatches();
    batches.refresh(entries);
    const stats = batches.stats;
    batches.dispose();
    return stats;
  };

  it('one building and one hundred buildings produce the same batch count', () => {
    const models = new IndustrialModels();
    const layer = new THREE.Group();
    const build = (n: number) => Array.from({ length: n }, (_, index) => {
      const root = models.building('arc_smelter', 1, 1, true);
      root.position.set(index * 2, 0, 0);
      layer.add(root);
      return { root, layer, tile: { x: index, y: 0 } };
    });
    const one = count(build(1));
    const hundred = count(build(100));
    expect(hundred.batches).toBe(one.batches);
    expect(hundred.instances).toBe(one.instances * 100);
    // 每栋的静态网格全部进了实例批（没有留在场景里逐栋绘制）。
    expect(hundred.sourceMeshes).toBe(one.sourceMeshes * 100);
    models.dispose();
  });

  it('mixed building types stay within a small constant number of batches', () => {
    const models = new IndustrialModels();
    const layer = new THREE.Group();
    const types = ['headquarters', 'arc_smelter', 'mining_machine', 'wind_turbine'];
    const entries = Array.from({ length: 100 }, (_, index) => {
      const root = models.building(types[index % types.length], 1, 1, true);
      root.position.set(index * 2, 0, 0);
      layer.add(root);
      return { root, layer, tile: { x: index, y: 0 } };
    });
    const stats = count(entries);
    // 4 种建筑 × 每种的静态材质族（≤ 7 种共享材质）——远小于 100。
    expect(stats.batches).toBeLessThan(30);
    models.dispose();
  });
});
