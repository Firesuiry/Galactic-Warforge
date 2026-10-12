import { describe, expect, it } from 'vitest';

import {
  ITEM_COLOR_FALLBACK,
  getItemColorNumber,
  getItemColorValue,
  listedItemColorIds,
} from '@/features/planet-map/item-colors';

describe('物品配色（§4 传送带物料可读）', () => {
  it('开局产线常见物品两两不同色（铁矿/铜矿/石材/煤/铁块/铜块/齿轮/磁线圈）', () => {
    const ids = ['iron_ore', 'copper_ore', 'stone_ore', 'coal', 'iron_ingot', 'copper_ingot', 'gear', 'magnetic_coil'];
    const colors = ids.map((id) => getItemColorValue(id));
    expect(new Set(colors).size).toBe(ids.length);
    // 服务端目录只按大类给色（矿石同色、材料同色），细分网格后必须靠这张表分辨。
    expect(getItemColorValue('iron_ore')).not.toBe(getItemColorValue('copper_ore'));
    expect(getItemColorValue('iron_ingot')).not.toBe(getItemColorValue('copper_ingot'));
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
