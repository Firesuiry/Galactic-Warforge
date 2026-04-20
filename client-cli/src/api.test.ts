import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cmdBlockadePlanet,
  cmdBlueprintCreate,
  cmdBlueprintFinalize,
  cmdBlueprintSetComponent,
  cmdBlueprintValidate,
  cmdBlueprintVariant,
  cmdCommissionFleet,
  cmdDeploySquad,
  cmdFleetAssign,
  cmdFleetAttack,
  cmdFleetDisband,
  cmdLandingStart,
  cmdLaunchRocket,
  cmdQueueMilitaryProduction,
  cmdRefitUnit,
  cmdSetRayReceiverMode,
  cmdSwitchActivePlanet,
  cmdTaskForceAssign,
  cmdTaskForceCreate,
  cmdTaskForceDeploy,
  cmdTaskForceSetStance,
  cmdTheaterCreate,
  cmdTheaterDefineZone,
  cmdTheaterSetObjective,
  cmdTransferItem,
  fetchFleet,
  fetchFleets,
  fetchPlanetRuntime,
  fetchSystemRuntime,
  fetchWarfareBlueprint,
  fetchWarfareBlueprints,
  fetchWarIndustry,
  fetchWarTaskForces,
  fetchWarTheaters,
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

  it('exports warfare blueprint, industry, coordination and landing helpers', () => {
    assert.equal(typeof fetchPlanetRuntime, 'function');
    assert.equal(typeof fetchWarfareBlueprints, 'function');
    assert.equal(typeof fetchWarfareBlueprint, 'function');
    assert.equal(typeof fetchWarIndustry, 'function');
    assert.equal(typeof fetchWarTaskForces, 'function');
    assert.equal(typeof fetchWarTheaters, 'function');
    assert.equal(typeof cmdBlueprintCreate, 'function');
    assert.equal(typeof cmdBlueprintSetComponent, 'function');
    assert.equal(typeof cmdBlueprintValidate, 'function');
    assert.equal(typeof cmdBlueprintFinalize, 'function');
    assert.equal(typeof cmdBlueprintVariant, 'function');
    assert.equal(typeof cmdQueueMilitaryProduction, 'function');
    assert.equal(typeof cmdRefitUnit, 'function');
    assert.equal(typeof cmdTaskForceCreate, 'function');
    assert.equal(typeof cmdTaskForceAssign, 'function');
    assert.equal(typeof cmdTaskForceSetStance, 'function');
    assert.equal(typeof cmdTaskForceDeploy, 'function');
    assert.equal(typeof cmdTheaterCreate, 'function');
    assert.equal(typeof cmdTheaterDefineZone, 'function');
    assert.equal(typeof cmdTheaterSetObjective, 'function');
    assert.equal(typeof cmdBlockadePlanet, 'function');
    assert.equal(typeof cmdLandingStart, 'function');
  });
});
