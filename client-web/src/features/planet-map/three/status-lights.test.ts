import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { StatusLights, statusLightColor, statusLightIntensity, statusLightState } from './status-lights';
import { STATUS_LIGHT } from './palette';

function root(x = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0, 0);
  group.scale.setScalar(0.5);
  group.updateMatrixWorld(true);
  return group;
}

describe('building status lights', () => {
  it('maps authoritative runtime states to three light states only', () => {
    expect(statusLightState('running')).toBe('running');
    expect(statusLightState('no_power')).toBe('noPower');
    expect(statusLightState('error')).toBe('noPower');
    for (const state of ['idle', 'paused', 'unconfigured', 'blocked', 'input_shortage', undefined]) {
      expect(statusLightState(state)).toBe('idle');
    }
    expect(statusLightColor('running')).toBe(Number.parseInt(STATUS_LIGHT.running.slice(1), 16));
    expect(statusLightColor('idle')).toBe(Number.parseInt(STATUS_LIGHT.idle.slice(1), 16));
    expect(statusLightColor('noPower')).toBe(Number.parseInt(STATUS_LIGHT.noPower.slice(1), 16));
  });

  it('blinks only the no-power light and freezes at a fixed phase', () => {
    expect(statusLightIntensity('running', 3.3)).toBe(1);
    expect(statusLightIntensity('idle', 7.7)).toBe(1);
    expect(statusLightIntensity('noPower', 0, true)).toBe(statusLightIntensity('noPower', 9.9, true));
    const samples = [0, 0.2, 0.4, 0.8, 1.2].map(time => statusLightIntensity('noPower', time));
    expect(Math.max(...samples)).toBeGreaterThan(0.9);
    expect(Math.min(...samples)).toBeLessThan(0.4);
  });

  it('keeps one instanced draw pair and switches state by writing instance colors only', () => {
    const lights = new StatusLights(() => 0.1);
    const a = root(0), b = root(1);
    const entries = [
      { id: 'a', type: 'arc_smelter', state: 'running', root: a, width: 3, height: 3 },
      { id: 'b', type: 'wind_turbine', state: 'idle', root: b, width: 2, height: 2 },
    ];
    expect(lights.refresh(entries)).toBe(true);
    expect(lights.group.children.filter(child => child instanceof THREE.InstancedMesh)).toHaveLength(2);
    lights.update(0);
    expect(lights.colorAt(0)).toBe(Number.parseInt(STATUS_LIGHT.running.slice(1), 16));
    expect(lights.colorAt(1)).toBe(Number.parseInt(STATUS_LIGHT.idle.slice(1), 16));
    // 状态切换：不重建实例，只改颜色。
    const bulbs = lights.group.getObjectByName('status-light-bulbs') as THREE.InstancedMesh;
    const matrixVersion = bulbs.instanceMatrix.version;
    entries[0].state = 'no_power';
    expect(lights.refresh(entries)).toBe(false);
    lights.update(0.1);
    expect(lights.stateOf('a')).toBe('noPower');
    expect(lights.colorAt(0)).not.toBe(Number.parseInt(STATUS_LIGHT.running.slice(1), 16));
    expect(lights.group.getObjectByName('status-light-bulbs')).toBe(bulbs);
    expect(bulbs.instanceMatrix.version).toBe(matrixVersion);
    // 移除一栋建筑才重建实例。
    expect(lights.refresh(entries.slice(0, 1))).toBe(true);
    expect(lights.count).toBe(1);
    lights.dispose();
  });

  it('places the light above the building and follows the root transform', () => {
    const lights = new StatusLights(() => 0.1);
    const a = root(2);
    lights.refresh([{ id: 'a', type: 'headquarters', state: 'running', root: a, width: 5, height: 5 }]);
    const bulbs = lights.group.getObjectByName('status-light-bulbs') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    bulbs.getMatrixAt(0, matrix);
    const position = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(position.x).toBeGreaterThan(2);
    expect(position.y).toBeGreaterThan(0.2);
    lights.dispose();
  });
});
