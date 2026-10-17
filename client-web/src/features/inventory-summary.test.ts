import { describe, expect, it } from 'vitest';

import { inventorySlotUsage, inventoryStackRows, itemSlots, pickKeyItems, sortedInventory } from '@/features/inventory-summary';

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

describe('背包格数（DSP 口径）', () => {
  it('单件物品格数 = ceil(数量 / stack_limit)', () => {
    expect(itemSlots(0, 100)).toBe(0);
    expect(itemSlots(1, 100)).toBe(1);
    expect(itemSlots(100, 100)).toBe(1);
    expect(itemSlots(101, 100)).toBe(2);
    expect(itemSlots(300, 0)).toBe(300);
  });

  it('读服务端下发的占用/上限；缺失或非法时返回 null', () => {
    expect(inventorySlotUsage({ inventory_slots_used: 12, inventory_slots_total: 40 })).toEqual({ used: 12, total: 40 });
    expect(inventorySlotUsage({ inventory_slots_used: 99, inventory_slots_total: 40 })).toEqual({ used: 40, total: 40 });
    expect(inventorySlotUsage({})).toBeNull();
    expect(inventorySlotUsage(null)).toBeNull();
  });

  it('背包面板每项带堆叠上限与占用格数', () => {
    const rows = inventoryStackRows(
      { iron_ore: 250, gear: 30 },
      { items: [
        { id: 'iron_ore', name: '铁矿', category: 'ore', form: 'solid', stack_limit: 100, unit_volume: 1, icon_key: 'iron_ore', color: '#fff' },
        { id: 'gear', name: '齿轮', category: 'component', form: 'solid', stack_limit: 200, unit_volume: 1, icon_key: 'gear', color: '#fff' },
      ] },
    );
    expect(rows).toEqual([
      { id: 'iron_ore', quantity: 250, stackLimit: 100, slots: 3 },
      { id: 'gear', quantity: 30, stackLimit: 200, slots: 1 },
    ]);
  });
});
