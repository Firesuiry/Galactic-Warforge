import { describe, expect, it } from 'vitest';

import { pickKeyItems, sortedInventory } from '@/features/mineral-summary';

describe('顶栏关键库存', () => {
  it('按优先级取持有量 > 0 的前 4 项', () => {
    const inventory = { iron_ore: 500, iron_ingot: 80, circuit_board: 4, ammo_bullet: 30, gear: 0, coal: 9, magnetic_coil: 2 };
    expect(pickKeyItems(inventory).map((item) => item.id)).toEqual(['ammo_bullet', 'circuit_board', 'iron_ingot', 'magnetic_coil']);
    expect(pickKeyItems(undefined)).toEqual([]);
  });
  it('完整库存按数量降序', () => {
    expect(sortedInventory({ a: 1, b: 5, c: 0 }).map((item) => item.id)).toEqual(['b', 'a']);
  });
});
