import { describe, expect, it } from 'vitest';

import type { PlanetView } from '@shared/types';

import {
  LruMap,
  SHORELINE_WIDTH_PX,
  TERRAIN_CHUNK_CACHE_LIMIT,
  TERRAIN_CHUNK_TILE_PX,
  TERRAIN_CHUNK_TILES,
  blockedReliefFactor,
  chunkCountAxis,
  chunkKey,
  chunkSpanAxis,
  computeTerrainChunkPixels,
  computeVisibleChunkKeys,
  edgeDistancePx,
  invertEdgeMask,
  lavaCrustFactor,
  lavaEdgeGlowMix,
  parseChunkKey,
  shorelineFoamMix,
  soilNoiseFactor,
  subPixelNoise,
  terrainChunkSignature,
  terrainNeighborMask,
  useChunkedTerrain,
  waterNoiseFactor,
  type TerrainEdgeMask,
} from '@/features/planet-map/planet-terrain-chunks';

function createPlanet(terrain: string[][]): PlanetView {
  return {
    planet_id: 'planet-test',
    name: 'Test',
    discovered: true,
    kind: 'terrestrial',
    map_width: terrain[0]?.length ?? 0,
    map_height: terrain.length,
    tick: 1,
    terrain: terrain as PlanetView['terrain'],
  } as unknown as PlanetView;
}

function bigPlanet(width: number, height: number, fill = 'buildable'): PlanetView {
  return createPlanet(Array.from({ length: height }, () => Array.from({ length: width }, () => fill)));
}

const NO_MASK: TerrainEdgeMask = { up: false, down: false, left: false, right: false };

describe('chunk 键与几何', () => {
  it('chunkKey/parseChunkKey 往返一致', () => {
    expect(parseChunkKey(chunkKey(3, 17))).toEqual([3, 17]);
    expect(chunkKey(0, 0)).toBe('0,0');
  });

  it('chunkCountAxis/chunkSpanAxis：整除、残块与空轴', () => {
    expect(chunkCountAxis(0)).toBe(0);
    expect(chunkCountAxis(48)).toBe(1);
    expect(chunkCountAxis(64)).toBe(1);
    expect(chunkCountAxis(65)).toBe(2);
    expect(chunkSpanAxis(0, 48)).toBe(48);
    expect(chunkSpanAxis(64, 200)).toBe(64); // 200-128=72 超过上限 → 收窄到 64
    expect(chunkSpanAxis(128, 200)).toBe(64);
  });

  it('chunkSpanAxis 残块收窄与越界归零', () => {
    expect(chunkSpanAxis(64, 70)).toBe(6);
    expect(chunkSpanAxis(200, 200)).toBe(0);
  });
});

describe('可见 chunk 集合计算', () => {
  const MAP = 2000; // 2000×2000 → 32×32 块

  it('相机在原点：可见块含 1 圈余量，按视口中心距离升序', () => {
    const keys = computeVisibleChunkKeys({
      mapWidth: MAP,
      mapHeight: MAP,
      offsetX: 0,
      offsetY: 0,
      tileSize: 8,
      viewportWidth: 1440,
      viewportHeight: 1080,
    });
    // 可见 tile 180×135 → 块 (0..2, 0..2)，余量一圈 → (0..3, 0..3) = 16 块（地图边缘钳位）
    expect(keys.length).toBe(16);
    expect(keys[0]).toBe('1,1'); // 视口中心 tile (90, 67.5) → 块 (1,1) 最近
    expect(keys).toContain('0,0');
    expect(keys).toContain('3,3');
    expect(keys).not.toContain('4,4');
  });

  it('相机平移到地图中部：集合随相机移动', () => {
    const keys = computeVisibleChunkKeys({
      mapWidth: MAP,
      mapHeight: MAP,
      offsetX: -800 * 8, // 视口左上角对准 tile (800, 800)
      offsetY: -800 * 8,
      tileSize: 8,
      viewportWidth: 1440,
      viewportHeight: 1080,
    });
    expect(keys[0]).toBe('13,13'); // 中心 tile (890, 867) → 块 (13,13)
    expect(keys).toContain('11,11');
    expect(keys).not.toContain('0,0');
  });

  it('地图完全在视口内（小图居中）：返回全部块', () => {
    const keys = computeVisibleChunkKeys({
      mapWidth: 48,
      mapHeight: 48,
      offsetX: 528, // 1440 视口居中 384px 小图
      offsetY: 348,
      tileSize: 8,
      viewportWidth: 1440,
      viewportHeight: 1080,
    });
    expect(keys).toEqual(['0,0']);
  });

  it('相机完全离开地图：返回空集合', () => {
    const keys = computeVisibleChunkKeys({
      mapWidth: MAP,
      mapHeight: MAP,
      offsetX: 10_000 * 8,
      offsetY: 0,
      tileSize: 8,
      viewportWidth: 1440,
      viewportHeight: 1080,
    });
    expect(keys).toEqual([]);
  });

  it('余量可调：margin 0 只含严格可见块', () => {
    const keys = computeVisibleChunkKeys({
      mapWidth: MAP,
      mapHeight: MAP,
      offsetX: 0,
      offsetY: 0,
      tileSize: 8,
      viewportWidth: 512,
      viewportHeight: 512,
      margin: 0,
    });
    expect(keys.sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });
});

describe('terrainChunkSignature 脏检测', () => {
  it('同一份数据签名稳定；地形变化签名变；不同 chunk 签名不同', () => {
    const planet = bigPlanet(130, 70);
    const first = terrainChunkSignature(planet, 0, 0);
    expect(terrainChunkSignature(planet, 0, 0)).toBe(first);
    expect(terrainChunkSignature(planet, 1, 0)).not.toBe(first);

    planet.terrain![10][10] = 'water';
    expect(terrainChunkSignature(planet, 0, 0)).not.toBe(first);
    // 改动在 (1,0) 块外时其签名不受影响
    expect(terrainChunkSignature(planet, 1, 0)).toBe(terrainChunkSignature(bigPlanet(130, 70), 1, 0));
  });
});

describe('过渡邻域规则', () => {
  //  4×4：右列水、左下 blocked、lava 在 (3,2) 旁边是水
  const planet = createPlanet([
    ['buildable', 'buildable', 'buildable', 'water'],
    ['buildable', 'buildable', 'buildable', 'water'],
    ['blocked', 'buildable', 'buildable', 'lava'],
    ['buildable', 'buildable', 'buildable', 'buildable'],
  ]);

  it('terrainNeighborMask：4 邻居检测 + 越界视为非目标', () => {
    expect(terrainNeighborMask(planet, 2, 0, 'water')).toEqual({ up: false, down: false, left: false, right: true });
    // (2,1)：上是 buildable、下是 buildable、右是水
    expect(terrainNeighborMask(planet, 2, 1, 'water')).toEqual({ up: false, down: false, left: false, right: true });
    expect(terrainNeighborMask(planet, 0, 0, 'blocked')).toEqual(NO_MASK); // 越界不算 blocked
    // (1,2)：左邻 (0,2) 是 blocked
    expect(terrainNeighborMask(planet, 1, 2, 'blocked')).toEqual({ up: false, down: false, left: true, right: false });
  });

  it('invertEdgeMask 取反', () => {
    expect(invertEdgeMask({ up: true, down: false, left: true, right: false }))
      .toEqual({ up: false, down: true, left: false, right: true });
  });

  it('edgeDistancePx：贴边 0，取多方向最小值，无匹配为 Infinity', () => {
    expect(edgeDistancePx(0, 4, { ...NO_MASK, left: true })).toBe(0);
    expect(edgeDistancePx(3, 4, { ...NO_MASK, left: true })).toBe(3);
    expect(edgeDistancePx(7, 1, { ...NO_MASK, right: true, up: true })).toBe(0);
    expect(edgeDistancePx(5, 2, { ...NO_MASK, right: true, up: true })).toBe(2);
    expect(edgeDistancePx(3, 3, NO_MASK)).toBe(Infinity);
  });

  it('shorelineFoamMix：陆侧 3px 渐变，水/岩浆/无邻水为 0', () => {
    const mask = { ...NO_MASK, left: true };
    expect(shorelineFoamMix('buildable', mask, 0, 4)).toBeCloseTo(0.55, 6);
    expect(shorelineFoamMix('buildable', mask, 1, 4)).toBeCloseTo(0.3, 6);
    expect(shorelineFoamMix('buildable', mask, 2, 4)).toBeCloseTo(0.12, 6);
    expect(shorelineFoamMix('buildable', mask, SHORELINE_WIDTH_PX, 4)).toBe(0);
    expect(shorelineFoamMix('blocked', mask, 0, 0)).toBeCloseTo(0.55, 6);
    expect(shorelineFoamMix('water', mask, 0, 4)).toBe(0);
    expect(shorelineFoamMix('lava', mask, 0, 4)).toBe(0);
    expect(shorelineFoamMix('buildable', NO_MASK, 0, 4)).toBe(0);
  });

  it('lavaEdgeGlowMix：贴边强发光、次格减弱、内部为 0', () => {
    const mask = { ...NO_MASK, up: true };
    expect(lavaEdgeGlowMix('lava', mask, 4, 0)).toBeCloseTo(0.75, 6);
    expect(lavaEdgeGlowMix('lava', mask, 4, 1)).toBeCloseTo(0.35, 6);
    expect(lavaEdgeGlowMix('lava', mask, 4, 2)).toBe(0);
    expect(lavaEdgeGlowMix('buildable', mask, 4, 0)).toBe(0);
  });

  it('blockedReliefFactor：上左高光、下右投影、群山内部为 1', () => {
    expect(blockedReliefFactor('blocked', { ...NO_MASK, up: true }, 4, 0)).toBeCloseTo(1.35, 6);
    expect(blockedReliefFactor('blocked', { ...NO_MASK, up: true }, 4, 1)).toBeCloseTo(1.12, 6);
    expect(blockedReliefFactor('blocked', { ...NO_MASK, down: true }, 4, TERRAIN_CHUNK_TILE_PX - 1)).toBeCloseTo(0.6, 6);
    expect(blockedReliefFactor('blocked', { ...NO_MASK, right: true }, TERRAIN_CHUNK_TILE_PX - 1, 4)).toBeCloseTo(0.6, 6);
    // 角部叠加
    expect(blockedReliefFactor('blocked', { ...NO_MASK, up: true, left: true }, 0, 0)).toBeCloseTo(1.35 * 1.35, 6);
    // 四邻皆 blocked（群山内部）无浮雕
    expect(blockedReliefFactor('blocked', NO_MASK, 0, 0)).toBe(1);
    expect(blockedReliefFactor('buildable', { ...NO_MASK, up: true }, 4, 0)).toBe(1);
  });
});

describe('噪色确定性', () => {
  it('subPixelNoise：同输入同输出，值域 [-1, 1]', () => {
    const first = subPixelNoise(7, 13, 2, 5, 42);
    expect(subPixelNoise(7, 13, 2, 5, 42)).toBe(first);
    for (let i = 0; i < 200; i += 1) {
      const value = subPixelNoise(i * 3, i * 7, i % 8, (i * 5) % 8, i);
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('soil/water 噪色因子确定性且有界（不闪烁）', () => {
    expect(soilNoiseFactor(3, 9, 1, 2)).toBe(soilNoiseFactor(3, 9, 1, 2));
    expect(waterNoiseFactor(3, 9, 1, 2)).toBe(waterNoiseFactor(3, 9, 1, 2));
    for (let i = 0; i < 100; i += 1) {
      expect(soilNoiseFactor(i, i + 1, i % 8, (i * 3) % 8)).toBeGreaterThan(0.8);
      expect(soilNoiseFactor(i, i + 1, i % 8, (i * 3) % 8)).toBeLessThan(1.2);
      expect(waterNoiseFactor(i, i + 1, i % 8, (i * 3) % 8)).toBeGreaterThan(0.85);
      expect(waterNoiseFactor(i, i + 1, i % 8, (i * 3) % 8)).toBeLessThan(1.15);
    }
  });

  it('lavaCrustFactor：只作用岩浆，二值暗壳', () => {
    expect(lavaCrustFactor('buildable', 1, 1, 0, 0)).toBe(1);
    const values = new Set<number>();
    for (let i = 0; i < 64; i += 1) {
      const value = lavaCrustFactor('lava', i, i * 2, i % 8, (i * 3) % 8);
      expect([0.55, 1]).toContain(value);
      values.add(value);
    }
    expect(values.size).toBe(2); // 既有暗壳也有基底
  });
});

describe('computeTerrainChunkPixels', () => {
  it('满块 512×512，残块按实际 tile 收窄，整像素不透明', () => {
    const full = computeTerrainChunkPixels(bigPlanet(130, 70), 0, 0);
    expect(full.width).toBe(TERRAIN_CHUNK_TILES * TERRAIN_CHUNK_TILE_PX);
    expect(full.height).toBe(TERRAIN_CHUNK_TILES * TERRAIN_CHUNK_TILE_PX);
    const partial = computeTerrainChunkPixels(bigPlanet(130, 70), 2, 1);
    expect(partial.width).toBe((130 - 128) * TERRAIN_CHUNK_TILE_PX);
    expect(partial.height).toBe((70 - 64) * TERRAIN_CHUNK_TILE_PX);
    expect(full.data.length).toBe(full.width * full.height * 4);
    for (let i = 3; i < full.data.length; i += 4 * 977) {
      expect(full.data[i]).toBe(255);
    }
  });

  it('确定性：同一份地形两次渲染逐字节一致', () => {
    const planet = createPlanet([
      ['buildable', 'water', 'buildable', 'lava'],
      ['blocked', 'buildable', 'water', 'lava'],
      ['buildable', 'buildable', 'blocked', 'buildable'],
      ['water', 'buildable', 'buildable', 'buildable'],
    ]);
    const first = computeTerrainChunkPixels(planet, 0, 0);
    const second = computeTerrainChunkPixels(planet, 0, 0);
    expect([...first.data]).toEqual([...second.data]);
  });

  it('水岸过渡：陆格贴水侧像素比内侧更亮（泡沫渐变）', () => {
    const planet = createPlanet([
      ['buildable', 'water'],
      ['buildable', 'buildable'],
    ]);
    const { data, width } = computeTerrainChunkPixels(planet, 0, 0);
    const px = (x: number, y: number) => {
      const offset = (y * width + x) * 4;
      return [data[offset], data[offset + 1], data[offset + 2]] as const;
    };
    // (0,0) 格右侧邻水：贴边列 (px=7) 的亮度应高于格中心 (px=3)
    const edge = px(7, 3);
    const inner = px(3, 3);
    expect(edge[0] + edge[1] + edge[2]).toBeGreaterThan(inner[0] + inner[1] + inner[2]);
    // 无水邻的 (1,1) 格不受泡沫影响：贴 (0,0) 一侧与中心无同方向渐变
    const noWater = px(8, 11);
    const noWaterCenter = px(11, 11);
    expect(Math.abs((noWater[0] + noWater[1] + noWater[2]) - (noWaterCenter[0] + noWaterCenter[1] + noWaterCenter[2])))
      .toBeLessThan(edge[0] + edge[1] + edge[2] - (inner[0] + inner[1] + inner[2]));
  });

  it('岩浆描边：贴非岩浆边的像素比内部更亮更橙', () => {
    const planet = createPlanet([
      ['lava', 'buildable'],
      ['lava', 'lava'],
    ]);
    const { data, width } = computeTerrainChunkPixels(planet, 0, 0);
    const px = (x: number, y: number) => {
      const offset = (y * width + x) * 4;
      return [data[offset], data[offset + 1], data[offset + 2]] as const;
    };
    // (1,1) 格上/右邻非岩浆：右上角像素应比中心更亮
    const corner = px(15, 8);
    const center = px(11, 11);
    expect(corner[0]).toBeGreaterThan(center[0]);
  });
});

describe('LruMap', () => {
  it('get 触达改变使用序；evictToCapacity 逐出最久未用', () => {
    const evicted: string[] = [];
    const lru = new LruMap<string, number>(2, (key) => evicted.push(key));
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a'); // b 变为最久未用
    lru.set('c', 3);
    lru.evictToCapacity();
    expect(evicted).toEqual(['b']);
    expect(lru.has('a')).toBe(true);
    expect(lru.has('c')).toBe(true);
    expect(lru.size).toBe(2);
  });

  it('protect 跳过受保护键；全受保护时允许超限', () => {
    const evicted: string[] = [];
    const lru = new LruMap<string, number>(1, (key) => evicted.push(key));
    lru.set('a', 1);
    lru.set('b', 2);
    lru.evictToCapacity((key) => key === 'a');
    expect(evicted).toEqual(['b']);
    lru.set('c', 3);
    lru.evictToCapacity(() => true);
    expect(lru.size).toBe(2); // 全保护 → 不逐出，允许超限
  });

  it('delete/clear/keys/values 语义', () => {
    const lru = new LruMap<string, number>(TERRAIN_CHUNK_CACHE_LIMIT);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.delete('a');
    expect(lru.keys()).toEqual(['b']);
    expect(lru.values()).toEqual([2]);
    lru.clear();
    expect(lru.size).toBe(0);
  });
});

describe('useChunkedTerrain 路径门槛', () => {
  it('scene ≥4px 走分块；1/2px 档与 overview 维持低成本路径', () => {
    expect(useChunkedTerrain(false, 8)).toBe(true);
    expect(useChunkedTerrain(false, 4)).toBe(true);
    expect(useChunkedTerrain(false, 2)).toBe(false);
    expect(useChunkedTerrain(false, 1)).toBe(false);
    expect(useChunkedTerrain(true, 8)).toBe(false);
  });
});
