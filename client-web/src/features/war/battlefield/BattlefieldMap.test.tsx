import type { FleetRuntimeView, SystemRuntimeView } from '@shared/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BattlefieldMap } from '@/features/war/battlefield/BattlefieldMap';

// jsdom 无 WebGL：mock PixiStage 为占位 div（保留 className 以校验容器 chrome），
// 场景/特效的几何与生命周期由 battlefield-model / battlefield-effects 纯函数用例覆盖。
vi.mock('@/engine/PixiStage', () => ({
  PixiStage: ({ className }: { className?: string }) => (
    <div data-testid="pixi-stage" className={className} />
  ),
}));

const runtime = {
  system_id: 'sys-1',
  discovered: true,
  available: true,
  orbital_superiority: {
    system_id: 'sys-1',
    advantage_player_id: 'p1',
    contest_intensity: 0.4,
    last_reason: 'task_force_superiority',
    updated_tick: 320,
  },
  planet_blockades: [{ planet_id: 'planet-1-1', system_id: 'sys-1', owner_id: 'p1', status: 'active', intensity: 0.6 }],
  landing_operations: [{ id: 'landing-1', owner_id: 'p1', task_force_id: 'tf-1', system_id: 'sys-1', planet_id: 'planet-1-1', stage: 'reconnaissance', result: 'pending' }],
  contacts: [{ id: 'contact-1', scope_type: 'system', scope_id: 'sys-1', contact_kind: 'enemy_force', level: 'confirmed', position: { x: 4, y: 2 }, threat_level: 7, signal_strength: 0.7, classification: 'destroyer_screen', last_updated_tick: 320 }],
  battle_reports: [],
} as unknown as SystemRuntimeView;

const fleets = [
  { fleet_id: 'fleet-1', owner_id: 'p1', system_id: 'sys-1', formation: 'line', state: 'ready' },
] as unknown as FleetRuntimeView[];

describe('BattlefieldMap', () => {
  it('渲染星系战场态势标题、图例、制空权摘要与 Pixi 画布容器', () => {
    const { container } = render(
      <BattlefieldMap
        systemName="Helios"
        planets={[{ planet_id: 'planet-1-1', name: 'Gaia', discovered: true, kind: 'terrestrial' }]}
        runtime={runtime}
        fleets={fleets}
        playerId="p1"
      />,
    );

    expect(screen.getByText(/战场态势 · Helios/)).toBeInTheDocument();
    expect(screen.getByText(/制空权：p1/)).toBeInTheDocument();
    expect(screen.getByText(/接触 1 · 舰队 1 · 封锁 1 · 登陆 1/)).toBeInTheDocument();
    expect(screen.getByText('己方舰队')).toBeInTheDocument();
    expect(screen.getByText('敌方接触')).toBeInTheDocument();
    // Pixi 画布挂在 .battlefield-canvas 容器里
    expect(container.querySelector('.battlefield-canvas')).not.toBeNull();
    expect(screen.getByTestId('pixi-stage')).toHaveClass('battlefield-canvas');
    // 未点击选中时无回显
    expect(screen.queryByText(/已选中：/)).not.toBeInTheDocument();
  });
});
