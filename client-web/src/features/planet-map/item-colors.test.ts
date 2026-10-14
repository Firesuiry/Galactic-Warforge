import { describe, expect, it } from 'vitest';

import {
  ITEM_COLOR_FALLBACK,
  getItemColorNumber,
  getItemColorValue,
  listedItemColorIds,
} from '@/features/planet-map/item-colors';

/**
 * CIE Lab（D65）距离：把 sRGB hex 经线性化 + XYZ + Lab 后求欧氏距离。
 * 直接比 RGB 数值会把「暗蓝 vs 暗绿」判成相近，而 3D 光照（sRGB 输出 + ACES）
 * 下真正决定「看不看得出是两种东西」的是感知色差，所以这里用 Lab。
 */
function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function hexToLab(hex: string): [number, number, number] {
  const raw = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((offset) => srgbToLinear(Number.parseInt(raw.slice(offset, offset + 2), 16)));
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (value: number) => (value > 216 / 24389 ? Math.cbrt(value) : (841 / 108) * value + 4 / 29);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = hexToLab(a);
  const [l2, a2, b2] = hexToLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** 阈值：ΔE(Lab) 25 以上，普通观察者在 3D 近景里能立刻区分（DSP 式小方块）。 */
const MIN_DISTINCT_DISTANCE = 25;

/** 开局产线 + 带上传送的常见 10 种物品。 */
const COMMON_BELT_ITEMS = [
  'iron_ore',
  'copper_ore',
  'stone_ore',
  'coal',
  'silicon_ore',
  'iron_ingot',
  'copper_ingot',
  'gear',
  'magnetic_coil',
  'circuit_board',
];

describe('物品配色（§4 传送带物料可读）', () => {
  it('开局产线常见物品两两不同色（铁矿/铜矿/石材/煤/铁块/铜块/齿轮/磁线圈）', () => {
    const ids = ['iron_ore', 'copper_ore', 'stone_ore', 'coal', 'iron_ingot', 'copper_ingot', 'gear', 'magnetic_coil'];
    const colors = ids.map((id) => getItemColorValue(id));
    expect(new Set(colors).size).toBe(ids.length);
    // 服务端目录只按大类给色（矿石同色、材料同色），细分网格后必须靠这张表分辨。
    expect(getItemColorValue('iron_ore')).not.toBe(getItemColorValue('copper_ore'));
    expect(getItemColorValue('iron_ingot')).not.toBe(getItemColorValue('copper_ingot'));
  });

  it('常用 10 种物品两两感知色差（CIE Lab）大于阈值', () => {
    const worst = { distance: Number.POSITIVE_INFINITY, pair: '' };
    for (let i = 0; i < COMMON_BELT_ITEMS.length; i += 1) {
      for (let j = i + 1; j < COMMON_BELT_ITEMS.length; j += 1) {
        const a = COMMON_BELT_ITEMS[i];
        const b = COMMON_BELT_ITEMS[j];
        const distance = colorDistance(getItemColorValue(a), getItemColorValue(b));
        if (distance < worst.distance) {
          worst.distance = distance;
          worst.pair = `${a}/${b}`;
        }
      }
    }
    // 失败信息直接给出最接近的一对，换色时不用手算。
    expect(worst.distance, `最接近的一对 ${worst.pair} ΔE=${worst.distance.toFixed(1)}`).toBeGreaterThanOrEqual(
      MIN_DISTINCT_DISTANCE,
    );
  });

  it('原矿偏暗带杂色、锭更亮更饱和（同一族的原矿与产物不靠明度混同）', () => {
    const lightness = (id: string) => hexToLab(getItemColorValue(id))[0];
    const chroma = (id: string) => {
      const [, a, b] = hexToLab(getItemColorValue(id));
      return Math.hypot(a, b);
    };
    // 原矿整体压暗（L* < 55），锭/砖明显更亮（L* > 65）。
    for (const ore of ['iron_ore', 'copper_ore', 'stone_ore', 'coal', 'silicon_ore']) {
      expect(lightness(ore), `${ore} 应偏暗`).toBeLessThan(55);
    }
    for (const ingot of ['iron_ingot', 'copper_ingot', 'stone_brick', 'silicon_ingot']) {
      expect(lightness(ingot), `${ingot} 应更亮`).toBeGreaterThan(65);
    }
    // 铜矿/铜锭同色系但必须拉开：锭更亮、更饱和。
    expect(lightness('copper_ingot')).toBeGreaterThan(lightness('copper_ore') + 15);
    expect(chroma('copper_ingot')).toBeGreaterThan(chroma('copper_ore'));
    // 齿轮/磁线圈/电路板是三个醒目的信号色，饱和度高。
    for (const part of ['gear', 'magnetic_coil', 'circuit_board']) {
      expect(chroma(part), `${part} 应醒目`).toBeGreaterThan(60);
    }
  });

  it('本表优先于目录大类色（目录 ore/material 只有一种色，直接采用会让带上同色）', () => {
    // 目录：iron_ore/copper_ore/stone_ore/coal 都是 #adb5bd，iron_ingot/copper_ingot 都是 #74c0fc。
    expect(getItemColorValue('iron_ore', '#adb5bd')).not.toBe(getItemColorValue('copper_ore', '#adb5bd'));
    expect(getItemColorValue('iron_ingot', '#74c0fc')).not.toBe(getItemColorValue('copper_ingot', '#74c0fc'));
    expect(getItemColorValue('iron_ore', '#adb5bd')).toBe(getItemColorValue('iron_ore'));
  });

  it('本表未覆盖的物品回落到目录色，再回落到通用色', () => {
    expect(getItemColorValue('some_mod_item', '#123456')).toBe('#123456');
    expect(getItemColorValue('some_mod_item')).toBe(ITEM_COLOR_FALLBACK);
    expect(getItemColorValue(undefined)).toBe(ITEM_COLOR_FALLBACK);
  });

  it('数值形式与十六进制字符串同源', () => {
    expect(getItemColorNumber('gear')).toBe(Number.parseInt(getItemColorValue('gear').slice(1), 16));
    expect(listedItemColorIds()).toContain('iron_ore');
  });
});
