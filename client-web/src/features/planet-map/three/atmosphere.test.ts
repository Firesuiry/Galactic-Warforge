import * as THREE from 'three';
import { AtmosphereShell, SKY_HORIZON_LINEAR, SKY_ZENITH_LINEAR, createSkyUniforms, skyHorizonFactor, skyIblObserver } from './atmosphere';
import { FOG_HORIZON_LINEAR } from './atmospheric-fog';

/**
 * 第 23 轮 3A 第二轮 §14：全球视角的大气方向。
 *
 * 大气壳挂在 `world` 下（随星球旋转），shader 用物体空间法线与「星球局部空间」的太阳方向
 * 做点积。这里断言：world 任意旋转后，shader 的太阳方向 uniform 在星球局部空间里与场景
 * 主光方向一致（即经 world 旋转后回到场景空间）；并且向阳/背阳的判据不随 world 旋转变化。
 */
describe('atmosphere shell sun direction', () => {
  const sceneSun = new THREE.Vector3(-100, 140, 230).normalize();

  function localToScene(q: THREE.Quaternion, local: THREE.Vector3) {
    return local.clone().applyQuaternion(q).normalize();
  }

  it('keeps the shader sun direction equal to the scene main light after any world rotation', () => {
    const shell = new AtmosphereShell(100, sceneSun);
    const rotations = [
      new THREE.Quaternion(), // 无旋转
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, -1.9, 0.4)),
      // 聚焦到 (56,144) 这类格时 world 会被转成任意姿态。
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0.2, -0.6, 0.77).normalize(), new THREE.Vector3(0, 0, 1)),
    ];
    for (const q of rotations) {
      shell.setSunDirection(sceneSun, q);
      const backToScene = localToScene(q, shell.sunDirectionLocal);
      expect(backToScene.x).toBeCloseTo(sceneSun.x, 6);
      expect(backToScene.y).toBeCloseTo(sceneSun.y, 6);
      expect(backToScene.z).toBeCloseTo(sceneSun.z, 6);
    }
    shell.dispose();
  });

  it('keeps the lit/dark classification of a world point independent of the world rotation', () => {
    const shell = new AtmosphereShell(100, sceneSun);
    // 场景空间里「向阳」与「背阳」的两个方向。
    const sunward = sceneSun.clone();
    const away = sceneSun.clone().negate();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.9, 1.3, -0.5));
    shell.setSunDirection(sceneSun, q);
    const local = shell.sunDirectionLocal.clone();
    // 场景空间方向 → 星球局部空间（shader 里法线的空间）。
    const sunwardLocal = sunward.clone().applyQuaternion(q.clone().invert());
    const awayLocal = away.clone().applyQuaternion(q.clone().invert());
    expect(sunwardLocal.dot(local)).toBeCloseTo(1, 6);
    expect(awayLocal.dot(local)).toBeCloseTo(-1, 6);
    shell.dispose();
  });

  it('still uses the scene direction verbatim when no world rotation is given', () => {
    const shell = new AtmosphereShell(100, sceneSun);
    expect(shell.sunDirectionLocal.toArray().map((v) => Number(v.toFixed(6))))
      .toEqual(sceneSun.toArray().map((v) => Number(v.toFixed(6))));
    shell.dispose();
  });
});

describe('sky palette', () => {
  it('keeps the documented target sky colors (linear HDR, ACES 反解值)', () => {
    const sky = createSkyUniforms('high');
    // 天顶深青蓝 #2f6fa8、地平线雾霾 #b9d3e6（docs/guide/3A画质.md §1）。
    expect(sky.zenith.toArray().map((v) => Number(v.toFixed(4)))).toEqual([...SKY_ZENITH_LINEAR]);
    expect(sky.horizon.toArray().map((v) => Number(v.toFixed(4)))).toEqual([...SKY_HORIZON_LINEAR]);
    // 雾色是**线性**色（审查 P2-6）：目标显示色 #b9d3e6 的 ACES 反解值，与 atmospheric-fog 的
    // FOG_HORIZON_LINEAR 同一份常量。
    expect(sky.horizonColor.toArray().map((v) => Number(v.toFixed(4)))).toEqual([...FOG_HORIZON_LINEAR]);
  });
});

describe('天空 IBL 烘焙位置（审查 P1-5）', () => {
  it('烘焙观察点在地表上方，不在球心', () => {
    const observer = skyIblObserver(100, 7.7);
    expect(observer.toArray()).toEqual([0, 0, 100 + 7.7]);
    // 高度低于下限时抬到 3.5（避免烘焙相机贴进地表）。
    expect(skyIblObserver(100, 0).z).toBe(103.5);
  });

  it('球心烘焙时地平线权重恒为 0（地平线白丢失），地表烘焙时地平线方向 ≈ 1', () => {
    const center = new THREE.Vector3(0, 0, 0);
    const radius = 100;
    // 球心：任意方向都「高出地平线」90°，t = exp(-π/2/0.055) ≈ 0。
    for (const direction of [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)]) {
      expect(skyHorizonFactor(direction, center, center, radius)).toBeLessThan(1e-6);
    }
    // 地表上方：真正的地平线方向（从相机看球面的切点，俯角 dip = acos(R/D) ≈ 21.8°）→ t ≈ 1；
    // 天顶（+Z）→ t ≈ 0；水平方向已经在地平线上方 21.8°（天空偏蓝，t ≈ 0）。
    const observer = skyIblObserver(radius, 7.7);
    const dip = Math.acos(radius / observer.length());
    const horizon = new THREE.Vector3(0, Math.sin(dip), -Math.cos(dip));
    expect(skyHorizonFactor(horizon, observer, center, radius)).toBeGreaterThan(0.9);
    expect(skyHorizonFactor(new THREE.Vector3(0, 0, 1), observer, center, radius)).toBeLessThan(0.01);
    expect(skyHorizonFactor(new THREE.Vector3(0, 1, 0), observer, center, radius)).toBeLessThan(0.01);
    // 同一方向：球心烘焙恒为 0，地表烘焙在地平线处接近 1（审查探针：0.033/0.083/0.180 vs
    // 0.100/0.192/0.353，差约 3 倍）。
    expect(skyHorizonFactor(horizon, center, center, radius)).toBe(0);
  });
});
