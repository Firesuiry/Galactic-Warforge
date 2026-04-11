import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyPublicTurnError } from './provider-error.js';

describe('provider error classification', () => {
  it('maps structural action errors to provider_schema_invalid', () => {
    const missingType = classifyPublicTurnError(new Error('action.type is required'));
    const invalidTurn = classifyPublicTurnError(new Error('provider turn must be an object'));
    const invalidAction = classifyPublicTurnError(new Error('action must be an object'));

    assert.equal(missingType.code, 'provider_schema_invalid');
    assert.equal(invalidTurn.code, 'provider_schema_invalid');
    assert.equal(invalidAction.code, 'provider_schema_invalid');
  });
});
