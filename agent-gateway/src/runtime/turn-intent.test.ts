import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyTurnIntent } from './turn-intent.js';

describe('turn intent classification', () => {
  it('treats natural-language child creation and permission requests as agent management', () => {
    const intent = classifyTurnIntent([
      { role: 'user', content: '创建胡景，并赋予其建筑权限' },
    ]);

    assert.equal(intent, 'agent_management');
  });
});
