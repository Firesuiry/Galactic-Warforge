import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CatalogView, Unit } from '@shared/types';
import { MechaControls } from './MechaControls';
import { shouldRefreshPlanet } from './model';

const { client } = vi.hoisted(() => ({ client: {
  cmdRefuelMecha: vi.fn().mockResolvedValue({ accepted: false, request_id: 'refuel' }),
  fetchEventSnapshot: vi.fn(),
} }));
vi.mock('@/hooks/use-api-client', () => ({ useApiClient: () => client }));
const unit: Unit = {
  id: 'u-1', owner_id: 'p1', type: 'executor', position: { x: 3, y: 2, z: 0 },
  hp: 120, max_hp: 120, attack: 20, defense: 8, attack_range: 4, move_range: 14, vision_range: 6, is_moving: false,
  mecha: { energy: 40, max_energy: 110, fuel_energy: 0, shield: 8, max_shield: 20,
    attack_energy_cost: 8, move_energy_cost: 1, shield_recharge_delay: 10, last_hit_tick: 5 },
};
const catalog = { items: [
  { id: 'coal', name: '煤', mecha_fuel_energy: 25 },
  { id: 'custom_fuel', name: '测试燃料', mecha_fuel_energy: 37 },
  { id: 'iron_ingot', name: '铁锭' },
] } as CatalogView;
beforeEach(() => vi.clearAllMocks());

it('uses server fuel metadata and submits the selected fuel for this mecha', async () => {
  render(<MechaControls unit={unit} catalog={catalog} planetId="planet-1-1" canControl />);
  expect(screen.getByRole('meter', { name: '核心能量' })).toHaveAttribute('value', '40');
  expect(screen.queryByRole('option', { name: /铁锭/ })).toBeNull();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom_fuel' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '消耗 1 个燃料补能' })); });
  await vi.waitFor(() => expect(client.cmdRefuelMecha).toHaveBeenCalledWith('u-1', 'custom_fuel', 1));
});

it('prevents refuel when full or fuel remains and exposes no controls on another player', () => {
  const { rerender } = render(<MechaControls unit={{ ...unit, mecha: { ...unit.mecha!, fuel_energy: 50 } }} catalog={catalog} planetId="planet-1-1" canControl />);
  expect(screen.getByRole('button')).toBeDisabled();
  rerender(<MechaControls unit={{ ...unit, mecha: { ...unit.mecha!, energy: 110 } }} catalog={catalog} planetId="planet-1-1" canControl />);
  expect(screen.getByRole('button')).toBeDisabled();
  rerender(<MechaControls unit={unit} catalog={catalog} planetId="planet-1-1" canControl={false} />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('refreshes authoritative scene data on mecha state events', () => {
  const event = { event_id: 'e1', tick: 10, event_type: 'mecha_state_changed', visibility_scope: 'p1', payload: { planet_id: 'planet-1-1' } };
  expect(shouldRefreshPlanet(event, 'planet-1-1')).toBe(true);
  expect(shouldRefreshPlanet(event, 'planet-1-2')).toBe(false);
});
