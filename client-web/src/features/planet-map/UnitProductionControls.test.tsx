import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Building, CatalogView } from '@shared/types';

import { UnitProductionControls } from './UnitProductionControls';

vi.mock('@/hooks/use-api-client', () => ({
  useApiClient: () => ({ cmdProduce: vi.fn(), cmdSetRallyPoint: vi.fn(), fetchEventSnapshot: vi.fn() }),
}));

const catalog = {
  items: [
    { id: 'iron_ingot', name: '铁块' },
    { id: 'gear', name: '齿轮' },
    { id: 'magnetic_coil', name: '磁线圈' },
    { id: 'circuit_board', name: '电路板' },
  ],
  world_units: [
    {
      id: 'executor',
      name: '执行体机甲',
      producer: 'battlefield_analysis_base',
      production_mode: 'world_produce',
      production_ticks: 600,
      cost: [
        { item_id: 'iron_ingot', quantity: 16 },
        { item_id: 'gear', quantity: 8 },
        { item_id: 'magnetic_coil', quantity: 8 },
        { item_id: 'circuit_board', quantity: 8 },
      ],
    },
  ],
} as unknown as CatalogView;

const base = {
  id: 'b-base',
  type: 'battlefield_analysis_base',
  owner_id: 'p1',
  position: { x: 3, y: 3, z: 0 },
  hp: 100,
  max_hp: 100,
  level: 1,
  vision_range: 8,
  runtime: { params: {}, state: 'running' },
} as unknown as Building;

describe('基站生产面板（契约 §7.3 第 5 条）', () => {
  it('executor 按 producer 自动出现在基站可生产列表，文案与成本正确', () => {
    render(<UnitProductionControls building={base} catalog={catalog} planetId="planet-1-1" canControl />);
    expect(screen.getByRole('region', { name: '单位生产' })).toBeInTheDocument();
    expect(screen.getByText('执行体机甲')).toBeInTheDocument();
    expect(screen.getByText('铁块 × 16、齿轮 × 8、磁线圈 × 8、电路板 × 8 · 600 tick')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生产执行体机甲' })).toBeEnabled();
  });

  it('别的建筑不显示基站单位', () => {
    render(<UnitProductionControls building={{ ...base, type: 'wind_turbine' }} catalog={catalog} planetId="planet-1-1" canControl />);
    expect(screen.queryByRole('region', { name: '单位生产' })).toBeNull();
  });
});
