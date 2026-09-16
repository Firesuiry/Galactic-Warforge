import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Building, CatalogView, CommandResponse, PlanetView } from '@shared/types';
import { SplitterControls } from './SplitterControls';
import { PlanetEntityPanel } from './PlanetPanels';
import { usePlanetViewStore } from './store';
import { usePlanetCommandStore } from '@/features/planet-commands/store';
const { client } = vi.hoisted(() => ({ client: { cmdConfigureSplitter: vi.fn(), fetchEventSnapshot: vi.fn() } }));
vi.mock('@/hooks/use-api-client', () => ({ useApiClient: () => client }));
vi.mock('@/hooks/use-session', () => ({ useSessionSnapshot: () => ({ playerId: 'p1', playerKey: 'key', serverUrl: 'http://test.local' }) }));
const building: Building = {
  id: 'splitter-1', type: 'splitter', owner_id: 'p1', position: { x: 2, y: 2, z: 0 }, hp: 100, max_hp: 100, level: 1, vision_range: 4,
  runtime: { params: { energy_consume: 1, energy_generate: 0, capacity: 0, maintenance_cost: { minerals: 0, energy: 0 }, footprint: { width: 1, height: 1 } }, functions: {}, state: 'running' },
  conveyor: { input: 'west', output: 'east', max_stack: 12, buffer: [{ item_id: 'iron_ore', quantity: 3 }, { item_id: 'copper_ore', quantity: 1 }] },
  splitter: { input_directions: ['west'], output_directions: ['north', 'east', 'south'], output_priority: 'east', output_filters: { east: 'iron_ore' }, input_cursor: 0, output_cursor: 1, transferred_items: 24, last_transfer_tick: 16 },
};
const catalog = { items: [{ id: 'iron_ore', name: '铁矿石' }, { id: 'copper_ore', name: '铜矿石' }] } as CatalogView;
function show(value = building, canControl = true) {
  return render(<SplitterControls building={value} catalog={catalog} planetId="planet-1-1" canControl={canControl} />);
}
beforeEach(() => {
  vi.clearAllMocks();
  client.cmdConfigureSplitter.mockResolvedValue({ request_id: 'splitter-config', accepted: false, enqueue_tick: 0, results: [] });
  usePlanetViewStore.getState().resetForPlanet('planet-1-1');
  usePlanetCommandStore.getState().resetForPlanet('planet-1-1');
});
it('shows real roles, filters, buffer and throughput', () => {
  show();
  expect(screen.getByLabelText('西侧端口')).toHaveValue('input');
  expect(screen.getByLabelText('东侧输出过滤')).toHaveValue('iron_ore');
  expect(screen.getByText('4 / 12')).toBeInTheDocument();
  expect(screen.getByText('24')).toBeInTheDocument();
  expect(screen.getByText('tick 16')).toBeInTheDocument();
  expect(screen.getByLabelText('分流器缓存物品')).toHaveTextContent('铁矿石 × 3');
});
it('submits all configuration fields and clears obsolete priority and output filter', async () => {
  show();
  fireEvent.change(screen.getByLabelText('东侧端口'), { target: { value: 'input' } });
  expect(screen.getByLabelText('优先输出')).toHaveValue('');
  expect(screen.queryByLabelText('东侧输出过滤')).toBeNull();
  fireEvent.change(screen.getByLabelText('优先输入'), { target: { value: 'east' } });
  fireEvent.change(screen.getByLabelText('南侧端口'), { target: { value: 'closed' } });
  fireEvent.change(screen.getByLabelText('北侧输出过滤'), { target: { value: 'copper_ore' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '应用分流设置' })); });
  expect(client.cmdConfigureSplitter).toHaveBeenCalledWith('splitter-1', {
    input_directions: ['east', 'west'], output_directions: ['north'], input_priority: 'east', output_priority: '', output_filters: { north: 'copper_ore' },
  });
  expect(usePlanetCommandStore.getState().journal[0].commandType).toBe('configure_splitter');
});
it('blocks missing input or output, including direct form submissions', async () => {
  show();
  fireEvent.change(screen.getByLabelText('西侧端口'), { target: { value: 'output' } });
  expect(screen.getByRole('button', { name: '应用分流设置' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('至少保留一个输入口和一个输出口');
  await act(async () => { fireEvent.submit(screen.getByRole('button', { name: '应用分流设置' }).closest('form')!); });
  expect(client.cmdConfigureSplitter).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '还原当前配置' }));
  for (const side of ['北', '东', '南']) fireEvent.change(screen.getByLabelText(`${side}侧端口`), { target: { value: 'input' } });
  expect(screen.getByRole('button', { name: '应用分流设置' })).toBeDisabled();
});
it('preserves draft on transport ticks but follows authoritative configuration changes', () => {
  const { rerender } = show();
  fireEvent.change(screen.getByLabelText('北侧端口'), { target: { value: 'closed' } });
  rerender(<SplitterControls building={{ ...building, splitter: { ...building.splitter!, transferred_items: 31 } }} catalog={catalog} planetId="planet-1-1" canControl />);
  expect(screen.getByText('31')).toBeInTheDocument();
  expect(screen.getByLabelText('北侧端口')).toHaveValue('closed');
  rerender(<SplitterControls building={{ ...building, splitter: { ...building.splitter!, input_directions: ['south'], output_directions: ['east'], output_priority: '' } }} catalog={catalog} planetId="planet-1-1" canControl />);
  expect(screen.getByLabelText('南侧端口')).toHaveValue('input');
  expect(screen.getByLabelText('西侧端口')).toHaveValue('closed');
});
it('disables foreign controls and guards edits while submitting', async () => {
  const view = show(building, false);
  expect(screen.getByLabelText('东侧端口')).toBeDisabled();
  expect(screen.queryByRole('button', { name: '应用分流设置' })).toBeNull();
  view.rerender(<SplitterControls building={building} catalog={catalog} planetId="planet-1-1" canControl />);
  let finish!: (response: CommandResponse) => void;
  client.cmdConfigureSplitter.mockImplementation(() => new Promise<CommandResponse>(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '应用分流设置' }));
  expect(screen.getByLabelText('西侧端口')).toBeDisabled();
  expect(screen.getByRole('button', { name: '提交中…' })).toBeDisabled();
  await act(async () => { finish({ request_id: 'pending', accepted: false, enqueue_tick: 0, results: [] }); });
  expect(screen.getByRole('button', { name: '应用分流设置' })).toBeEnabled();
  expect(client.cmdConfigureSplitter).toHaveBeenCalledTimes(1);
});
it('mounts in the real selected building detail panel', () => {
  const planet: PlanetView = { planet_id: 'planet-1-1', surface: { topology: 'cube_sphere', face_size: 8 }, map_width: 24, map_height: 16, discovered: true, tick: 16, buildings: { [building.id]: building } };
  usePlanetViewStore.getState().setSelected({ kind: 'building', id: building.id, position: building.position });
  render(<PlanetEntityPanel planet={planet} catalog={catalog} />);
  expect(screen.getByRole('region', { name: '四向分流器设置' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '应用分流设置' })).toBeEnabled();
});
