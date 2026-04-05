import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cmdCommissionFleet,
  cmdDeploySquad,
  cmdFleetAssign,
  cmdFleetAttack,
  cmdFleetDisband,
  cmdLaunchRocket,
  cmdSetRayReceiverMode,
  cmdSwitchActivePlanet,
  cmdTransferItem,
  fetchFleet,
  fetchFleets,
  fetchSystemRuntime,
} from './api.js';

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

  it('exports fleet action and runtime query helpers', () => {
    assert.equal(typeof cmdDeploySquad, 'function');
    assert.equal(typeof cmdCommissionFleet, 'function');
    assert.equal(typeof cmdFleetAssign, 'function');
    assert.equal(typeof cmdFleetAttack, 'function');
    assert.equal(typeof cmdFleetDisband, 'function');
    assert.equal(typeof fetchSystemRuntime, 'function');
    assert.equal(typeof fetchFleets, 'function');
    assert.equal(typeof fetchFleet, 'function');
  });
});
