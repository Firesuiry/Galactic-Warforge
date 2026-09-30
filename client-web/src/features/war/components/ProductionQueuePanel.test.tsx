import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Building,
  CatalogView,
  WarBlueprintDetailView,
  WarIndustryView,
} from '@shared/types';

import {
  buildBlueprintPicks,
  groupProductionLines,
  isSquadBlueprint,
  orderProgress,
  ProductionQueuePanel,
} from '@/features/war/components/ProductionQueuePanel';
import { useSessionStore } from '@/stores/session';

const catalog: CatalogView = {
  techs: [
    {
      id: 'mil-ground-1',
      name: '地面军事 I',
      category: 'military',
      type: 'unlock',
      level: 1,
      icon_key: 'lab',
      color: '#fff',
    },
  ],
  buildings: [
    {
      id: 'command_center',
      name: '指挥中心',
      category: 'production',
      subcategory: 'core',
      footprint: { width: 3, height: 3 },
      build_cost: { minerals: 0, energy: 0 },
      buildable: true,
      can_produce_units: true,
      icon_key: 'command_center',
      color: '#fff',
    },
  ],
  world_units: [
    {
      id: 'soldier',
      name: 'Soldier',
      domain: 'ground',
      runtime_class: 'world_unit',
      public: true,
      production_mode: 'world_produce',
      cost: [{ item_id: 'steel', quantity: 2 }],
      production_ticks: 30,
    },
  ],
  warfare: {
    public_blueprints: [
      {
        id: 'bp-razor',
        name: '剃刀突击机甲',
        domain: 'ground',
        source: 'preset',
        runtime_class: 'combat_squad',
        production_mode: 'factory_recipe',
        visible_tech_id: 'mil-ground-1',
        deploy_command: 'deploy_squad',
      },
      {
        id: 'bp-frigate',
        name: '护卫舰队',
        domain: 'space',
        source: 'preset',
        runtime_class: 'fleet_unit',
        production_mode: 'factory_recipe',
        deploy_command: 'commission_fleet',
      },
    ],
  },
};

const playerBlueprint: WarBlueprintDetailView = {
  id: 'bp-mine',
  name: '自制突击型',
  source: 'variant',
  state: 'adopted',
  domain: 'ground',
  validation: { valid: true },
};

const draftBlueprint: WarBlueprintDetailView = {
  id: 'bp-draft',
  name: '未定型草案',
  source: 'custom',
  state: 'draft',
  domain: 'ground',
  validation: { valid: false },
};

function factoryBuilding(id: string): Building {
  return {
    id,
    type: 'war_factory',
    owner_id: 'p1',
    position: { x: 1, y: 1, z: 0 },
    hp: 100,
    max_hp: 100,
    level: 1,
    vision_range: 10,
    runtime: { params: {}, state: 'running', functions: { production: {} } },
  } as unknown as Building;
}

function producerBuilding(id: string): Building {
  return {
    id,
    type: 'command_center',
    owner_id: 'p1',
    position: { x: 2, y: 2, z: 0 },
    hp: 100,
    max_hp: 100,
    level: 1,
    vision_range: 10,
    runtime: { params: {}, state: 'running' },
  } as unknown as Building;
}

const industry: WarIndustryView = {
  production_orders: [
    {
      id: 'ord-2',
      factory_building_id: 'fac-1',
      deployment_hub_id: 'hub-1',
      blueprint_id: 'bp-razor',
      domain: 'ground',
      count: 4,
      completed_count: 1,
      status: 'queued',
      stage: 'components',
      queue_index: 1,
    },
    {
      id: 'ord-1',
      factory_building_id: 'fac-1',
      deployment_hub_id: 'hub-1',
      blueprint_id: 'bp-razor',
      domain: 'ground',
      count: 2,
      completed_count: 1,
      status: 'in_progress',
      stage: 'assembly',
      stage_remaining_ticks: 30,
      stage_total_ticks: 100,
      repeat_bonus_percent: 12,
      queue_index: 0,
    },
  ],
  refit_orders: [],
  deployment_hubs: [
    {
      building_id: 'hub-1',
      building_type: 'deployment_hub',
      planet_id: 'planet-1',
      capacity: 6,
      ready_payloads: { 'bp-razor': 2, 'bp-frigate': 1 },
    },
  ],
  supply_nodes: [],
};

describe('production queue model helpers', () => {
  it('groupProductionLines 按工厂分组并按 queue_index 排序', () => {
    const lines = groupProductionLines(industry.production_orders);
    expect(lines).toHaveLength(1);
    expect(lines[0].factoryId).toBe('fac-1');
    expect(lines[0].orders.map((order) => order.id)).toEqual(['ord-1', 'ord-2']);
  });

  it('orderProgress 用 stage tick 换算进度', () => {
    expect(orderProgress(industry.production_orders[1])).toBeCloseTo(0.7);
    expect(orderProgress(industry.production_orders[0])).toBeNull();
  });

  it('isSquadBlueprint 与 deploy 命令分发一致（ground/air=小队，其余=舰队）', () => {
    expect(isSquadBlueprint('ground')).toBe(true);
    expect(isSquadBlueprint('air')).toBe(true);
    expect(isSquadBlueprint('space')).toBe(false);
    expect(isSquadBlueprint('space', 'fleet_unit')).toBe(false);
    expect(isSquadBlueprint('ground', 'combat_squad')).toBe(true);
  });

  it('buildBlueprintPicks：科技未解锁/未定型置灰，公共蓝图去重', () => {
    const picks = buildBlueprintPicks({
      blueprints: [playerBlueprint, draftBlueprint],
      publicBlueprints: catalog.warfare?.public_blueprints ?? [],
      catalog,
      completedTechIds: new Set<string>(),
    });
    const byId = new Map(picks.map((pick) => [pick.id, pick]));
    expect(byId.get('bp-razor')?.locked).toBe(true);
    expect(byId.get('bp-razor')?.techName).toBe('地面军事 I');
    expect(byId.get('bp-frigate')?.locked).toBe(false);
    expect(byId.get('bp-mine')?.producible).toBe(true);
    expect(byId.get('bp-draft')?.producible).toBe(false);

    const unlocked = buildBlueprintPicks({
      blueprints: [],
      publicBlueprints: catalog.warfare?.public_blueprints ?? [],
      catalog,
      completedTechIds: new Set(['mil-ground-1']),
    });
    expect(unlocked.find((pick) => pick.id === 'bp-razor')?.locked).toBe(false);
  });
});

describe('ProductionQueuePanel', () => {
  beforeEach(() => {
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:9999',
      playerId: 'p1',
      playerKey: 'key',
    });
    // 命令提交走真实 api client → fetch 打桩（只关心命令类型序列）。
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/commands')) {
        return Promise.resolve(new Response(
          JSON.stringify({ request_id: 'r', accepted: true, results: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    }));
    return () => vi.unstubAllGlobals();
  });

  function renderPanel(overrides: Partial<Parameters<typeof ProductionQueuePanel>[0]> = {}) {
    const runCommand = vi.fn();
    render(
      <ProductionQueuePanel
        scope={{ serverUrl: 'http://localhost:9999', playerId: 'p1' }}
        runCommand={runCommand}
        isPending={false}
        catalog={catalog}
        industry={industry}
        blueprints={[playerBlueprint]}
        factoryBuildings={[factoryBuilding('fac-1')]}
        ownBuildings={[factoryBuilding('fac-1'), producerBuilding('cc-1')]}
        completedTechIds={[]}
        focusSystemId="sys-1"
        activePlanetId="planet-1"
        {...overrides}
      />,
    );
    return { runCommand };
  }

  it('渲染生产线（进度/重复加成）与枢纽 ready payloads', () => {
    renderPanel();
    expect(screen.getByTestId('production-queue-panel')).toBeInTheDocument();
    expect(screen.getByTestId('production-line')).toBeInTheDocument();
    expect(screen.getByText('重复加成 12%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '70');

    const hub = screen.getByTestId('deployment-hub');
    expect(hub).toHaveTextContent('容量 6');
    expect(hub).toHaveTextContent('可部署 2');
  });

  it('科技未解锁的蓝图卡片置灰并显示门槛', () => {
    renderPanel();
    const locked = screen.getByRole('option', { name: /剃刀突击机甲/ });
    expect(locked).toBeDisabled();
    expect(locked).toHaveTextContent('需要科技：地面军事 I');
  });

  it('选中蓝图卡片 → 显示单位卡片 → 下达量产', async () => {
    const user = userEvent.setup();
    const { runCommand } = renderPanel();
    await user.click(screen.getByRole('option', { name: /自制突击型/ }));
    expect(screen.getByTestId('unit-card')).toHaveTextContent('自制突击型');
    await user.click(screen.getByRole('button', { name: '下达量产' }));
    expect(runCommand).toHaveBeenCalledTimes(1);
    const input = runCommand.mock.calls[0][0];
    expect(input.section).toBe('industry');
    const response = await input.execute();
    expect(response).toBeDefined();
  });

  it('枢纽 ready payload 一键部署：小队蓝图走 deploy_squad，舰队蓝图走 commission_fleet', async () => {
    const user = userEvent.setup();
    const { runCommand } = renderPanel();
    const deployButtons = screen.getAllByRole('button', { name: /部署小队|编成舰队/ });
    expect(deployButtons).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: '部署小队' }));
    await user.click(screen.getByRole('button', { name: '编成舰队' }));
    expect(runCommand).toHaveBeenCalledTimes(2);
    // 两条命令的 execute 都打到 /commands（deploy_squad / commission_fleet）
    const first = await runCommand.mock.calls[0][0].execute();
    const second = await runCommand.mock.calls[1][0].execute();
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
  });

  it('世界单位生产：选中后显示物品造价与生产时间', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('option', { name: /Soldier/ }));
    expect(screen.getByTestId('world-unit-cost')).toHaveTextContent(/× 2.*30 tick/);
  });

  it('世界单位生产：选中单位卡片 + 生产建筑 → produce', async () => {
    const user = userEvent.setup();
    const { runCommand } = renderPanel();
    await user.click(screen.getByRole('option', { name: /Soldier/ }));
    await user.click(screen.getByRole('button', { name: '生产单位' }));
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
});
