import { describe, expect, it } from 'vitest';

import type { Unit } from '@shared/types';

import { countOutOfAmmoUnits } from '@/features/planet-map/ammo-alert';
import { formatUnitCost } from '@/features/planet-map/model';

describe('缺弹告警与造价文案', () => {
  it('只统计己方存活的 no_ammunition 单位', () => {
    const mk = (o: Partial<Unit>) => ({ owner_id: 'p1', hp: 5, combat_state: 'no_ammunition', ...o }) as Unit;
    expect(countOutOfAmmoUnits({ a: mk({}), b: mk({ owner_id: 'p2' }), c: mk({ hp: 0 }), d: mk({ combat_state: 'idle' }) }, 'p1')).toBe(1);
    expect(countOutOfAmmoUnits(undefined, 'p1')).toBe(0);
  });

  it('formatUnitCost 列出物品造价与生产时间', () => {
    const text = formatUnitCost(undefined, { cost: [{ item_id: 'steel', quantity: 2 }, { item_id: 'circuit_board', quantity: 1 }], production_ticks: 30 });
    expect(text).toContain('× 2');
    expect(text).toContain('× 1');
    expect(text.endsWith('· 30 tick')).toBe(true);
    expect(formatUnitCost(undefined, {})).toBe('');
  });
});
