import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { SunFlare } from './sun-flare';

/**
 * 审查 P1-4：太阳光晕曾经三处同时失效（方向多转一次、相机不在场景、sprite 在近平面内）。
 * 这里逐条断言修后的行为：
 * 1. `sunDirection` 按**世界空间**使用（与相机前向直接点积），不再多转一次；
 * 2. sprite 组挂在相机下，且相机必须进场景才渲染（场景侧 `scene.add(camera)`，这里断言父子关系）；
 * 3. sprite 放在近平面之外（z < -near）。
 */
function cameraLookingAt(target: THREE.Vector3) {
  const camera = new THREE.PerspectiveCamera(43, 1.2, 0.5, 3000);
  camera.position.set(0, 0, 100);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  return camera;
}

/** 星球放在太阳方向之外很远的地方：不会遮挡太阳（正前方会被射线命中）。 */
const FAR_PLANET = new THREE.Vector3(0, 10000, 0);

describe('太阳光晕（审查 P1-4）', () => {
  it('太阳在世界前半球时可见，方向不再被二次变换进相机空间', () => {
    const camera = cameraLookingAt(new THREE.Vector3(0, 0, 0));
    const sun = new THREE.Vector3(0, 0, -1); // 相机正前方（世界空间）
    const flare = new SunFlare(camera, sun);
    flare.update(FAR_PLANET, 100);
    expect(flare.debug().visible).toBe(true);
    expect(flare.debug().facing).toBeCloseTo(1, 3);
    expect(flare.debug().screen[0]).toBeCloseTo(0, 3);
    expect(flare.debug().screen[1]).toBeCloseTo(0, 3);
    flare.dispose();
  });

  it('太阳在背后时不可见（不会把背后判成前方）', () => {
    const camera = cameraLookingAt(new THREE.Vector3(0, 0, 0));
    const flare = new SunFlare(camera, new THREE.Vector3(0, 0, 1));
    flare.update(FAR_PLANET, 100);
    expect(flare.debug().facing).toBeCloseTo(-1, 3);
    expect(flare.debug().visible).toBe(false);
    flare.dispose();
  });

  it('sprite 挂在相机下，且位置在近平面之外（否则被裁掉）', () => {
    const camera = cameraLookingAt(new THREE.Vector3(0, 0, 0));
    const flare = new SunFlare(camera, new THREE.Vector3(0, 0, -1));
    flare.update(FAR_PLANET, 100);
    expect(flare.group.parent).toBe(camera);
    for (const child of flare.group.children) {
      expect(child.position.z).toBeLessThan(-camera.near);
    }
    flare.dispose();
  });

  it('太阳被星球挡住时不可见', () => {
    const camera = cameraLookingAt(new THREE.Vector3(0, 0, 0));
    const flare = new SunFlare(camera, new THREE.Vector3(0, 0, -1));
    // 星球就在相机正前方。
    flare.update(new THREE.Vector3(0, 0, -20), 100);
    expect(flare.debug().visible).toBe(false);
    flare.dispose();
  });
});
