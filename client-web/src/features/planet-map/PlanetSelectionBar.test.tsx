import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogView } from '@shared/types';

import { defaultMiningQuantity, findNearbyMinableResource, PlanetSelectionBar } from '@/features/planet-map/PlanetSelectionBar';
import type { PlanetRenderView } from '@/features/planet-map/model';
import { resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';
import { useSessionStore } from '@/stores/session';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    cmdMineResource: vi.fn().mockResolvedValue({ accepted: false, request_id: 'r-mine' }),
    cmdUpgrade: vi.fn().mockResolvedValue({ accepted: true, request_id: 'r-up' }),
    cmdDemolish: vi.fn().mockResolvedValue({ accepted: true, request_id: 'r-de' }),
    cmdAutoHaul: vi.fn().mockResolvedValue({ accepted: true, request_id: 'r-auto' }),
    cmdUnitOrder: vi.fn().mockResolvedValue({ accepted: true, request_id: 'r-order' }),
    fetchEventSnapshot: vi.fn().mockResolvedValue({ events: [] }),
  },
}));

vi.mock('@/hooks/use-api-client', () => ({
  useApiClient: () => mockClient,
}));

const catalog: CatalogView = {
  buildings: [
    {
      id: 'tesla_tower',
      name: '特斯拉塔',
      category: 'power',
      footprint: { width: 1, height: 1 },
      build_cost: { items: [] },
      buildable: true,
      icon_key: 'tesla_tower',
      color: '#39e6d0',
    } as never,
  ],
};

function makePlanet(): PlanetRenderView {
  return {
    planet_id: 'planet-1-1',
    discovered: true,
    surface: { topology: 'cube_sphere' as const, face_size: 24 / 3 }, map_width: 24,
    map_height: 16,
    tick: 10,
    terrain: Array.from({ length: 16 }, (_, y) => Array.from({ length: 24 }, (_, x) => x < 8 && y < 8 ? 'buildable' : 'unknown')),
    buildings: {
      'b-1': {
        id: 'b-1',
        type: 'tesla_tower',
        owner_id: 'p1',
        position: { x: 2, y: 2, z: 0 },
        hp: 100,
        max_hp: 100,
        level: 1,
        vision_range: 3,
        runtime: { state: 'running' },
      } as never,
    },
    units: {
      'u-1': {
        id: 'u-1',
        type: 'executor',
        owner_id: 'p1',
        position: { x: 1, y: 1, z: 0 },
        hp: 120,
        max_hp: 120,
        attack: 5,
        defense: 2,
        attack_range: 1,
        move_range: 4,
        vision_range: 5,
        is_moving: false,
      } as never,
    },
    resources: [],
  } as PlanetRenderView;
}

describe('PlanetSelectionBar', () => {
  beforeEach(() => {
    resetPlanetViewStore();
    vi.clearAllMocks();
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
  });

  it('选中建筑：显示升级/拆除并提交命令', async () => {
    const user = userEvent.setup();
    usePlanetViewStore.getState().setSelected({
      kind: 'building',
      id: 'b-1',
      position: { x: 2, y: 2, z: 0 },
    });
    render(<PlanetSelectionBar catalog={catalog} planet={makePlanet()} />);

    expect(screen.getByTestId('planet-selection-bar')).toHaveTextContent('特斯拉塔');

    await user.click(screen.getByRole('button', { name: '升级' }));
    expect(mockClient.cmdUpgrade).toHaveBeenCalledWith('b-1');

    await user.click(screen.getByRole('button', { name: '拆除' }));
    expect(mockClient.cmdDemolish).toHaveBeenCalledWith('b-1');
    // 拆除后清空选中
    expect(usePlanetViewStore.getState().selected).toBeNull();
  });

  it('选中单位：移动/攻击按钮切换交互模式', async () => {
    const user = userEvent.setup();
    usePlanetViewStore.getState().setSelected({
      kind: 'unit',
      id: 'u-1',
      position: { x: 1, y: 1, z: 0 },
    });
    usePlanetViewStore.getState().setSelectedUnits(['u-1']);
    render(<PlanetSelectionBar catalog={catalog} planet={makePlanet()} />);

    await user.click(screen.getByRole('button', { name: '移动' }));
    expect(usePlanetViewStore.getState().interactionMode).toEqual({ kind: 'move' });

    await user.click(screen.getByRole('button', { name: '取消移动' }));
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');

    await user.click(screen.getByRole('button', { name: '攻击' }));
    expect(usePlanetViewStore.getState().interactionMode).toEqual({ kind: 'attack' });
  });

  it('多选单位：显示构成与批量指令入口', async () => {
    const user = userEvent.setup();
    const planet = makePlanet();
    planet.units!['u-2'] = {
      id: 'u-2',
      type: 'soldier',
      owner_id: 'p1',
      position: { x: 2, y: 1, z: 0 },
      hp: 80,
      max_hp: 80,
      attack: 9,
      defense: 3,
      attack_range: 2,
      move_range: 3,
      vision_range: 4,
    } as never;
    usePlanetViewStore.getState().setSelectedUnits(['u-1', 'u-2']);
    render(<PlanetSelectionBar catalog={catalog} planet={planet} />);

    const bar = screen.getByTestId('planet-selection-bar');
    expect(bar).toHaveTextContent('已选 2 个单位');
    expect(bar).toHaveTextContent('士兵×1');

    // 多选批量指令：攻击移动进入 unit_order 模式（执行体被过滤，仅士兵可下令）
    await user.click(screen.getByRole('button', { name: '攻击移动' }));
    expect(usePlanetViewStore.getState().interactionMode).toEqual({ kind: 'unit_order', order: 'attack_move' });
  });

  it('未选中时不渲染', () => {
    const { container } = render(<PlanetSelectionBar catalog={catalog} planet={makePlanet()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('选中带本地存储的建筑：显示库存摘要与容量', () => {
    const planet = makePlanet();
    planet.buildings = {
      'b-mine': {
        id: 'b-mine',
        type: 'mining_machine',
        owner_id: 'p1',
        position: { x: 3, y: 3, z: 0 },
        hp: 100,
        max_hp: 100,
        level: 1,
        vision_range: 3,
        runtime: {
          state: 'running',
          functions: { storage: { capacity: 20 } },
        },
        storage: { inventory: { silicon_ore: 12 } },
      } as never,
    };
    usePlanetViewStore.getState().setSelected({
      kind: 'building',
      id: 'b-mine',
      position: { x: 3, y: 3, z: 0 },
    });
    render(<PlanetSelectionBar catalog={catalog} planet={planet} />);

    const bar = screen.getByTestId('planet-selection-bar');
    expect(bar).toHaveTextContent('采矿机');
    expect(bar).toHaveTextContent('库存 硅矿 12 · 容量 12/20');
  });

  it('选中采集建筑：写明它唯一开采的矿种（第 16 轮契约 §5.1）', () => {
    const planet = makePlanet();
    planet.buildings = {
      'b-mine': {
        id: 'b-mine',
        type: 'mining_machine',
        owner_id: 'p1',
        position: { x: 3, y: 3, z: 0 },
        hp: 100,
        max_hp: 100,
        level: 1,
        vision_range: 3,
        mining_item: 'iron_ore',
        runtime: { state: 'running', functions: { collect: { resource_kind: 'iron_ore', yield_per_tick: 8 } } },
      } as never,
    };
    usePlanetViewStore.getState().setSelected({
      kind: 'building',
      id: 'b-mine',
      position: { x: 3, y: 3, z: 0 },
    });
    render(<PlanetSelectionBar catalog={catalog} planet={planet} />);

    expect(screen.getByTestId('planet-selection-bar')).toHaveTextContent('开采 铁矿');
  });

  it('非采集建筑不显示「开采」字样', () => {
    usePlanetViewStore.getState().setSelected({
      kind: 'building',
      id: 'b-1',
      position: { x: 2, y: 2, z: 0 },
    });
    render(<PlanetSelectionBar catalog={catalog} planet={makePlanet()} />);

    expect(screen.getByTestId('planet-selection-bar')).not.toHaveTextContent('开采');
  });

  it('己方建筑提供"详情"入口并回调 onShowDetail', async () => {
    const user = userEvent.setup();
    const onShowDetail = vi.fn();
    usePlanetViewStore.getState().setSelected({
      kind: 'building',
      id: 'b-1',
      position: { x: 2, y: 2, z: 0 },
    });
    render(<PlanetSelectionBar catalog={catalog} onShowDetail={onShowDetail} planet={makePlanet()} />);

    await user.click(screen.getByRole('button', { name: '详情' }));
    expect(onShowDetail).toHaveBeenCalledTimes(1);
  });

  it('单位选中时保留"详情"入口（抽屉盖住选择条时的备用通道）', async () => {
    const user = userEvent.setup();
    const onShowDetail = vi.fn();
    usePlanetViewStore.getState().setSelected({
      kind: 'unit',
      id: 'u-1',
      position: { x: 1, y: 1, z: 0 },
    });
    usePlanetViewStore.getState().setSelectedUnits(['u-1']);
    render(<PlanetSelectionBar catalog={catalog} onShowDetail={onShowDetail} planet={makePlanet()} />);

    await user.click(screen.getByRole('button', { name: '详情' }));
    expect(onShowDetail).toHaveBeenCalledTimes(1);
  });
});

describe('运输机器人选中条（§2.1 全局自动模式）', () => {
  beforeEach(() => {
    resetPlanetViewStore();
    vi.clearAllMocks();
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
  });

  function autoPlanet(mode: 'auto' | 'route' | 'idle' = 'auto', task = true): PlanetRenderView {
    const planet = makePlanet();
    planet.units!['robot-1'] = {
      id: 'robot-1',
      type: 'transport_robot',
      owner_id: 'p1',
      position: { x: 3, y: 3, z: 0 },
      hp: 60,
      max_hp: 60,
      attack: 0,
      defense: 0,
      attack_range: 0,
      move_range: 0,
      vision_range: 4,
      haul: {
        mode,
        from_building_id: task ? 'b-1' : '',
        to_building_id: task ? 'b-1' : '',
        item_id: 'iron_ore',
        phase: mode === 'idle' ? '' : task ? 'to_source' : 'idle',
        delivered_total: 0,
      },
    } as never;
    usePlanetViewStore.getState().setSelected({ kind: 'unit', id: 'robot-1', position: { x: 3, y: 3, z: 0 } });
    usePlanetViewStore.getState().setSelectedUnits(['robot-1']);
    return planet;
  }

  it('auto 模式下「自动搬运」高亮，点「设置运输」进入 haul 模式，点「停止」进入待命', async () => {
    const user = userEvent.setup();
    render(<PlanetSelectionBar catalog={catalog} planet={autoPlanet('auto', false)} />);

    const bar = screen.getByTestId('planet-selection-bar');
    expect(bar).toHaveTextContent('自动待命');
    const autoButton = screen.getByRole('button', { name: '自动搬运' });
    expect(autoButton.className).toContain('planet-selection-bar__active');

    await user.click(screen.getByRole('button', { name: '设置运输' }));
    expect(usePlanetViewStore.getState().interactionMode).toEqual({ kind: 'haul' });

    await user.click(screen.getByRole('button', { name: '停止' }));
    expect(mockClient.cmdUnitOrder).toHaveBeenCalledWith('robot-1', 'stop');

    await user.click(autoButton);
    expect(mockClient.cmdAutoHaul).toHaveBeenCalledWith('robot-1');
  });

  it('自动模式有任务时显示「自动：送 铁矿 → 特斯拉塔」', () => {
    render(<PlanetSelectionBar catalog={catalog} planet={autoPlanet('auto', true)} />);
    const bar = screen.getByTestId('planet-selection-bar');
    // b-1 在 catalog 里是特斯拉塔（测试目录只登记了这一条建筑）。
    expect(bar).toHaveTextContent('自动：送 铁矿 → 特斯拉塔');
  });

  it('idle 模式显示已停止且「自动搬运」不高亮', () => {
    render(<PlanetSelectionBar catalog={catalog} planet={autoPlanet('idle', false)} />);
    expect(screen.getByTestId('planet-selection-bar')).toHaveTextContent('已停止（点「自动搬运」恢复）');
    expect(screen.getByRole('button', { name: '自动搬运' }).className).not.toContain('planet-selection-bar__active');
  });

  it('多选机器人：自动搬运 / 设置运输 / 停止三个按钮，自动搬运一次带全部 entity_ids', async () => {
    const user = userEvent.setup();
    const planet = autoPlanet('auto', false);
    planet.units!['robot-2'] = { ...planet.units!['robot-1'], id: 'robot-2' } as never;
    usePlanetViewStore.getState().setSelectedUnits(['robot-1', 'robot-2']);
    render(<PlanetSelectionBar catalog={catalog} planet={planet} />);

    await user.click(screen.getByRole('button', { name: '自动搬运 ✓' }));
    expect(mockClient.cmdAutoHaul).toHaveBeenCalledWith(['robot-1', 'robot-2']);
  });

  it('有 haul_unreachable 告警时选中条写明「运输机器人到不了目标」+ 目标建筑', () => {
    const planet = autoPlanet('auto', true);
    render(
      <PlanetSelectionBar
        alerts={[{
          alert_id: 'a-haul',
          tick: 700,
          player_id: 'p1',
          building_id: 'robot-1',
          building_type: 'transport_robot',
          alert_type: 'haul_unreachable',
          severity: 'warning',
          message: 'unit robot-1 cannot reach b-1',
          metrics: {} as never,
          details: { unit_id: 'robot-1', building_id: 'b-1', position: { x: 2, y: 2, z: 0 } },
        }]}
        catalog={catalog}
        planet={planet}
      />,
    );
    const warning = screen.getByTestId('haul-unreachable');
    expect(warning).toHaveTextContent('运输机器人到不了目标');
    expect(warning).toHaveTextContent('机器人 robot-1 → 特斯拉塔 (2, 2)');
  });

  it('别的机器人的告警 / 已解除的告警不在选中条上显示', () => {
    const planet = autoPlanet('auto', true);
    const base = {
      tick: 700,
      player_id: 'p1',
      building_type: 'transport_robot',
      alert_type: 'haul_unreachable',
      severity: 'warning',
      message: 'x',
      metrics: {} as never,
      details: { building_id: 'b-1', position: { x: 2, y: 2, z: 0 } },
    };
    const { rerender } = render(
      <PlanetSelectionBar
        alerts={[{ ...base, alert_id: 'a-1', building_id: 'robot-9', details: { ...base.details, unit_id: 'robot-9' } }]}
        catalog={catalog}
        planet={planet}
      />,
    );
    expect(screen.queryByTestId('haul-unreachable')).toBeNull();
    rerender(
      <PlanetSelectionBar
        alerts={[{ ...base, alert_id: 'a-2', building_id: 'robot-1', active: false, details: { ...base.details, unit_id: 'robot-1' } }]}
        catalog={catalog}
        planet={planet}
      />,
    );
    expect(screen.queryByTestId('haul-unreachable')).toBeNull();
  });
});

function miningPlanet(): PlanetRenderView {
  const planet = makePlanet();
  planet.units!['u-1'].mecha = { energy: 50, max_energy: 100, fuel_energy: 0, shield: 0, max_shield: 0, attack_energy_cost: 8, move_energy_cost: 1, shield_recharge_delay: 10, last_hit_tick: 0 };
  planet.resources = [{ id: 'ore-1', planet_id: 'planet-1-1', kind: 'iron_ore', behavior: 'finite', position: { x: 2, y: 1, z: 0 }, remaining: 20 }];
  useSessionStore.getState().setSession({ serverUrl: 'http://localhost:5173', playerId: 'p1', playerKey: 'key_player_1' });
  usePlanetViewStore.getState().setSelected({ kind: 'resource', id: 'ore-1', position: { x: 2, y: 1, z: 0 } });
  return planet;
}
const miningCatalog = { items: [{ id: 'iron_ore', name: '铁矿', form: 'solid' }, { id: 'crude_oil', name: '原油', form: 'liquid' }] } as CatalogView;

it('collects selected solid resource using own nearby mecha and chosen quantity', async () => {
  vi.clearAllMocks();
  const user = userEvent.setup();
  render(<PlanetSelectionBar catalog={miningCatalog} planet={miningPlanet()} />);
  const quantity = screen.getByLabelText('采集数量');
  await user.clear(quantity);
  await user.type(quantity, '3');
  await user.click(screen.getByRole('button', { name: '手动采集' }));
  expect(mockClient.cmdMineResource).toHaveBeenCalledWith('u-1', 'ore-1', 3);
});

it('blocks distant or busy mecha and offers no mining control for another player or fluids', () => {
  const planet = miningPlanet();
  planet.units!['u-1'].position = { x: 6, y: 6, z: 0 };
  const { rerender } = render(<PlanetSelectionBar catalog={miningCatalog} planet={planet} />);
  expect(screen.getByRole('button', { name: '手动采集' })).toBeDisabled();
  expect(screen.getByText('请将机甲移动到矿点 6 格内')).toBeInTheDocument();
  planet.units!['u-1'].position = { x: 1, y: 1, z: 0 };
  planet.units!['u-1'].mecha!.job = { kind: 'mine', resource_id: 'ore-1', remaining_ticks: 5, ticks_per_batch: 10, remaining_batches: 1, completed_batches: 0, energy_per_batch: 3, state: 'running' };
  rerender(<PlanetSelectionBar catalog={miningCatalog} planet={planet} />);
  expect(screen.getByRole('button', { name: '手动采集' })).toBeDisabled();
  planet.units!['u-1'].owner_id = 'p2';
  rerender(<PlanetSelectionBar catalog={miningCatalog} planet={planet} />);
  expect(screen.queryByRole('button', { name: '手动采集' })).toBeNull();
  planet.units!['u-1'].owner_id = 'p1';
  planet.resources![0].kind = 'crude_oil';
  rerender(<PlanetSelectionBar catalog={miningCatalog} planet={planet} />);
  expect(screen.queryByRole('button', { name: '手动采集' })).toBeNull();
});

// 回归（试玩 1015）：前端判定半径曾写死 2 格，而服务端 execMineResource 已放宽到 6 格，
// 导致机甲在 3–6 格处服务端可采、UI 却禁用「手动采集」。
it('allows mining at the server-side 6-cell range boundary and blocks beyond it', () => {
  const planet = miningPlanet();
  planet.resources![0].position = { x: 0, y: 0, z: 0 };
  const { rerender } = render(<PlanetSelectionBar catalog={miningCatalog} planet={planet} />);
  for (const distance of [2, 3, 6]) {
    planet.units!['u-1'].position = { x: distance, y: 0, z: 0 };
    rerender(<PlanetSelectionBar catalog={miningCatalog} planet={planet} />);
    expect(screen.getByRole('button', { name: '手动采集' })).toBeEnabled();
  }
  planet.units!['u-1'].position = { x: 7, y: 0, z: 0 };
  rerender(<PlanetSelectionBar catalog={miningCatalog} planet={planet} />);
  expect(screen.getByRole('button', { name: '手动采集' })).toBeDisabled();
  expect(screen.getByText('请将机甲移动到矿点 6 格内')).toBeInTheDocument();
});

it('findNearbyMinableResource uses the same 6-cell range as the server', () => {
  const planet = miningPlanet();
  planet.resources![0].position = { x: 0, y: 0, z: 0 };
  expect(findNearbyMinableResource(planet, miningCatalog, { x: 6, y: 0, z: 0 })).toBe(planet.resources![0]);
  expect(findNearbyMinableResource(planet, miningCatalog, { x: 7, y: 0, z: 0 })).toBeUndefined();
});

it('uses cube-sphere adjacency to allow mining across a face seam', () => {
  const planet = miningPlanet();
  planet.units!['u-1'].position = { x: 2, y: 0, z: 0 };
  planet.resources![0].position = { x: 10, y: 15, z: 0 };
  render(<PlanetSelectionBar catalog={miningCatalog} planet={planet} />);
  expect(screen.getByRole('button', { name: '手动采集' })).toBeEnabled();
});

describe('defaultMiningQuantity', () => {
  it('按能量可采件数取 1–10 且不超过剩余', () => {
    expect(defaultMiningQuantity(500, 110)).toBe(10);
    expect(defaultMiningQuantity(500, 20)).toBe(6);
    expect(defaultMiningQuantity(2, 110)).toBe(2);
    expect(defaultMiningQuantity(500, 0)).toBe(1);
  });
});
