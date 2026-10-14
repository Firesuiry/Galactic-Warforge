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

/**
 * CIEDE2000 色差（CIE 官方加权公式，kL=kC=kH=1）。
 * Lab 欧氏距离（CIE76）在低彩度蓝紫区会高估差异、在高彩度黄区会低估，
 * 判断「3D 近景里能不能一眼分开」用 CIEDE2000 更贴近人眼；公式纯函数、无依赖。
 */
function ciede2000(a: string, b: string): number {
  const [l1, a1, b1] = hexToLab(a);
  const [l2, a2, b2] = hexToLab(b);
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1p = c1p === 0 ? 0 : ((Math.atan2(b1, a1p) * 180) / Math.PI + 360) % 360;
  const h2p = c2p === 0 ? 0 : ((Math.atan2(b2, a2p) * 180) / Math.PI + 360) % 360;
  const dLp = l2 - l1;
  const dCp = c2p - c1p;
  const dhp = c1p * c2p === 0
    ? 0
    : Math.abs(h2p - h1p) <= 180
      ? h2p - h1p
      : h2p - h1p > 180
        ? h2p - h1p - 360
        : h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * Math.PI) / 360);
  const lBarP = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;
  const hBarP = c1p * c2p === 0
    ? h1p + h2p
    : Math.abs(h1p - h2p) <= 180
      ? (h1p + h2p) / 2
      : h1p + h2p < 360
        ? (h1p + h2p + 360) / 2
        : (h1p + h2p - 360) / 2;
  const t = 1
    - 0.17 * Math.cos(((hBarP - 30) * Math.PI) / 180)
    + 0.24 * Math.cos(((2 * hBarP) * Math.PI) / 180)
    + 0.32 * Math.cos(((3 * hBarP + 6) * Math.PI) / 180)
    - 0.2 * Math.cos(((4 * hBarP - 63) * Math.PI) / 180);
  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin((2 * dTheta * Math.PI) / 180) * rc;
  return Math.sqrt(
    (dLp / sl) ** 2 + (dCp / sc) ** 2 + (dHp / sh) ** 2 + rt * (dCp / sc) * (dHp / sh),
  );
}

/** 阈值：ΔE(Lab) 25 以上，普通观察者在 3D 近景里能立刻区分（DSP 式小方块）。 */
const MIN_DISTINCT_DISTANCE = 25;

/** CIEDE2000 阈值：3D 近景下「一眼看出是两种货」的经验下限。 */
const MIN_DISTINCT_DE2000 = 25;

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

  it('常用 10 种物品两两 CIEDE2000 色差 ≥ 25，且每种矿石与其对应锭也 ≥ 25', () => {
    const worst = { de: Number.POSITIVE_INFINITY, pair: '' };
    for (let i = 0; i < COMMON_BELT_ITEMS.length; i += 1) {
      for (let j = i + 1; j < COMMON_BELT_ITEMS.length; j += 1) {
        const a = COMMON_BELT_ITEMS[i];
        const b = COMMON_BELT_ITEMS[j];
        const de = ciede2000(getItemColorValue(a), getItemColorValue(b));
        if (de < worst.de) {
          worst.de = de;
          worst.pair = `${a}/${b}`;
        }
      }
    }
    // 颜色一律从表里取（不硬编码 hex），改表后这条断言会自动跟着变。
    expect(worst.de, `最接近的一对 ${worst.pair} ΔE2000=${worst.de.toFixed(1)}`).toBeGreaterThanOrEqual(
      MIN_DISTINCT_DE2000,
    );
    // 同一族的原矿与锭必须在明度和色相上都分开：3D 色调映射会把低饱和浅色压成同一种白，
    // 所以「矿 vs 锭」这一对单独再断言一次。
    for (const [ore, ingot] of [
      ['iron_ore', 'iron_ingot'],
      ['copper_ore', 'copper_ingot'],
      ['silicon_ore', 'silicon_ingot'],
      ['stone_ore', 'stone_brick'],
      ['titanium_ore', 'titanium_ingot'],
    ]) {
      const de = ciede2000(getItemColorValue(ore), getItemColorValue(ingot));
      expect(de, `${ore} vs ${ingot} ΔE2000=${de.toFixed(1)}`).toBeGreaterThanOrEqual(MIN_DISTINCT_DE2000);
    }
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
