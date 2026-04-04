import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cmdLaunchRocket, cmdSetRayReceiverMode, cmdSwitchActivePlanet, cmdTransferItem } from './api.js';

describe('client api exports', () => {
  it('exports launch rocket helper', () => {
    assert.equal(typeof cmdLaunchRocket, 'function');
  });

  it('exports transfer item helper', () => {
    assert.equal(typeof cmdTransferItem, 'function');
  });

  it('exports planet switch and ray receiver helpers', () => {
    assert.equal(typeof cmdSwitchActivePlanet, 'function');
    assert.equal(typeof cmdSetRayReceiverMode, 'function');
  });
});
