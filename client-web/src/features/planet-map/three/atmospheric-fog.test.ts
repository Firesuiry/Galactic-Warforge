import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  AtmosphericFog,
  FOG_HORIZON_LINEAR,
  FOG_TUNING,
  canReceiveFog,
  createFogUniforms,
  fogDensityAtAltitude,
  fogStrengthAtAltitude,
} from './atmospheric-fog';
import { SKY_HORIZON_LINEAR } from './atmosphere';

/** three 的 ACES（曝光 .92）+ sRGB，用于把线性雾色换算回显示色（审查 P2-6 的判据）。 */
function acesToDisplay(color: readonly number[], exposure = 0.92): number[] {
  const input = [
    [0.59719, 0.35458, 0.04823],
    [0.07600, 0.90834, 0.01566],
    [0.02840, 0.13383, 0.83777],
  ];
  const output = [
    [1.60475, -0.53108, -0.07367],
    [-0.10208, 1.10813, -0.00605],
    [-0.00327, -0.07276, 1.07602],
  ];
  const mul = (m: number[][], v: number[]) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  const rrt = (v: number[]) => v.map((x) => {
    const a = x * (x + 0.0245786) - 0.000090537;
    const b = x * (0.983729 * x + 0.432951) + 0.238081;
    return a / b;
  });
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const srgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  const linear = mul(output, rrt(mul(input, color.map((x) => x * exposure / 0.6)))).map(clamp);
  return linear.map((x) => Math.round(srgb(x) * 255));
}

describe('空气透视雾（审查 P2-6 / P2-7 / P2-8）', () => {
  it('雾色按线性空间给：经 ACES 后是目标显示色 #b9d3e6（185/211/230）', () => {
    expect(acesToDisplay(FOG_HORIZON_LINEAR)).toEqual([185, 211, 230]);
  });

  it('地平线处地面雾色与天空地平线色的显示差 < 5/255（不再有灰带）', () => {
    const fog = acesToDisplay(FOG_HORIZON_LINEAR);
    const sky = acesToDisplay(SKY_HORIZON_LINEAR);
    for (let i = 0; i < 3; i++) expect(Math.abs(fog[i] - sky[i])).toBeLessThan(5);
  });

  it('浓度契约：中心建筑（d=8）< 5%、地平线（d=39）在 50–70%', () => {
    const density = FOG_TUNING.density;
    const at = (distance: number) => 1 - Math.exp(-((density * distance) ** 2));
    expect(at(8)).toBeLessThan(0.05);
    expect(at(39)).toBeGreaterThanOrEqual(0.5);
    expect(at(39)).toBeLessThanOrEqual(0.7);
    // 贴地（聚焦高度）取的就是参考浓度。
    expect(fogDensityAtAltitude(FOG_TUNING.referenceAltitude)).toBeCloseTo(density, 10);
  });

  it('浓度随高度变淡：中空 60 比贴地淡、全球 300 更淡但强度已为 0', () => {
    expect(fogDensityAtAltitude(60)).toBeLessThan(fogDensityAtAltitude(7.7));
    expect(fogDensityAtAltitude(300)).toBeLessThan(fogDensityAtAltitude(60));
    expect(fogStrengthAtAltitude(7.7)).toBe(1);
    expect(fogStrengthAtAltitude(60)).toBe(1);
    expect(fogStrengthAtAltitude(160)).toBe(0);
    expect(fogStrengthAtAltitude(300)).toBe(0);
  });

  it('additive 特效与自定义 ShaderMaterial 不接雾（审查 P2-8）', () => {
    const additive = new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, fog: false });
    const shader = new THREE.ShaderMaterial({});
    const standard = new THREE.MeshStandardMaterial();
    expect(canReceiveFog(additive)).toBe(false);
    expect(canReceiveFog(shader)).toBe(false);
    expect(canReceiveFog(standard)).toBe(true);

    const fog = new AtmosphericFog('high');
    fog.apply([additive, shader, standard]);
    expect(additive.userData.swFog).toBeUndefined();
    expect(shader.userData.swFog).toBeUndefined();
    expect(standard.userData.swFog).toBe(fog.uniforms);
  });

  it('uniform 是共享引用：改一次高度，所有已接入材质都拿到新值', () => {
    const fog = new AtmosphericFog('high');
    const standard = new THREE.MeshStandardMaterial();
    fog.apply(standard);
    const uniforms = createFogUniforms();
    // 场景侧写的就是这份对象（apply 时按引用注入）。
    fog.setAltitude(39);
    expect(fog.uniforms.density.value).toBeLessThan(FOG_TUNING.density);
    expect(uniforms.density.value).toBe(FOG_TUNING.density);
    expect(standard.userData.swFog).toBe(fog.uniforms);
  });
});
