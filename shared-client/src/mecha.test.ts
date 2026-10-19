import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { NO_MECHA_HINT, selectMyMecha, selectMyMechaFromSummary, sortMechas } from './mecha.js';
import type { MechaView } from './types.js';

function mecha(unitId: string, operator: string, overrides: Partial<MechaView> = {}): MechaView {
  return {
    unit_id: unitId,
    planet_id: 'planet-1-1',
    operator,
    alive: true,
    respawn_at_tick: 0,
    position: { x: 10, y: 20, z: 0 },
    inventory: { iron_ingot: 4 },
    inventory_slots_used: 1,
    inventory_slots_total: 40,
    operate_range: 18,
    concurrent_tasks: 2,
    construction_active: 0,
    construction_pending: 0,
    ...overrides,
  };
}

describe('selectMyMecha', () => {
  it('finds the mecha bound to the issuer', () => {
    const mine = selectMyMecha({ mechas: [mecha('u-1', 'p1'), mecha('u-2', 'builder')] }, 'builder');
    assert.equal(mine?.unit_id, 'u-2');
  });

  it('returns undefined when the issuer has no mecha', () => {
    assert.equal(selectMyMecha({ mechas: [mecha('u-1', 'p1')] }, 'builder'), undefined);
    assert.ok(NO_MECHA_HINT.includes('未绑定机甲'));
  });

  it('returns the first match when several mechas carry the same operator', () => {
    const mine = selectMyMecha({ mechas: [mecha('u-1', 'builder'), mecha('u-2', 'builder')] }, 'builder');
    assert.equal(mine?.unit_id, 'u-1');
  });

  it('never matches the empty operator (idle mecha)', () => {
    assert.equal(selectMyMecha({ mechas: [mecha('u-1', '')] }, ''), undefined);
  });

  it('reads the summary player layer', () => {
    const summary = { players: { p1: { player_id: 'p1', is_alive: true, mechas: [mecha('u-3', 'p1')] } } } as never;
    assert.equal(selectMyMechaFromSummary(summary, 'p1', 'p1')?.unit_id, 'u-3');
  });

  it('sorts mechas by unit id for list output', () => {
    assert.deepEqual(sortMechas([mecha('u-9', 'p1'), mecha('u-2', 'p1')]).map((m) => m.unit_id), ['u-2', 'u-9']);
  });
});
