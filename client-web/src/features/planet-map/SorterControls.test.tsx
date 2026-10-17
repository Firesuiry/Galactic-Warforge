import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
const catalog = {
  items: [
    { id: 'iron_ore', name: '铁矿石', color: '#2f5a92' },
    { id: 'copper_ore', name: '铜矿石', color: '#7a3410' },
    { id: 'iron_ingot', name: '铁块', color: '#e6e8f4' },
  ],
} as CatalogView;
function show(value = building, canControl = true, buildings?: readonly Building[]) {
  return render(<SorterControls building={value} buildings={buildings} catalog={catalog} faceSize={8} planetId="planet-1-1" canControl={canControl} />);
}
/** 候选列表容器（`role=option` 也被 <select> 的 <option> 占用，断言要限定在列表里）。 */
function list() {
  return within(screen.getByLabelText('过滤物品候选'));
}
/** 候选列表里某个物品那一行的按钮。 */
function option(itemId: string) {
  return list().getByRole('option', { name: new RegExp(itemId) });
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
  // 已选项在「已选」区里列出（试玩 1016 U2：不再依赖原生多选下拉的回显）。
  expect(screen.getByTestId('sorter-filter-chosen')).toHaveTextContent('铁矿石');
  expect(option('iron_ore')).toHaveAttribute('aria-selected', 'true');
});

it('submits only the filter — direction never enters the payload', async () => {
  show();
  fireEvent.change(screen.getByLabelText('过滤模式'), { target: { value: 'deny' } });
  // 取消已选的铁矿：点「已选」区里的 chip。
  fireEvent.click(screen.getByRole('button', { name: /取消选择 铁矿石/ }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '应用分拣设置' })); });
  expect(client.cmdConfigureSorter).toHaveBeenCalledWith('sorter-1', {
    filter_mode: 'deny', filter_items: [],
  }, 'planet-1-1');
  expect(usePlanetCommandStore.getState().journal[0].commandType).toBe('configure_sorter');
});

it('试玩 1016 U2：搜索框即时筛选候选（中文名 / id），点击行勾选/取消', async () => {
  show();
  // 搜索「铜」只剩铜矿一项，且给出物品 id 便于核对。
  fireEvent.change(screen.getByLabelText('搜索过滤物品'), { target: { value: '铜' } });
  expect(list().getAllByRole('option')).toHaveLength(1);
  expect(option('copper_ore')).toHaveTextContent('铜矿石');
  // 点行即勾选（不需要 Ctrl 多选）。
  fireEvent.click(option('copper_ore'));
  expect(option('copper_ore')).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByTestId('sorter-filter-chosen')).toHaveTextContent('已选 2');
  // 提交里两个物品按目录顺序（iron_ore 在前）。
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '应用分拣设置' })); });
  expect(client.cmdConfigureSorter).toHaveBeenCalledWith('sorter-1', {
    filter_mode: 'allow', filter_items: ['iron_ore', 'copper_ore'],
  }, 'planet-1-1');
});

it('试玩 1016 U2：搜索无命中时给一句提示，而不是空列表', () => {
  show();
  fireEvent.change(screen.getByLabelText('搜索过滤物品'), { target: { value: '不存在' } });
  expect(list().queryAllByRole('option')).toHaveLength(0);
  expect(screen.getByText(/没有匹配的物品/)).toBeInTheDocument();
});

it('试玩 1016 U8：反向/空转分拣器在面板里点名哪一端接不上', () => {
  // 西侧带子朝东（可取货）、东侧没有任何建筑 → 放货端不接收。
  show();
  const endpoints = screen.getByTestId('sorter-endpoints');
  expect(endpoints).toHaveTextContent('取货端');
  expect(endpoints).toHaveTextContent('放货端');
  expect(screen.getByTestId('sorter-endpoint-warning')).toHaveTextContent('这条搬运路线走不通');
});

// 试玩 1016 缺陷 4：problem 文本本身不带「取货端/放货端」前缀（前缀由渲染层
// 按 side 加一次），否则警告句会出现「取货端取货端没有可取的物品」。
it('试玩 1016 缺陷 4：走不通的警告句端点前缀只出现一次', () => {
  show();
  const warning = screen.getByTestId('sorter-endpoint-warning');
  expect(warning).toHaveTextContent('这条搬运路线走不通：取货端没有可取的物品（前方没有建筑/传送带）；放货端不接收');
  expect(warning).not.toHaveTextContent('取货端取货端');
  expect(warning).not.toHaveTextContent('放货端放货端');
  // 端点逐条的 problem 也不重复前缀（前缀在相邻的 side 列里）。
  const endpointText = screen.getByTestId('sorter-endpoints').textContent ?? '';
  expect(endpointText).not.toContain('取货端取货端');
  expect(endpointText).not.toContain('放货端放货端');
});

it('试玩 1016 缺陷 4：传送带方向不接收时也不重复「放货端」前缀', () => {
  // 放货端在东侧 (3,2)；带子 input 受限为南（只收南侧插入）→ 分拣器从西侧放货被拒。
  show(undefined, true, [
    building,
    { ...building, id: 'belt-w', type: 'conveyor_belt_mk1', position: { x: 1, y: 2, z: 0 }, sorter: undefined, conveyor: { input: 'auto', output: 'east' } } as unknown as Building,
    { ...building, id: 'belt-e', type: 'conveyor_belt_mk1', position: { x: 3, y: 2, z: 0 }, sorter: undefined, conveyor: { input: 'south', output: 'east' } } as unknown as Building,
  ]);
  const warning = screen.getByTestId('sorter-endpoint-warning');
  expect(warning).toHaveTextContent('放货端传送带不接收这个方向');
  expect(warning).not.toHaveTextContent('放货端的传送带');
  expect(warning).not.toHaveTextContent('放货端放货端');
});

it('试玩 1016 U8：两端都接上时不给告警', () => {
  show(building, true, [
    building,
    { ...building, id: 'belt-w', type: 'conveyor_belt_mk1', position: { x: 1, y: 2, z: 0 }, sorter: undefined, conveyor: { input: 'auto', output: 'east' } } as unknown as Building,
    { ...building, id: 'smelter-e', type: 'arc_smelter', position: { x: 3, y: 2, z: 0 }, sorter: undefined, runtime: { params: { energy_consume: 0, energy_generate: 0, capacity: 0, footprint: { width: 1, height: 1 }, io_ports: [{ id: 'in', direction: 'input', offset: { x: 0, y: 0 }, capacity: 4 }] }, state: 'running' } } as unknown as Building,
  ]);
  expect(screen.queryByTestId('sorter-endpoint-warning')).toBeNull();
  expect(screen.getByTestId('sorter-endpoints')).toHaveTextContent('已接上');
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
