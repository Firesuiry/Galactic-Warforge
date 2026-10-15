import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Building, CatalogView, CommandResponse, PlanetView } from '@shared/types';
import { SorterControls } from './SorterControls';
import { PlanetEntityPanel } from './PlanetPanels';
import { usePlanetViewStore } from './store';
import { usePlanetCommandStore } from '@/features/planet-commands/store';
const { client } = vi.hoisted(() => ({ client: { cmdConfigureSorter: vi.fn(), fetchEventSnapshot: vi.fn() } }));
vi.mock('@/hooks/use-api-client', () => ({ useApiClient: () => client }));
vi.mock('@/hooks/use-session', () => ({ useSessionSnapshot: () => ({ playerId: 'p1', playerKey: 'key', serverUrl: 'http://test.local' }) }));
/** 服务端 `SorterState` 已不含方向字段：取/放端只由 rotation 推出（背面取货、正面放货）。 */
const building: Building = {
  id: 'sorter-1', type: 'sorter_mk1', owner_id: 'p1', position: { x: 2, y: 2, z: 0 }, hp: 100, max_hp: 100, level: 1, vision_range: 4, rotation: '90',
  runtime: { params: { energy_consume: 1, energy_generate: 0, capacity: 0, footprint: { width: 1, height: 1 } }, functions: {}, state: 'running' },
  sorter: { cycle_ticks: 6, range: 1, filter: { mode: 'allow', items: ['iron_ore'] } },
};
const catalog = { items: [{ id: 'iron_ore', name: '铁矿石' }, { id: 'copper_ore', name: '铜矿石' }] } as CatalogView;
function show(value = building, canControl = true) {
  return render(<SorterControls building={value} catalog={catalog} planetId="planet-1-1" canControl={canControl} />);
}
beforeEach(() => {
  vi.clearAllMocks();
  client.cmdConfigureSorter.mockResolvedValue({ request_id: 'sorter-config', accepted: false, enqueue_tick: 0, results: [] });
  usePlanetViewStore.getState().resetForPlanet('planet-1-1');
  usePlanetCommandStore.getState().resetForPlanet('planet-1-1');
});

it('shows the read-only direction derived from rotation and the current filter', () => {
  show();
  // 方向只读展示「背面取货 → 正面放货」，由 rotation 推出（90° → 正面东），不再是可编辑的四向下拉。
  expect(screen.getByTestId('sorter-direction')).toHaveTextContent('背面 西 → 正面 东');
  expect(screen.queryByLabelText('北侧方向')).toBeNull();
  expect(screen.getByLabelText('过滤模式')).toHaveValue('allow');
  expect(screen.getByLabelText('过滤物品')).toHaveValue(['iron_ore']);
});

it('submits only the filter — direction never enters the payload', async () => {
  show();
  fireEvent.change(screen.getByLabelText('过滤模式'), { target: { value: 'deny' } });
  const items = screen.getByLabelText('过滤物品');
  for (const option of Array.from(items.querySelectorAll('option'))) option.selected = false;
  fireEvent.change(items);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '应用分拣设置' })); });
  expect(client.cmdConfigureSorter).toHaveBeenCalledWith('sorter-1', {
    filter_mode: 'deny', filter_items: [],
  }, 'planet-1-1');
  expect(usePlanetCommandStore.getState().journal[0].commandType).toBe('configure_sorter');
});

it('preserves the draft on transport ticks but follows authoritative filter changes', () => {
  const { rerender } = show();
  fireEvent.change(screen.getByLabelText('过滤模式'), { target: { value: 'deny' } });
  rerender(<SorterControls building={{ ...building, sorter: { ...building.sorter!, last_transfer: { tick: 9, sequence: 3, source_id: 'a', target_id: 'b', source_position: { x: 1, y: 1, z: 0 }, target_position: { x: 2, y: 2, z: 0 }, item_id: 'iron_ore', quantity: 1 } } }} catalog={catalog} planetId="planet-1-1" canControl />);
  expect(screen.getByLabelText('过滤模式')).toHaveValue('deny');
  rerender(<SorterControls building={{ ...building, sorter: { ...building.sorter!, filter: { mode: 'allow', items: [] } } }} catalog={catalog} planetId="planet-1-1" canControl />);
  expect(screen.getByLabelText('过滤模式')).toHaveValue('allow');
});

it('disables foreign controls and guards edits while submitting', async () => {
  const view = show(building, false);
  expect(screen.getByLabelText('过滤模式')).toBeDisabled();
  view.rerender(<SorterControls building={building} catalog={catalog} planetId="planet-1-1" canControl />);
  let finish!: (response: CommandResponse) => void;
  client.cmdConfigureSorter.mockImplementation(() => new Promise<CommandResponse>(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '应用分拣设置' }));
  expect(screen.getByRole('button', { name: '提交中…' })).toBeDisabled();
  await act(async () => { finish({ request_id: 'pending', accepted: false, enqueue_tick: 0, results: [] }); });
  expect(screen.getByRole('button', { name: '应用分拣设置' })).toBeEnabled();
  expect(client.cmdConfigureSorter).toHaveBeenCalledTimes(1);
});

it('mounts in the real selected building detail panel', () => {
  const planet: PlanetView = { planet_id: 'planet-1-1', surface: { topology: 'cube_sphere', face_size: 8 }, map_width: 24, map_height: 16, discovered: true, tick: 16, buildings: { [building.id]: building } };
  usePlanetViewStore.getState().setSelected({ kind: 'building', id: building.id, position: building.position });
  render(<PlanetEntityPanel planet={planet} catalog={catalog} />);
  expect(screen.getByRole('region', { name: '分拣器设置' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '应用分拣设置' })).toBeEnabled();
});
