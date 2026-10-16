import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import type { AlertEntry, Building } from '@shared/types';

import { PlanetBeltBlockedLayer } from './PlanetBeltBlockedLayer';

function belt(id: string, x: number, y: number, output: 'north' | 'east' | 'south' | 'west'): Building {
  return {
    id,
    type: 'conveyor_belt_mk1',
    owner_id: 'p1',
    position: { x, y, z: 0 },
    runtime: { params: {}, state: 'running' },
    conveyor: { input: 'auto', output, buffer: [] },
  } as unknown as Building;
}

const alert = {
  alert_id: 'a-belt',
  tick: 400,
  player_id: 'p1',
  building_id: 'b-9',
  building_type: 'conveyor_belt_mk1',
  alert_type: 'belt_blocked',
  severity: 'warning',
  message: '建筑 b-9：传送带被堵，物品运不出去',
  metrics: {},
  details: { position: { x: 2, y: 3, z: 0 }, queued_items: 4, blocked_ticks: 300 },
} as unknown as AlertEntry;

describe('PlanetBeltBlockedLayer（2D 传送带堵塞红杠）', () => {
  it('有堵塞带子时画出红杠标记（带 tile 数据属性，短杠垂直于流向）', () => {
    const { container } = render(
      <PlanetBeltBlockedLayer
        alerts={[alert]}
        buildings={[belt('b-9', 2, 3, 'east')]}
        offsetX={0}
        offsetY={0}
        tileSize={16}
      />,
    );
    const marker = container.querySelector('.planet-belt-blocked-marker');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute('data-tile-x')).toBe('2');
    expect(marker?.getAttribute('data-tile-y')).toBe('3');
    expect(marker?.getAttribute('title')).toContain('4 件货');
    // 流向 east：短杠垂直于流向 → 旋转 90°（atan2(1, 0) = π/2）。
    expect((marker as HTMLElement).style.transform).toContain('rotate(1.5707963267948966rad)');
    expect(marker?.textContent ?? '').not.toMatch(/[a-z]+_[a-z]+/);
  });

  it('没有 belt_blocked 告警时整层不渲染', () => {
    const { container } = render(
      <PlanetBeltBlockedLayer alerts={[]} buildings={[belt('b-9', 2, 3, 'east')]} offsetX={0} offsetY={0} tileSize={16} />,
    );
    expect(container.querySelector('.planet-belt-blocked-layer')).toBeNull();
  });

  it('告警指向的格子没有带子时不标（不凭空画红杠）', () => {
    const { container } = render(
      <PlanetBeltBlockedLayer alerts={[alert]} buildings={[]} offsetX={0} offsetY={0} tileSize={16} />,
    );
    expect(container.querySelector('.planet-belt-blocked-layer')).toBeNull();
  });
});
