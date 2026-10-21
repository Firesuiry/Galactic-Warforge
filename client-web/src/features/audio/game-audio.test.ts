import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameEventDetail } from '@shared/types';

import type { BattleEvent } from '@/engine/battle-events';
import { sfx } from '@/engine/audio';
import { resetAudioListenerForTests } from '@/features/audio/spatial';
import { isBuildingCompletionEvent, playPlanetEventAudio } from '@/features/audio/planet-audio';
import { playBattleEventAudio, resetBattleAudioResolversForTests, setBattleAudioResolvers } from '@/features/audio/use-game-audio';

/** 全部 sfx 方法的 mock（新增音效必须在这里登记，否则映射调用会直接 TypeError）。 */
vi.mock('@/engine/audio', () => {
  const names = [
    'fire', 'fireGauss', 'fireLaser', 'fireMissile', 'firePlasma', 'fireGeneric',
    'explosion', 'explosionNear', 'explosionFar', 'intercept', 'hit',
    'commandOk', 'commandFail', 'buildComplete', 'constructionComplete', 'researchComplete',
    'alert', 'notify', 'buildPlace', 'demolish', 'beltPlace',
    'unitSelect', 'unitAck', 'orderMove', 'orderAttack',
    'uiClick', 'uiHover', 'uiPanelOpen', 'uiPanelClose',
  ];
  return { sfx: Object.fromEntries(names.map((name) => [name, vi.fn()])) };
});

function battleEvent(type: string, payload: Record<string, unknown> = {}): BattleEvent {
  return { seq: 1, at: 0, type, payload, eventId: `be-${type}`, tick: 0 };
}

let nextEventId = 1;
function gameEvent(eventType: string, payload: Record<string, unknown> = {}, eventId?: string): GameEventDetail {
  const id = eventId ?? `evt-audio-${nextEventId}`;
  nextEventId += 1;
  return {
    event_id: id,
    tick: 100,
    event_type: eventType,
    visibility_scope: 'p1',
    payload,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAudioListenerForTests();
  resetBattleAudioResolversForTests();
});

describe('playBattleEventAudio 战斗事件 → 音效', () => {
  it('missile_salvo_fired → fireMissile', () => {
    playBattleEventAudio(battleEvent('missile_salvo_fired', { fleet_id: 'f1' }));
    expect(sfx.fireMissile).toHaveBeenCalledTimes(1);
  });

  it('point_defense_intercept → intercept', () => {
    playBattleEventAudio(battleEvent('point_defense_intercept', { intercepted: 2 }));
    expect(sfx.intercept).toHaveBeenCalledTimes(1);
  });

  it('battle_report_generated：target_destroyed 升级大爆炸，否则小爆炸', () => {
    playBattleEventAudio(battleEvent('battle_report_generated', { report: { target_destroyed: true } }));
    expect(sfx.explosion).toHaveBeenCalledWith(true, undefined);

    playBattleEventAudio(battleEvent('battle_report_generated', { report: { target_destroyed: false } }));
    expect(sfx.explosion).toHaveBeenCalledWith(false, undefined);

    playBattleEventAudio(battleEvent('battle_report_generated', {}));
    expect(sfx.explosion).toHaveBeenCalledWith(false, undefined);
    expect(sfx.explosion).toHaveBeenCalledTimes(3);
  });

  it('entity_destroyed → 大爆炸', () => {
    playBattleEventAudio(battleEvent('entity_destroyed', { entity_id: 'e1' }));
    expect(sfx.explosion).toHaveBeenCalledWith(true, undefined);
  });

  it('damage_applied → 按攻击方炮塔类型的开火音 + 命中', () => {
    playBattleEventAudio(battleEvent('damage_applied', { attacker_type: 'turret', damage: 5 }));
    expect(sfx.fireGeneric).toHaveBeenCalledTimes(1);
    expect(sfx.hit).toHaveBeenCalledTimes(1);

    // 攻击方类型由场景反查（服务端 damage_applied 只有 id）
    playBattleEventAudio(battleEvent('damage_applied', { attacker_id: 'b-gauss', damage: 5 }), () => null, (id) => (id === 'b-gauss' ? 'gauss_turret' : undefined));
    expect(sfx.fireGauss).toHaveBeenCalledTimes(1);
  });

  it('damage_applied 的炮塔类型覆盖 gauss / laser / missile / plasma', () => {
    const cases: Array<[string, keyof typeof sfx]> = [
      ['gauss_turret', 'fireGauss'],
      ['laser_turret', 'fireLaser'],
      ['missile_turret', 'fireMissile'],
      ['plasma_turret', 'firePlasma'],
      ['anti_air_turret', 'fireGeneric'],
    ];
    for (const [type, sound] of cases) {
      playBattleEventAudio(battleEvent('damage_applied', { attacker_type: type }));
      expect(sfx[sound]).toHaveBeenCalled();
    }
  });

  it('未知事件不响', () => {
    playBattleEventAudio(battleEvent('tick_completed', {}));
    expect(sfx.fire).not.toHaveBeenCalled();
    expect(sfx.hit).not.toHaveBeenCalled();
  });
});

describe('isBuildingCompletionEvent 建筑完成态判定', () => {
  it('idle → running（start/空原因/resume）算完成', () => {
    expect(isBuildingCompletionEvent({ prev_state: 'idle', next_state: 'running', reason: 'start' })).toBe(true);
    expect(isBuildingCompletionEvent({ prev_state: 'idle', next_state: 'running' })).toBe(true);
    expect(isBuildingCompletionEvent({ prev_state: 'paused', next_state: 'running', reason: 'resume' })).toBe(true);
  });

  it('电力恢复/故障清除/非 running 终态不算完成', () => {
    expect(isBuildingCompletionEvent({ prev_state: 'no_power', next_state: 'running', reason: 'power_restored' })).toBe(false);
    expect(isBuildingCompletionEvent({ prev_state: 'error', next_state: 'running', reason: 'fault_cleared' })).toBe(false);
    expect(isBuildingCompletionEvent({ prev_state: 'running', next_state: 'paused', reason: 'pause' })).toBe(false);
    expect(isBuildingCompletionEvent({ prev_state: 'running', next_state: 'running', reason: 'start' })).toBe(false);
  });
});

describe('playPlanetEventAudio 行星事件 → 音效', () => {
  it('building_state_changed 完成态 → buildComplete；非完成态不响', () => {
    playPlanetEventAudio(gameEvent('building_state_changed', {
      prev_state: 'idle', next_state: 'running', reason: 'start',
    }));
    expect(sfx.buildComplete).toHaveBeenCalledTimes(1);

    playPlanetEventAudio(gameEvent('building_state_changed', {
      prev_state: 'running', next_state: 'paused', reason: 'pause',
    }));
    expect(sfx.buildComplete).toHaveBeenCalledTimes(1);
  });

  it('research_completed → researchComplete', () => {
    playPlanetEventAudio(gameEvent('research_completed', { tech_id: 't1' }));
    expect(sfx.researchComplete).toHaveBeenCalledTimes(1);
  });

  it('production_alert：缺电告警 → alert，普通产线告警 → notify', () => {
    playPlanetEventAudio(gameEvent('production_alert', { alert: { alert_id: 'a1', alert_type: 'power_shortage' } }));
    expect(sfx.alert).toHaveBeenCalledTimes(1);
    expect(sfx.notify).not.toHaveBeenCalled();

    playPlanetEventAudio(gameEvent('production_alert', { alert: { alert_id: 'a2', alert_type: 'belt_blocked' } }));
    expect(sfx.notify).toHaveBeenCalledTimes(1);
    expect(sfx.alert).toHaveBeenCalledTimes(1);
  });

  it('rocket_launched → fireMissile', () => {
    playPlanetEventAudio(gameEvent('rocket_launched', { rocket_id: 'r1' }));
    expect(sfx.fireMissile).toHaveBeenCalledTimes(1);
  });

  it('施工暂停/恢复 → commandFail / commandOk', () => {
    playPlanetEventAudio(gameEvent('construction_paused', { building_id: 'b1' }));
    expect(sfx.commandFail).toHaveBeenCalledTimes(1);
    playPlanetEventAudio(gameEvent('construction_resumed', { building_id: 'b1' }));
    expect(sfx.commandOk).toHaveBeenCalledTimes(1);
  });

  it('黑雾被激怒 → alert；恢复中立 → notify', () => {
    playPlanetEventAudio(gameEvent('dark_fog_provoked', { until_tick: 900 }));
    expect(sfx.alert).toHaveBeenCalledTimes(1);
    playPlanetEventAudio(gameEvent('dark_fog_calmed', {}));
    expect(sfx.notify).toHaveBeenCalledTimes(1);
  });

  it('无关事件不响', () => {
    playPlanetEventAudio(gameEvent('tick_completed', {}));
    playPlanetEventAudio(gameEvent('resource_changed', {}));
    expect(sfx.buildComplete).not.toHaveBeenCalled();
    expect(sfx.researchComplete).not.toHaveBeenCalled();
    expect(sfx.alert).not.toHaveBeenCalled();
    expect(sfx.fireMissile).not.toHaveBeenCalled();
  });

  it('同一 event_id 重复到达只响一次', () => {
    const event = gameEvent('production_alert', { alert: { alert_id: 'a2', alert_type: 'power_shortage' } }, 'evt-dup-1');
    playPlanetEventAudio(event);
    playPlanetEventAudio(event);
    playPlanetEventAudio(gameEvent('production_alert', { alert: { alert_id: 'a2' } }, 'evt-dup-1'));
    expect(sfx.alert).toHaveBeenCalledTimes(1);
  });
});

describe('战斗音效空间化', () => {
  it('事件带格坐标且监听器就绪时按距离/声相传入', async () => {
    const { setAudioListener } = await import('@/features/audio/spatial');
    setAudioListener({
      center: { x: 10, y: 10 },
      altitude: 10,
      globalView: false,
      width: 1000,
      height: 800,
      faceSize: 32,
      project: () => ({ x: 750, y: 400, visible: true }),
    });
    playBattleEventAudio(battleEvent('entity_destroyed', { entity_id: 'e1', position: { x: 12, y: 10, z: 0 } }));
    // 距离 2 格 → −1.2 dB；屏幕 x 750/1000 → pan 0.5
    expect(sfx.explosion).toHaveBeenCalledWith(true, expect.objectContaining({ volumeDb: -1.2, pan: 0.5 }));
  });

  it('超过 60 格不播（spatial 为 undefined，按非空间音播放）', async () => {
    const { setAudioListener } = await import('@/features/audio/spatial');
    setAudioListener({
      center: { x: 10, y: 10 },
      altitude: 10,
      globalView: false,
      width: 1000,
      height: 800,
      faceSize: 32,
      project: null,
    });
    // 同面 60 格内没有该点：距离查询失败 → audible=false → 不空间化
    playBattleEventAudio(battleEvent('entity_destroyed', { entity_id: 'e1', position: { x: 300, y: 10 } }));
    expect(sfx.explosion).toHaveBeenCalledWith(true, undefined);
  });

  it('攻击方 id 由场景反查（resolveType 钩子）', () => {
    setBattleAudioResolvers({ type: (id) => (id === 'b1' ? 'laser_turret' : undefined) });
    playBattleEventAudio(battleEvent('damage_applied', { attacker_id: 'b1', target_id: 'u1' }));
    expect(sfx.fireLaser).toHaveBeenCalledTimes(1);
  });
});
