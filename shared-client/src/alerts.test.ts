import { describe, expect, it } from 'vitest';

import {
  ALERT_TYPE_LABELS,
  PRODUCTION_ALERT_TYPES,
  alertDetailsPosition,
  alertTypeLabel,
  beltBlockedText,
  formatAlertText,
  ticksToSeconds,
} from './alerts.js';

function alert(overrides: Record<string, unknown> = {}) {
  return {
    alert_type: 'belt_blocked',
    message: '建筑 b-3：传送带被堵，物品运不出去',
    details: {},
    ...overrides,
  } as { alert_type: string; message: string; details: Record<string, unknown> };
}

describe('产线告警中文文案（shared-client）', () => {
  it('每种服务端告警类型都有中文标签，未知类型不裸显 snake_case', () => {
    for (const type of PRODUCTION_ALERT_TYPES) {
      const label = alertTypeLabel(type);
      expect(label).not.toMatch(/[a-z]+_[a-z]+/);
      expect(label).not.toBe('产线告警');
    }
    expect(alertTypeLabel('some_new_alert')).toBe('产线告警');
    expect(alertTypeLabel(undefined)).toBe('产线告警');
  });

  it('belt_blocked：位置 + 件数 + 停顿时长都换算成中文', () => {
    const text = beltBlockedText(alert({
      details: { position: { x: 12, y: 7, z: 0 }, queued_items: 5, blocked_ticks: 300 },
    }));
    expect(text).toBe('传送带堵塞 (12, 7)：5 件货 30 秒没动');
    expect(text).not.toMatch(/[a-z]+_[a-z]+/);
    expect(text).not.toContain('belt_blocked');
  });

  it('belt_blocked：速率覆盖按实际 tick 速率换算', () => {
    const text = beltBlockedText(
      alert({ details: { position: { x: 1, y: 2 }, queued_items: 3, blocked_ticks: 600 } }),
      4,
    );
    expect(text).toBe('传送带堵塞 (1, 2)：3 件货 150 秒没动');
  });

  it('belt_blocked：details 缺项时少写那段，不写占位符也不编数字', () => {
    expect(beltBlockedText(alert())).toBe('传送带堵塞');
    expect(beltBlockedText(alert({ details: { position: { x: 3, y: 4 } } }))).toBe('传送带堵塞 (3, 4)');
    expect(beltBlockedText(alert({ details: { queued_items: 2, blocked_ticks: 300 } }))).toBe('传送带堵塞：2 件货 30 秒没动');
  });

  it('formatAlertText：belt_blocked 走位置文案，其余类型只给标签', () => {
    expect(formatAlertText(alert({ details: { position: { x: 5, y: 5 }, queued_items: 1, blocked_ticks: 300 } })))
      .toBe('传送带堵塞 (5, 5)：1 件货 30 秒没动');
    expect(formatAlertText(alert({ alert_type: 'output_blocked' }))).toBe('产物阻塞');
    expect(formatAlertText(alert({ alert_type: 'unit_spawn_blocked' }))).toBe('出厂口被占满');
    expect(formatAlertText(alert({ alert_type: 'mystery_type' }))).toBe('产线告警');
  });

  it('alertDetailsPosition：支持嵌套 position 与平铺 x/y，缺项返回 null', () => {
    expect(alertDetailsPosition({ position: { x: 12.6, y: 7.2 } })).toEqual({ x: 13, y: 7 });
    expect(alertDetailsPosition({ x: 2, y: 3 })).toEqual({ x: 2, y: 3 });
    expect(alertDetailsPosition({ position: { x: 1 } })).toBeNull();
    expect(alertDetailsPosition({})).toBeNull();
    expect(alertDetailsPosition(undefined)).toBeNull();
  });

  it('ticksToSeconds：按速率换算，速率缺失回退 10 tps', () => {
    expect(ticksToSeconds(300)).toBe(30);
    expect(ticksToSeconds(300, 4)).toBe(75);
    expect(ticksToSeconds(300, 0)).toBe(30);
  });

  it('标签表与类型清单一一对应（没有漏键的死枚举）', () => {
    expect(Object.keys(ALERT_TYPE_LABELS).sort()).toEqual([...PRODUCTION_ALERT_TYPES].sort());
  });
});
