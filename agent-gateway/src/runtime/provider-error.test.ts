import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyPublicTurnError } from './provider-error.js';

describe('provider error classification', () => {
  it('does not map maxSteps exhaustion to permission denied', () => {
    const error = classifyPublicTurnError(new Error('agent loop exceeded maxSteps'));

    assert.notEqual(error.code, 'permission_denied');
    assert.equal(error.rawMessage, 'agent loop exceeded maxSteps');
  });
});
