import { describe, expect, it } from 'vitest';

import type { AlertEntry, Building } from '@shared/types';

import { blockedBeltHref, blockedBeltMarks, beltAtTile } from './belt-blocked-marks';

function belt(id: string, x: number, y: number, output: 'north' | 'east' | 'south' | 'west' | 'auto' = 'east', blockedTicks?: number): Building {
  return {
    id,
    type: 'conveyor_belt_mk1',
    owner_id: 'p1',
    position: { x, y, z: 0 },
    runtime: { params: {}, state: 'running' },
    conveyor: { input: 'auto', output, buffer: [{ item_id: 'iron_ingot', quantity: 3 }], blocked_ticks: blockedTicks },
  } as unknown as Building;
}

function beltAlert(x: number, y: number, overrides: Record<string, unknown> = {}): AlertEntry {
  return {
    alert_id: `alert-400-b-${x}-${y}-belt_blocked`,
    tick: 400,
    player_id: 'p1',
    building_id: `b-${x}-${y}`,
    building_type: 'conveyor_belt_mk1',
    alert_type: 'belt_blocked',
    severity: 'warning',
    message: '建筑 b-9：传送带被堵，物品运不出去',
    metrics: {},
    details: { position: { x, y, z: 0 }, queued_items: 5, blocked_ticks: 300 },
    ...overrides,
  } as unknown as AlertEntry;
}

describe('传送带堵塞标记（试玩 1016 B1）', () => {
  it('belt_blocked 告警 + 该格确实有带子 → 报出标记（带位置/件数/时长）', () => {
    const marks = blockedBeltMarks([beltAlert(12, 7)], [belt('b-9', 12, 7)]);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      tile: { x: 12, y: 7 },
      queuedItems: 5,
      blockedTicks: 300,
      belt: { id: 'b-9' },
    });
  });

  it('非 belt_blocked 告警不标（产物阻塞仍走建筑告警路径）', () => {
    const marks = blockedBeltMarks(
      [beltAlert(12, 7, { alert_type: 'output_blocked' })],
      [belt('b-9', 12, 7)],
    );
    expect(marks).toEqual([]);
  });

  it('没有 details.position 的旧告警不标（不编造坐标）', () => {
    const marks = blockedBeltMarks(
      [beltAlert(0, 0, { details: { queued_items: 5 } })],
      [belt('b-9', 12, 7)],
    );
    expect(marks).toEqual([]);
  });

  it('该格没有带子（拆掉了/告警来自别的行星）不标', () => {
    expect(blockedBeltMarks([beltAlert(12, 7)], [belt('b-9', 1, 1)])).toEqual([]);
    expect(blockedBeltMarks([beltAlert(12, 7)], [])).toEqual([]);
  });

  it('同格多条告警只留最新一条', () => {
    const marks = blockedBeltMarks(
      [
        beltAlert(12, 7, { alert_id: 'a-old', tick: 100 }),
        beltAlert(12, 7, { alert_id: 'a-new', tick: 900, details: { position: { x: 12, y: 7 }, queued_items: 9, blocked_ticks: 600 } }),
      ],
      [belt('b-9', 12, 7)],
    );
    expect(marks).toHaveLength(1);
    expect(marks[0].alertId).toBe('a-new');
    expect(marks[0].queuedItems).toBe(9);
  });

  it('beltAtTile 只认带格（分拣器/空地上的告警不画杠）', () => {
    const sorter = {
      id: 's-1',
      type: 'sorter_mk1',
      owner_id: 'p1',
      position: { x: 3, y: 3, z: 0 },
      runtime: { params: {}, state: 'running' },
    } as unknown as Building;
    expect(beltAtTile([belt('b-1', 1, 1)], { x: 1, y: 1 })?.id).toBe('b-1');
    expect(beltAtTile([sorter], { x: 3, y: 3 })).toBeNull();
  });

  it('blockedBeltHref：深链直接带 x/y（行星页据此移镜头到该格）', () => {
    expect(blockedBeltHref('planet-1-1', { x: 12, y: 7 })).toBe('/planet/planet-1-1?x=12&y=7');
  });

  it('已解除的告警（active=false）不再画红杠（第 16 轮契约）', () => {
    const marks = blockedBeltMarks(
      [beltAlert(12, 7, { active: false })],
      [belt('b-9', 12, 7, 'east', 9300)],
    );
    expect(marks).toEqual([]);
  });

  it('恢复与否只看告警 active：现场 blocked_ticks 缺失/为 0 都照常画', () => {
    // 服务端 blocked_ticks 是 omitempty：0 时字段缺失，不能拿它判「已恢复」。
    expect(blockedBeltMarks([beltAlert(12, 7)], [belt('b-9', 12, 7, 'east', 0)])).toHaveLength(1);
    expect(blockedBeltMarks([beltAlert(12, 7)], [belt('b-9', 12, 7, 'east', 500)])).toHaveLength(1);
    expect(blockedBeltMarks([beltAlert(12, 7)], [belt('b-9', 12, 7, 'east', undefined)])).toHaveLength(1);
  });

  it('active=true / 缺省（旧服务端）都按成立处理', () => {
    expect(blockedBeltMarks([beltAlert(12, 7, { active: true })], [belt('b-9', 12, 7, 'east', 500)])).toHaveLength(1);
    expect(blockedBeltMarks([beltAlert(12, 7)], [belt('b-9', 12, 7, 'east', 500)])).toHaveLength(1);
  });
});
