import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COMMANDS, dispatch } from './index.js';
import { cmdHelp } from './util.js';

describe('save command registration', () => {
  it('registers save in command table', async () => {
    assert.ok(COMMANDS.save);

    const out = await dispatch('save --help', { currentPlayer: 'p1', rl: {} });
    assert.match(out, /save \[--reason <text>\]/);
  });

  it('shows dedicated help for save', () => {
    const out = cmdHelp(['save']);
    assert.match(out, /^save /);
    assert.match(out, /manual save/i);
  });
});


describe('logistics command registration', () => {
  it('registers configure_logistics_station and configure_logistics_slot', async () => {
    assert.ok(COMMANDS.configure_logistics_station);
    assert.ok(COMMANDS.configure_logistics_slot);

    const stationHelp = await dispatch('help configure_logistics_station', { currentPlayer: 'p1', rl: {} });
    assert.match(stationHelp, /configure_logistics_station <building_id>/);

    const slotHelp = await dispatch('help configure_logistics_slot', { currentPlayer: 'p1', rl: {} });
    assert.match(slotHelp, /configure_logistics_slot <building_id> <planetary\|interstellar>/);
  });
});
