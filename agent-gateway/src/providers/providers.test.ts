import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseProviderResult } from './index.js';

describe('provider result parser', () => {
  it('parses a valid structured agent response', () => {
    const parsed = parseProviderResult(JSON.stringify({
      assistantMessage: '我会先扫描当前行星。',
      actions: [{ type: 'game.cli', commandLine: 'scan_planet planet-1-1' }],
      done: false,
    }));

    assert.equal(parsed.assistantMessage, '我会先扫描当前行星。');
    assert.equal(parsed.actions[0]?.type, 'game.cli');
    assert.equal(parsed.done, false);
  });

  it('rejects malformed payloads', () => {
    assert.throws(() => parseProviderResult('{"actions":[]}'), /assistantMessage/);
  });
});
