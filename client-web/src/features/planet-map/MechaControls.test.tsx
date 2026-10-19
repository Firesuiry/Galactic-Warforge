import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CatalogView, PlayerState, Unit } from '@shared/types';
import type { MechaView } from '@/features/mecha/model';
import { useSessionStore } from '@/stores/session';
import { MechaControls, craftBlockReason, refuelFullQuantity } from './MechaControls';
import { shouldRefreshPlanet, shouldRefreshSummary } from './model';
import { usePlanetViewStore } from './store';

const { client } = vi.hoisted(() => {
  const response = () => Promise.resolve({ accepted: false, request_id: 'command' });
  return { client: {
    cmdRefuelMecha: vi.fn(response),
    cmdCraftItem: vi.fn(response),
    cmdCancelMechaJob: vi.fn(response),
    cmdConfigureMechaLogistics: vi.fn(response),
    cmdAssignMecha: vi.fn(response),
    fetchEventSnapshot: vi.fn(),
  } };
});
vi.mock('@/hooks/use-api-client', () => ({ useApiClient: () => client }));
const unit: Unit = {
  id: 'u-1', owner_id: 'p1', type: 'executor', position: { x: 3, y: 2, z: 0 },
  hp: 120, max_hp: 120, attack: 20, defense: 8, attack_range: 4, move_range: 14, vision_range: 6,
  mecha: { energy: 40, max_energy: 110, fuel_energy: 0, shield: 8, max_shield: 20,
    attack_energy_cost: 8, move_energy_cost: 1, shield_recharge_delay: 10, last_hit_tick: 5 },
};
const catalog = { items: [
  { id: 'coal', name: '煤', mecha_fuel_energy: 25 },
  { id: 'custom_fuel', name: '测试燃料', mecha_fuel_energy: 37 },
  { id: 'iron_ingot', name: '铁块' }, // 与服务端 items.yaml 一致
] } as CatalogView;
beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.getState().setSession({ serverUrl: 'http://localhost:5173', playerId: 'p1', playerKey: 'key_player_1' });
  // 手搓配方选择存在行星视图 store 里（跨面板卸载保留），逐测试重置避免串场。
  usePlanetViewStore.getState().resetForPlanet('planet-1-1');
});

/** 这台机甲的档案（operator = p1 即「我的」）。背包挂在档案上，不在玩家上。 */
function mechaRecord(overrides: Partial<MechaView> = {}): MechaView {
  return {
    unit_id: 'u-1',
    planet_id: 'planet-1-1',
    operator: 'p1',
    alive: true,
    respawn_at_tick: 0,
    position: { x: 3, y: 2, z: 0 },
    inventory: {},
    inventory_slots_used: 0,
    inventory_slots_total: 40,
    operate_range: 18,
    concurrent_tasks: 2,
    construction_active: 0,
    construction_pending: 0,
    ...overrides,
  };
}

const fuelMecha = mechaRecord({ inventory: { coal: 10, custom_fuel: 1 }, inventory_slots_used: 2 });

it('refuelFullQuantity rounds the gap up and is capped by stock', () => {
  expect(refuelFullQuantity(70, 25, 10)).toBe(3);
  expect(refuelFullQuantity(70, 25, 2)).toBe(2);
  expect(refuelFullQuantity(0, 25, 10)).toBe(0);
});

it('uses server fuel metadata and submits the selected fuel for this mecha', async () => {
  render(<MechaControls unit={unit} catalog={catalog} planetId="planet-1-1" mecha={fuelMecha} />);
  expect(screen.getByRole('meter', { name: '核心能量' })).toHaveAttribute('value', '40');
  expect(screen.queryByRole('option', { name: /铁块/ })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '补满（3 个）' })); });
  await vi.waitFor(() => expect(client.cmdRefuelMecha).toHaveBeenCalledWith('coal', 3, 'planet-1-1'));
  fireEvent.change(screen.getByRole('combobox', { name: '机甲燃料' }), { target: { value: 'custom_fuel' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '补 1 个' })); });
  await vi.waitFor(() => expect(client.cmdRefuelMecha).toHaveBeenCalledWith('custom_fuel', 1, 'planet-1-1'));
});

it('prevents refuel when full or fuel remains and exposes no controls on another player', () => {
  const { rerender } = render(<MechaControls unit={{ ...unit, mecha: { ...unit.mecha!, fuel_energy: 50 } }} catalog={catalog} planetId="planet-1-1" mecha={fuelMecha} />);
  expect(screen.getByRole('button', { name: /^补满/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: '补 1 个' })).toBeDisabled();
  rerender(<MechaControls unit={{ ...unit, mecha: { ...unit.mecha!, energy: 110 } }} catalog={catalog} planetId="planet-1-1" mecha={fuelMecha} />);
  expect(screen.getByRole('button', { name: /^补满/ })).toBeDisabled();
  // 不是自己的机甲（别人玩家）：只读，没有接管按钮。
  rerender(<MechaControls unit={{ ...unit, owner_id: 'p2' }} catalog={catalog} planetId="planet-1-1" />);
  expect(screen.queryByRole('button')).toBeNull();
  // 自己的空闲机甲（没有档案 / operator 为空）：只读信息 + 「接管」。
  rerender(<MechaControls unit={unit} catalog={catalog} planetId="planet-1-1" mecha={mechaRecord({ operator: '' })} />);
  expect(screen.getByRole('button', { name: '接管' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '开始制造' })).toBeNull();
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
const craftMecha = mechaRecord({ inventory: { iron_ingot: 5 }, inventory_slots_used: 1 });

it('shows actual backpack stock, computes batches and submits personal crafting', async () => {
  render(<MechaControls unit={unit} catalog={craftingCatalog} planetId="planet-1-1" mecha={craftMecha} />);
  expect(screen.queryByRole('option', { name: '工厂限定' })).toBeNull();
  fireEvent.change(screen.getByLabelText('制造批数'), { target: { value: '3' } });
  expect(screen.getByText('原料：铁块 3（背包 5）')).toBeInTheDocument();
  expect(screen.getByText('耗时 12 tick · 核心耗能 3（每批 1）')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '开始制造' })); });
  expect(client.cmdCraftItem).toHaveBeenCalledWith('gear', 3, 'planet-1-1');
});

it('blocks locked recipes and insufficient ingredients before submitting', () => {
  render(<MechaControls unit={unit} catalog={craftingCatalog} planetId="planet-1-1" mecha={craftMecha} />);
  fireEvent.change(screen.getByLabelText('制造批数'), { target: { value: '6' } });
  expect(screen.getByRole('button', { name: '开始制造' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('背包原料不足');
  fireEvent.change(screen.getByLabelText('个人制造配方'), { target: { value: 'locked' } });
  expect(screen.getByRole('button', { name: '开始制造' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('需要科技');
  expect(client.cmdCraftItem).not.toHaveBeenCalled();
});

it('shows paused job progress, cancels it and hides all controls on another player', async () => {
  const busy: Unit = { ...unit, mecha: { ...unit.mecha!, job: { kind: 'craft', recipe_id: 'gear', remaining_ticks: 2, ticks_per_batch: 4, remaining_batches: 2, completed_batches: 1, energy_per_batch: 3, state: 'no_energy' } } };
  const { rerender } = render(<MechaControls unit={busy} catalog={craftingCatalog} planetId="planet-1-1" mecha={craftMecha} />);
  expect(screen.getByText('核心能量不足，补能后自动继续。')).toBeInTheDocument();
  // 批量进度：已完成 1 / 总数 3（1 已完成 + 2 剩余）
  expect(screen.getByRole('progressbar', { name: '批量进度' })).toHaveAttribute('value', '1');
  expect(screen.getByText('已完成 1 / 3')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '开始制造' })).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '取消机甲任务' })); });
  expect(client.cmdCancelMechaJob).toHaveBeenCalledWith('planet-1-1');
  rerender(<MechaControls unit={{ ...busy, owner_id: 'p2' }} catalog={craftingCatalog} planetId="planet-1-1" />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
});

it('treats omitted inventory in a fresh mecha snapshot as an empty backpack', () => {
  render(<MechaControls unit={unit} catalog={craftingCatalog} planetId="planet-1-1" mecha={mechaRecord({ inventory: undefined })} />);
  expect(screen.getByText('原料：铁块 1（背包 0）')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('背包原料不足');
  expect(screen.getByRole('status')).toHaveTextContent('缺少：铁块（背包 0 / 需要 1）');
  expect(screen.queryByText('正在读取背包…')).toBeNull();
  expect(screen.getByRole('button', { name: '开始制造' })).toBeDisabled();
});

it('回归（试玩 1013 D）：缺料时保持玩家选中的配方，并在按钮旁说明缺什么', () => {
  // 齿轮只要 1 铁块（背包 5 够），磁铁要 9 铁块（不够）：选中磁铁后必须保持磁铁。
  const shortCatalog = { ...craftingCatalog, recipes: [
    ...(craftingCatalog.recipes ?? []),
    { id: 'smelt_magnet', name: '磁铁', handcraft_allowed: true, inputs: [{ item_id: 'iron_ingot', quantity: 9 }], outputs: [{ item_id: 'magnet', quantity: 1 }], duration: 4, energy_cost: 20 },
  ] } as CatalogView;
  render(<MechaControls unit={unit} catalog={shortCatalog} planetId="planet-1-1" mecha={craftMecha} />);
  const select = screen.getByLabelText('个人制造配方') as HTMLSelectElement;
  expect(select.value).toBe('gear');
  fireEvent.change(select, { target: { value: 'smelt_magnet' } });
  expect(select.value).toBe('smelt_magnet');
  expect(screen.getByRole('button', { name: '开始制造' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('背包原料不足');
  expect(screen.getByRole('status')).toHaveTextContent('缺少：铁块（背包 5 / 需要 9）');
  expect(client.cmdCraftItem).not.toHaveBeenCalled();
});

it('explains the busy job instead of claiming the backpack is short', () => {
  // 背包里原料充足（20 铁块），但机甲正在手搓 30 个铜块：按钮禁用原因必须说「正在忙」。
  const busy: Unit = {
    ...unit,
    mecha: {
      ...unit.mecha!,
      job: { kind: 'craft', recipe_id: 'gear', remaining_ticks: 30, ticks_per_batch: 100, remaining_batches: 15, completed_batches: 14, energy_per_batch: 3, state: 'running' },
    },
  };
  render(<MechaControls unit={busy} catalog={craftingCatalog} planetId="planet-1-1" mecha={mechaRecord({ inventory: { iron_ingot: 20 }, inventory_slots_used: 1 })} />);
  expect(screen.getByRole('button', { name: '开始制造' })).toBeDisabled();
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('机甲正在手搓 齿轮');
  expect(status).toHaveTextContent('已完成 14/29');
  expect(status).toHaveTextContent('剩余约 2 分 23 秒');
  expect(status).toHaveTextContent('取消机甲任务');
  expect(status).not.toHaveTextContent('背包原料不足');
  // 有取消入口
  expect(screen.getByRole('button', { name: '取消机甲任务' })).toBeEnabled();
});

it('craftBlockReason prioritizes the running job over a material shortage', () => {
  const job = { kind: 'craft', recipe_id: 'gear', completed_batches: 14, remaining_batches: 15, remaining_ticks: 30, ticks_per_batch: 100 };
  expect(craftBlockReason({ hasRecipe: true, missingTech: false, missingItems: true, hasPlayer: true, job, jobRecipeName: '铜块', resourceName: '' }))
    .toContain('机甲正在手搓 铜块');
  expect(craftBlockReason({ hasRecipe: true, missingTech: false, missingItems: true, hasPlayer: true, jobRecipeName: '', resourceName: '' }))
    .toBe('背包原料不足，请先采集或取回原料。');
  expect(craftBlockReason({ hasRecipe: true, missingTech: false, missingItems: false, hasPlayer: true, jobRecipeName: '', resourceName: '' }))
    .toBeNull();
});

it('任务名取 job.recipe_id 的显示名，而不是下拉框选中的配方（试玩 1011 F）', () => {
  // 机甲正在手搓磁铁（job.recipe_id = smelt_magnet），玩家把下拉框切到玻璃：
  // 面板必须写「机甲正在手搓 磁铁」，不能写「玻璃」。
  const magnetCatalog = {
    ...craftingCatalog,
    recipes: [
      ...(craftingCatalog.recipes ?? []),
      { id: 'smelt_magnet', name: '磁铁', handcraft_allowed: true, inputs: [{ item_id: 'iron_ingot', quantity: 1 }], outputs: [{ item_id: 'magnet', quantity: 1 }], duration: 4, energy_cost: 20 },
      { id: 'glass', name: '玻璃', handcraft_allowed: true, inputs: [{ item_id: 'iron_ingot', quantity: 1 }], outputs: [{ item_id: 'glass', quantity: 1 }], duration: 4, energy_cost: 20 },
    ],
  } as CatalogView;
  const busy: Unit = {
    ...unit,
    mecha: {
      ...unit.mecha!,
      job: { kind: 'craft', recipe_id: 'smelt_magnet', remaining_ticks: 30, ticks_per_batch: 100, remaining_batches: 15, completed_batches: 14, energy_per_batch: 3, state: 'running' },
    },
  };
  render(<MechaControls unit={busy} catalog={magnetCatalog} planetId="planet-1-1" mecha={mechaRecord({ inventory: { iron_ingot: 20 }, inventory_slots_used: 1 })} />);
  // 下拉框切到玻璃（默认选中第一个可手搓配方 = gear；显式切到 glass）
  fireEvent.change(screen.getByLabelText('个人制造配方'), { target: { value: 'glass' } });
  expect(screen.getByRole('status')).toHaveTextContent('机甲正在手搓 磁铁');
  expect(screen.getByRole('status')).not.toHaveTextContent('机甲正在手搓 玻璃');
  // 任务面板标题同样取 job.recipe_id
  expect(screen.getByLabelText('机甲任务')).toHaveTextContent('制造 磁铁');
});

describe('操作者行（契约 §7.3）', () => {
  it('我的机甲：显示「操作者 我」与全部控件，背包读机甲档案', () => {
    render(<MechaControls unit={unit} catalog={craftingCatalog} planetId="planet-1-1" mecha={craftMecha} />);
    expect(screen.getByLabelText('机甲操作者')).toHaveTextContent('操作者我');
    expect(screen.getByText('原料：铁块 1（背包 5）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始制造' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '接管' })).toBeNull();
  });

  it('空闲机甲：只读 + 「接管」，无手搓/补能控件', () => {
    render(<MechaControls unit={unit} catalog={craftingCatalog} planetId="planet-1-1" mecha={mechaRecord({ operator: '', inventory: { iron_ingot: 2 } })} />);
    expect(screen.getByLabelText('机甲操作者')).toHaveTextContent('空闲机甲');
    expect(screen.getByRole('button', { name: '接管' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始制造' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: '机甲燃料' })).toBeNull();
    expect(screen.queryByLabelText('机甲物流请求')).toBeNull();
  });

  it('别人的机甲：显示操作者与只读背包，隐藏控件；已有绑定时提示旧机甲变空闲', () => {
    render(
      <MechaControls
        boundMecha={mechaRecord({ unit_id: 'u-old' })}
        catalog={craftingCatalog}
        mecha={mechaRecord({ operator: 'builder-a', inventory: { iron_ingot: 3 }, inventory_slots_used: 1 })}
        planetId="planet-1-1"
        unit={unit}
      />,
    );
    expect(screen.getByLabelText('机甲操作者')).toHaveTextContent('builder-a');
    expect(screen.getByLabelText('机甲操作者')).toHaveTextContent('背包 1/40 格');
    expect(screen.getByText('接管后 u-old 变为空闲')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始制造' })).toBeNull();
    expect(screen.queryByRole('button', { name: '补 1 个' })).toBeNull();
  });

  it('接管发 assign_mecha：target.entity_id = 机甲 ID，payload.operator = 自己', async () => {
    render(<MechaControls unit={unit} catalog={craftingCatalog} planetId="planet-1-1" mecha={mechaRecord({ operator: 'builder-a' })} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '接管' })); });
    expect(client.cmdAssignMecha).toHaveBeenCalledWith('u-1', 'p1', 'planet-1-1');
  });
});

it('背包格数读这台机甲的档案（不是玩家）', () => {
  render(<MechaControls unit={unit} catalog={craftingCatalog} planetId="planet-1-1" mecha={mechaRecord({ inventory: { iron_ingot: 5 }, inventory_slots_used: 1 })} />);
  expect(screen.getByText('原料：铁块 1（背包 5）')).toBeInTheDocument();
  // 换一台背包不同的档案（模拟改绑后选中另一台机甲）
  render(<MechaControls unit={{ ...unit, id: 'u-2' }} catalog={craftingCatalog} planetId="planet-1-1" mecha={mechaRecord({ unit_id: 'u-2', inventory: { iron_ingot: 1 }, inventory_slots_used: 1 })} />);
  expect(screen.getByText('原料：铁块 1（背包 1）')).toBeInTheDocument();
});

it('别人玩家的机甲：操作者显示「其他玩家」，不拿 owner_id 冒充（审查 #8）', () => {
  render(<MechaControls unit={{ ...unit, owner_id: 'p2' }} catalog={craftingCatalog} planetId="planet-1-1" />);
  const row = screen.getByLabelText('机甲操作者');
  expect(row).toHaveTextContent('其他玩家');
  expect(row).not.toHaveTextContent('p2');
});

it('接管被服务端拒绝：面板显示拒绝原因，不显示为成功（审查 #3）', async () => {
  client.cmdAssignMecha.mockResolvedValueOnce({
    accepted: false,
    request_id: 'r-reject',
    results: [{ command_index: 0, status: 'rejected', code: 'NOT_OWNER', message: '机甲不属于你' }],
  } as never);
  render(<MechaControls unit={unit} catalog={craftingCatalog} planetId="planet-1-1" mecha={mechaRecord({ operator: 'builder-a' })} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '接管' })); });
  expect(await screen.findByRole('alert')).toHaveTextContent('机甲不属于你');
});
