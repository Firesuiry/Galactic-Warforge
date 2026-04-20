import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cmdCommissionFleet, cmdDeploySquad, cmdProduce } from './action.js';

describe('T101 produce command boundary', () => {
  it('does not hard reject corvette in cmdProduce before hitting the API layer', async () => {
    const out = await cmdProduce(['b-1', 'corvette']);
    assert.doesNotMatch(out, /unit_type 必须是 worker 或 soldier/);
    assert.match(out, /missing authenticated player_id/);
  });
});

describe('warfare deployment command surface', () => {
  it('uses blueprint_id wording for deploy_squad validation', async () => {
    const out = await cmdDeploySquad(['hub-1']);
    assert.match(out, /deploy_squad <building_id> <blueprint_id>/);
  });

  it('uses blueprint_id wording for commission_fleet validation', async () => {
    const out = await cmdCommissionFleet(['hub-1']);
    assert.match(out, /commission_fleet <building_id> <blueprint_id> <system_id>/);
  });
});
