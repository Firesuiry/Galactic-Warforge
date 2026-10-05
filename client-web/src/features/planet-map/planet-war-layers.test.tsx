import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CombatSquad, WarTheaterView } from '@shared/types';

import { PlanetSquadLayer } from '@/features/planet-map/PlanetSquadLayer';
import { PlanetTheaterControls } from '@/features/planet-map/PlanetTheaterControls';
import { PlanetTheaterLayer } from '@/features/planet-map/PlanetTheaterLayer';
import { resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';
import { useSessionStore } from '@/stores/session';

function squad(id: string, overrides: Partial<CombatSquad> = {}): CombatSquad {
  return {
    id,
    owner_id: 'p1',
    planet_id: 'planet-1',
    name: '军团',
    member_ids: ['u-1', 'u-2', 'u-3'],
    order: 'idle',
    state: 'idle',
    position: { x: 5, y: 6, z: 0 },
    last_order_tick: 0,
    ...overrides,
  };
}

describe('PlanetSquadLayer', () => {
  it('只标记有可见成员的敌方军团（己方军团由军团层绘制），点击触发选中回调', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <PlanetSquadLayer
        offsetX={0}
        offsetY={0}
        onSelectSquad={onSelect}
        playerId="p1"
        selectedSquads={[]}
        squads={[
          squad('sq-1'),
          squad('sq-2', { owner_id: 'p2' }),
          squad('sq-3', { owner_id: 'p2', state: 'destroyed' }),
          squad('sq-4', { owner_id: 'p2', member_ids: [] }),
        ]}
        tileSize={48}
      />,
    );
    const markers = screen.getAllByRole('button');
    expect(markers).toHaveLength(1);
    const hostile = screen.getByRole('button', { name: '敌方小队 sq-2' });
    expect(hostile).toHaveClass('planet-squad-marker--hostile');
    expect(hostile.style.left).toBe('264px');
    expect(hostile).toHaveTextContent('3');
    await user.click(hostile);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'sq-2' }), false);
  });

  it('无小队时不渲染', () => {
    const { container } = render(
      <PlanetSquadLayer
        offsetX={0}
        offsetY={0}
        onSelectSquad={vi.fn()}
        playerId="p1"
        selectedSquads={[]}
        squads={[]}
        tileSize={48}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('PlanetTheaterLayer', () => {
  const theaters: WarTheaterView[] = [
    {
      id: 'th-1',
      name: '北线',
      zones: [
        { zone_type: 'primary', planet_id: 'planet-1', position: { x: 10, y: 10, z: 0 }, radius: 6, hostile_count: 2, alerted: true },
        { zone_type: 'rally', planet_id: 'planet-2', position: { x: 3, y: 3, z: 0 }, radius: 4, hostile_count: 0, alerted: false },
      ],
    },
  ];

  it('只画当前行星的 zone，告警态带红色与脉动类名', () => {
    const { container } = render(
      <PlanetTheaterLayer offsetX={0} offsetY={0} planetId="planet-1" theaters={theaters} tileSize={48} />,
    );
    const circles = container.querySelectorAll('circle');
    expect(circles).toHaveLength(1);
    expect(circles[0].getAttribute('stroke')).toBe('#ff1744');
    expect(circles[0].classList.contains('planet-theater-zone--alerted')).toBe(true);
    expect(container.textContent).toContain('北线');
    expect(container.textContent).toContain('敌情 2');
  });
});

describe('PlanetTheaterControls', () => {
  beforeEach(() => {
    resetPlanetViewStore();
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:9999',
      playerId: 'p1',
      playerKey: 'key',
    });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ request_id: 'r', accepted: true, results: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))));
    return () => vi.unstubAllGlobals();
  });

  it('选战区+类型后进入 theater_zone 拖拽模式', async () => {
    const user = userEvent.setup();
    render(
      <PlanetTheaterControls
        dimensional={false}
        planetId="planet-1"
        theaters={[{ id: 'th-1', name: '北线' }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: '战区划定' }));
    await user.click(screen.getByRole('button', { name: '开始拖拽划定' }));
    expect(usePlanetViewStore.getState().interactionMode).toEqual({
      kind: 'theater_zone',
      theaterId: 'th-1',
      zoneType: 'primary',
    });
  });

  it('无战区时给内联创建表单；3D 下提示切换视图', async () => {
    const user = userEvent.setup();
    render(
      <PlanetTheaterControls
        dimensional={false}
        planetId="planet-1"
        theaters={[]}
      />,
    );
    await user.click(screen.getByRole('button', { name: '战区划定' }));
    expect(screen.getByText(/暂无战区/)).toBeInTheDocument();
  });

  it('3D 视图隐藏拖拽按钮', async () => {
    const user = userEvent.setup();
    render(
      <PlanetTheaterControls
        dimensional
        planetId="planet-1"
        theaters={[{ id: 'th-1' }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: '战区划定' }));
    expect(screen.queryByRole('button', { name: '开始拖拽划定' })).not.toBeInTheDocument();
    expect(screen.getByText(/平面战术/)).toBeInTheDocument();
  });
});
