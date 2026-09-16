import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CatalogView, PlayerState, Unit } from '@shared/types';
import { MechaControls } from './MechaControls';
import { shouldRefreshPlanet, shouldRefreshSummary } from './model';

const { client } = vi.hoisted(() => ({ client: {
  cmdRefuelMecha: vi.fn().mockResolvedValue({ accepted: false, request_id: 'refuel' }),
  fetchEventSnapshot: vi.fn(),
  cmdCraftItem: vi.fn().mockResolvedValue({ accepted: false, request_id: 'craft' }),
  cmdCancelMechaJob: vi.fn().mockResolvedValue({ accepted: false, request_id: 'cancel' }),
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
  fireEvent.change(screen.getByRole('combobox', { name: '机甲燃料' }), { target: { value: 'custom_fuel' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '消耗 1 个燃料补能' })); });
  await vi.waitFor(() => expect(client.cmdRefuelMecha).toHaveBeenCalledWith('u-1', 'custom_fuel', 1));
});

it('prevents refuel when full or fuel remains and exposes no controls on another player', () => {
  const { rerender } = render(<MechaControls unit={{ ...unit, mecha: { ...unit.mecha!, fuel_energy: 50 } }} catalog={catalog} planetId="planet-1-1" canControl />);
  expect(screen.getByRole('button', { name: '消耗 1 个燃料补能' })).toBeDisabled();
  rerender(<MechaControls unit={{ ...unit, mecha: { ...unit.mecha!, energy: 110 } }} catalog={catalog} planetId="planet-1-1" canControl />);
  expect(screen.getByRole('button', { name: '消耗 1 个燃料补能' })).toBeDisabled();
  rerender(<MechaControls unit={unit} catalog={catalog} planetId="planet-1-1" canControl={false} />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('refreshes authoritative scene data on mecha state events', () => {
  const event = { event_id: 'e1', tick: 10, event_type: 'mecha_state_changed', visibility_scope: 'p1', payload: { planet_id: 'planet-1-1' } };
  expect(shouldRefreshPlanet(event, 'planet-1-1')).toBe(true);
  expect(shouldRefreshPlanet(event, 'planet-1-2')).toBe(false);
  expect(shouldRefreshSummary(event)).toBe(true);
  expect(shouldRefreshSummary({ ...event, event_type: 'resource_changed' })).toBe(true);
  expect(shouldRefreshPlanet({ ...event, event_type: 'resource_changed' }, 'planet-1-1')).toBe(true);
});

const craftingCatalog = { ...catalog, recipes: [
  { id: 'gear', name: '齿轮', handcraft_allowed: true, inputs: [{ item_id: 'iron_ingot', quantity: 1 }], outputs: [{ item_id: 'gear', quantity: 1 }], duration: 4, energy_cost: 20 },
  { id: 'locked', name: '锁定配方', handcraft_allowed: true, inputs: [], outputs: [], duration: 4, tech_unlock: ['advanced'] },
  { id: 'factory_only', name: '工厂限定', inputs: [], outputs: [], duration: 4 },
] } as CatalogView;
const player: PlayerState = { player_id: 'p1', is_alive: true, inventory: { iron_ingot: 5 } };

it('shows actual backpack stock, computes batches and submits personal crafting', async () => {
  render(<MechaControls unit={unit} catalog={craftingCatalog} planetId="planet-1-1" canControl player={player} />);
  expect(screen.queryByRole('option', { name: '工厂限定' })).toBeNull();
  fireEvent.change(screen.getByLabelText('制造批数'), { target: { value: '3' } });
  expect(screen.getByText('原料：铁锭 3（背包 5）')).toBeInTheDocument();
  expect(screen.getByText('耗时 12 tick · 核心耗能 12（每 tick 1）')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '开始制造' })); });
  expect(client.cmdCraftItem).toHaveBeenCalledWith('u-1', 'gear', 3);
});

it('blocks locked recipes and insufficient ingredients before submitting', () => {
  render(<MechaControls unit={unit} catalog={craftingCatalog} planetId="planet-1-1" canControl player={player} />);
  fireEvent.change(screen.getByLabelText('制造批数'), { target: { value: '6' } });
  expect(screen.getByRole('button', { name: '开始制造' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('背包原料不足');
  fireEvent.change(screen.getByLabelText('个人制造配方'), { target: { value: 'locked' } });
  expect(screen.getByRole('button', { name: '开始制造' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('需要科技');
  expect(client.cmdCraftItem).not.toHaveBeenCalled();
});

it('shows paused job progress, cancels it and hides all controls on another player', async () => {
  const busy: Unit = { ...unit, mecha: { ...unit.mecha!, job: { kind: 'craft', recipe_id: 'gear', remaining_ticks: 2, ticks_per_batch: 4, remaining_batches: 2, completed_batches: 1, energy_per_tick: 1, state: 'no_energy' } } };
  const { rerender } = render(<MechaControls unit={busy} catalog={craftingCatalog} planetId="planet-1-1" canControl player={player} />);
  expect(screen.getByText('核心能量不足，补能后自动继续。')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '2');
  expect(screen.getByRole('button', { name: '开始制造' })).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '取消机甲任务' })); });
  expect(client.cmdCancelMechaJob).toHaveBeenCalledWith('u-1');
  rerender(<MechaControls unit={busy} catalog={craftingCatalog} planetId="planet-1-1" canControl={false} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
});

it('treats omitted inventory in a fresh player snapshot as an empty backpack', () => {
  render(<MechaControls unit={unit} catalog={craftingCatalog} planetId="planet-1-1" canControl player={{ player_id: 'p1', is_alive: true }} />);
  expect(screen.getByText('原料：铁锭 1（背包 0）')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('背包原料不足');
  expect(screen.queryByText('正在读取背包…')).toBeNull();
  expect(screen.getByRole('button', { name: '开始制造' })).toBeDisabled();
});
