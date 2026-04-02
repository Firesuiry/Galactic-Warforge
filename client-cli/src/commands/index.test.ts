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
