import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { ParticleSystem, PARTICLE_STYLES } from './particles';
import { VFX_QUALITY } from './common';

function burst(count: number, seed = 1) {
  return {
    position: new THREE.Vector3(0, 0, 100),
    normal: new THREE.Vector3(0, 0, 1),
    velocity: new THREE.Vector3(0, 0, 1),
    count, life: 1, scale: 1, spread: 1, seed,
  };
}

describe('GPU 粒子系统（ParticleSystem）', () => {
  it('每帧只更新 uniform；发射只写缓冲（不逐帧 CPU 运动）', () => {
    const parent = new THREE.Group();
    const system = new ParticleSystem(parent, VFX_QUALITY.high);
    expect(system.emit(PARTICLE_STYLES.fire, burst(10))).toBe(10);
    const before = system.counts();
    system.setTime(0.4);
    expect(system.counts()).toEqual(before);
    expect(system.group.children).toHaveLength(2); // additive + alpha 两个 draw
    system.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it('池满：环形缓冲覆盖最旧槽位，计数不增长、不抛错', () => {
    const parent = new THREE.Group();
    const system = new ParticleSystem(parent, VFX_QUALITY.low);
    const capacity = VFX_QUALITY.low.particleLimit;
    for (let i = 0; i < 40; i++) system.emit(PARTICLE_STYLES.smoke, burst(500, i + 1));
    const counts = system.counts();
    expect(counts.total).toBeLessThanOrEqual(capacity);
    // 再次发射仍然正常。
    expect(system.emit(PARTICLE_STYLES.fire, burst(10))).toBeGreaterThan(0);
    system.dispose();
  });

  it('档位表：high > balanced > low（数量与点光源），low 不启用点光源', () => {
    expect(VFX_QUALITY.high.particleLimit).toBeGreaterThan(VFX_QUALITY.balanced.particleLimit);
    expect(VFX_QUALITY.balanced.particleLimit).toBeGreaterThan(VFX_QUALITY.low.particleLimit);
    expect(VFX_QUALITY.high.emissionScale).toBeGreaterThan(VFX_QUALITY.balanced.emissionScale);
    expect(VFX_QUALITY.low.dynamicLights).toBe(0);
    expect(VFX_QUALITY.high.dynamicLights).toBeLessThanOrEqual(4);
  });

  it('冻结：发射时刻前移（画面停在爆发中段），且同一发射序列两次结果一致', () => {
    const parent = new THREE.Group();
    const frozen = new ParticleSystem(parent, VFX_QUALITY.high, true);
    frozen.setTime(2);
    frozen.emit(PARTICLE_STYLES.fire, burst(5, 7));
    const attribute = frozen.group.children[0].geometry.getAttribute('emitTime') as THREE.BufferAttribute;
    expect(attribute.getX(0)).toBeCloseTo(2 - 1 * 0.35, 6);
    const second = new ParticleSystem(new THREE.Group(), VFX_QUALITY.high, true);
    second.setTime(2);
    second.emit(PARTICLE_STYLES.fire, burst(5, 7));
    const other = second.group.children[0].geometry.getAttribute('emitTime') as THREE.BufferAttribute;
    expect(other.getX(0)).toBeCloseTo(attribute.getX(0), 6);
    frozen.dispose();
    second.dispose();
  });

  it('世界尺度：速度按格宽换算（同参数、不同格宽 → 位移不同）', () => {
    const make = (tileSize: number) => {
      const system = new ParticleSystem(new THREE.Group(), VFX_QUALITY.high);
      system.setWorldScale(650, tileSize);
      system.emit(PARTICLE_STYLES.spark, { ...burst(1), velocity: new THREE.Vector3(0, 0, 2), spread: 0 });
      const velocity = system.group.children[0].geometry.getAttribute('velocity') as THREE.BufferAttribute;
      const value = velocity.getZ(0);
      system.dispose();
      return value;
    };
    expect(make(0.5)).toBeCloseTo(1, 6);
    expect(make(1)).toBeCloseTo(2, 6);
  });
});
