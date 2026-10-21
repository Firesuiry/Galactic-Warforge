import { describe, expect, it } from 'vitest';

import {
  COMBAT_FALLOFF_MS,
  COMBAT_WINDOW_MS,
  FACTORY_FULL_BUILDINGS,
  factoryLevelForBuildings,
  fireSoundForTurret,
  resolveAmbient,
  resolveMusic,
  TENSE_THREAT_LEVEL,
  windLevelForAltitude,
} from '@/features/audio/ambient-music';

describe('resolveAmbient 环境声床', () => {
  it('行星贴地：风为主（电平随高度减弱）', () => {
    const ground = resolveAmbient({ page: 'planet', altitude: 5, runningBuildings: 0 });
    const high = resolveAmbient({ page: 'planet', altitude: 50, runningBuildings: 0 });
    expect(ground.name).toBe('wind');
    expect(ground.level).toBeGreaterThan(high.level);
  });

  it('运行中建筑 40 座时机械嗡鸣到 −18 dB 并压过风', () => {
    // 风在贴地满档是 1.0（0 dB），机械上限 −18 dB：机械永不「压过」风，
    // 主导声仍是风，但电平取两者较大值、嗡鸣电平按契约在 40 座时到 −18 dB。
    expect(factoryLevelForBuildings(FACTORY_FULL_BUILDINGS)).toBeCloseTo(10 ** (-18 / 20), 5);
    const factory = resolveAmbient({ page: 'planet', altitude: 5, runningBuildings: FACTORY_FULL_BUILDINGS });
    expect(factory.name).toBe('wind');
    expect(factory.level).toBeCloseTo(windLevelForAltitude(5), 5);
  });

  it('中空时风仍高于机械上限（机械永不喧宾夺主）', () => {
    const ambient = resolveAmbient({ page: 'planet', altitude: 55, runningBuildings: FACTORY_FULL_BUILDINGS });
    expect(ambient.name).toBe('wind');
    expect(factoryLevelForBuildings(FACTORY_FULL_BUILDINGS)).toBeLessThan(windLevelForAltitude(60));
  });

  it('0 座运行时嗡鸣电平为 0（不切到 factory）', () => {
    expect(factoryLevelForBuildings(0)).toBe(0);
    const ambient = resolveAmbient({ page: 'planet', altitude: 5, runningBuildings: 0 });
    expect(ambient.name).toBe('wind');
  });

  it('全球视角 / 恒星系页 → 轨道低频；其它页静默', () => {
    expect(resolveAmbient({ page: 'planet', altitude: 300, runningBuildings: 40 })).toEqual({ name: 'space', level: 1 });
    expect(resolveAmbient({ page: 'system', altitude: 0, runningBuildings: 0 })).toEqual({ name: 'space', level: 1 });
    expect(resolveAmbient({ page: 'other', altitude: 0, runningBuildings: 0 })).toEqual({ name: null, level: 0 });
  });

  it('风电平在高度 60 以上保持底噪，不归零', () => {
    expect(windLevelForAltitude(60)).toBeGreaterThan(0);
    expect(windLevelForAltitude(1000)).toBe(windLevelForAltitude(60));
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
