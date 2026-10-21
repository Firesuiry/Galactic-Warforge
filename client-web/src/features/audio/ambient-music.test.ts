import { describe, expect, it } from 'vitest';

import {
  COMBAT_FALLOFF_MS,
  COMBAT_WINDOW_MS,
  FACTORY_FULL_BUILDINGS,
  FACTORY_MAX_DB,
  factoryLevelForBuildings,
  fireSoundForTurret,
  resolveAmbient,
  resolveMusic,
  SPACE_CROSSFADE_START_ALTITUDE,
  SPACE_VIEW_ALTITUDE,
  spaceLevelForAltitude,
  TENSE_THREAT_LEVEL,
  windLevelForAltitude,
} from '@/features/audio/ambient-music';

describe('resolveAmbient 环境声床', () => {
  it('行星贴地：风为主（电平随高度减弱）', () => {
    const ground = resolveAmbient({ page: 'planet', altitude: 5, runningBuildings: 0 });
    const high = resolveAmbient({ page: 'planet', altitude: 50, runningBuildings: 0 });
    expect(ground.layers.map((layer) => layer.name)).toEqual(['wind']);
    expect(high.layers.map((layer) => layer.name)).toEqual(['wind']);
    expect(ground.layers[0].level).toBeGreaterThan(high.layers[0].level);
  });

  it('贴地 + 40 台运行建筑：风与机械两路同时播放，机械路 = −18 dB 上限', () => {
    const ambient = resolveAmbient({ page: 'planet', altitude: 5, runningBuildings: FACTORY_FULL_BUILDINGS });
    expect(ambient.layers.map((layer) => layer.name)).toEqual(['wind', 'factory']);
    const wind = ambient.layers.find((layer) => layer.name === 'wind')!;
    const factory = ambient.layers.find((layer) => layer.name === 'factory')!;
    expect(wind.level).toBeGreaterThan(0);
    expect(factory.level).toBeGreaterThan(0);
    expect(factory.level).toBeCloseTo(10 ** (FACTORY_MAX_DB / 20), 5);
    expect(wind.level).toBeCloseTo(windLevelForAltitude(5), 5);
  });

  it('0 座运行建筑时只有风（没有机械路）', () => {
    expect(factoryLevelForBuildings(0)).toBe(0);
    const ambient = resolveAmbient({ page: 'planet', altitude: 5, runningBuildings: 0 });
    expect(ambient.layers.map((layer) => layer.name)).toEqual(['wind']);
  });

  it('中空 55 高度仍两路；高度 120–190 风淡出、轨道低频淡入', () => {
    const mid = resolveAmbient({ page: 'planet', altitude: 55, runningBuildings: FACTORY_FULL_BUILDINGS });
    expect(mid.layers.map((layer) => layer.name)).toEqual(['wind', 'factory']);

    const crossing = resolveAmbient({ page: 'planet', altitude: 155, runningBuildings: FACTORY_FULL_BUILDINGS });
    const names = crossing.layers.map((layer) => layer.name);
    expect(names).toContain('space');
    expect(names).toContain('wind');
    const space = crossing.layers.find((layer) => layer.name === 'space')!;
    const wind = crossing.layers.find((layer) => layer.name === 'wind')!;
    expect(space.level).toBeGreaterThan(0);
    expect(space.level).toBeLessThan(1);
    expect(wind.level).toBeLessThan(windLevelForAltitude(155));
  });

  it('全球视角 / 恒星系页 → 只剩轨道低频；其它页静默', () => {
    expect(resolveAmbient({ page: 'planet', altitude: 300, runningBuildings: 40 }))
      .toEqual({ layers: [{ name: 'space', level: 1 }] });
    expect(resolveAmbient({ page: 'system', altitude: 0, runningBuildings: 0 }))
      .toEqual({ layers: [{ name: 'space', level: 1 }] });
    expect(resolveAmbient({ page: 'other', altitude: 0, runningBuildings: 0 })).toEqual({ layers: [] });
  });

  it('风电平在高度 60 以上保持底噪，不归零；轨道声床 120 以下不出现', () => {
    expect(windLevelForAltitude(60)).toBeGreaterThan(0);
    expect(windLevelForAltitude(1000)).toBe(windLevelForAltitude(60));
    expect(spaceLevelForAltitude(SPACE_CROSSFADE_START_ALTITUDE)).toBe(0);
    expect(spaceLevelForAltitude(SPACE_VIEW_ALTITUDE)).toBe(1);
    expect(resolveAmbient({ page: 'planet', altitude: 119, runningBuildings: 0 }).layers.map((l) => l.name))
      .toEqual(['wind']);
  });
});

describe('resolveMusic 配乐状态机', () => {
  const base = { darkFogHostile: false, threatLevel: 0, lastCombatAt: null, now: 1_000_000 };

  it('无战斗无威胁 → calm', () => {
    expect(resolveMusic(base)).toBe('calm');
  });

  it('黑雾敌对 / 威胁等级 ≥ 3 → tense', () => {
    expect(resolveMusic({ ...base, darkFogHostile: true })).toBe('tense');
    expect(resolveMusic({ ...base, threatLevel: TENSE_THREAT_LEVEL })).toBe('tense');
    expect(resolveMusic({ ...base, threatLevel: TENSE_THREAT_LEVEL - 1 })).toBe('calm');
  });

  it('最近 10s 有战斗 → combat', () => {
    expect(resolveMusic({ ...base, lastCombatAt: base.now - COMBAT_WINDOW_MS + 1 })).toBe('combat');
  });

  it('交战结束 15s 后才回落（10s 窗口 + 15s 延迟）', () => {
    const at = base.now - COMBAT_WINDOW_MS - COMBAT_FALLOFF_MS + 100;
    expect(resolveMusic({ ...base, lastCombatAt: at })).toBe('combat');
    expect(resolveMusic({ ...base, lastCombatAt: at - 1000 })).toBe('calm');
  });

  it('回落时若仍紧张 → tense 而不是 calm', () => {
    const at = base.now - COMBAT_WINDOW_MS - COMBAT_FALLOFF_MS - 1000;
    expect(resolveMusic({ ...base, lastCombatAt: at, darkFogHostile: true })).toBe('tense');
  });
});

describe('fireSoundForTurret 炮塔 → 开火音', () => {
  it('按建筑类型前缀区分', () => {
    expect(fireSoundForTurret('gauss_turret')).toBe('fireGauss');
    expect(fireSoundForTurret('laser_turret')).toBe('fireLaser');
    expect(fireSoundForTurret('missile_turret')).toBe('fireMissile');
    expect(fireSoundForTurret('artillery_turret')).toBe('fireMissile');
    expect(fireSoundForTurret('plasma_turret')).toBe('firePlasma');
    expect(fireSoundForTurret('sr_plasma_turret')).toBe('firePlasma');
    expect(fireSoundForTurret('anti_air_turret')).toBe('fireGeneric');
    expect(fireSoundForTurret(undefined)).toBe('fireGeneric');
  });
});
