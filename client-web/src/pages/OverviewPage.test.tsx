import { screen, within } from '@testing-library/react';
import { vi } from 'vitest';

import { renderApp, jsonResponse } from '@/test/utils';
import { useSessionStore } from '@/stores/session';

function stubSession() {
  useSessionStore.getState().setSession({
    serverUrl: 'http://localhost:5173',
    playerId: 'p1',
    playerKey: 'key_player_1',
  });
}

function summaryPayload() {
  return {
    tick: 88,
    active_planet_id: 'planet-1-1',
    map_width: 128,
    map_height: 128,
    players: {
      p1: {
        player_id: 'p1',
        is_alive: true,
        resources: { minerals: 240, energy: 140 },
        inventory: {
          iron_ore: 24,
          silicon_ore: 8,
          stone_ore: 3,
        },
        tech: {
          player_id: 'p1',
          current_research: {
            tech_id: 'tech-energy-1',
            state: 'running',
            progress: 40,
            total_cost: 100,
          },
        },
      },
    },
  };
}

function statsPayload() {
  return {
    player_id: 'p1',
    tick: 88,
    production_stats: { total_output: 24, by_building_type: {}, by_item: {}, efficiency: 0.95 },
    energy_stats: { generation: 120, consumption: 90, storage: 100, current_stored: 75, shortage_ticks: 0 },
    logistics_stats: { throughput: 8, avg_distance: 16, avg_travel_time: 10, deliveries: 12 },
    combat_stats: { units_lost: 1, enemies_killed: 5, threat_level: 3, highest_threat: 4 },
  };
}

function galaxyPayload() {
  return {
    galaxy_id: 'galaxy-1',
    name: 'Test Frontier',
    discovered: true,
    width: 1200,
    height: 900,
    systems: [
      { system_id: 'sys-1', name: 'Aster', discovered: true, position: { x: 240, y: 360 }, star: { type: 'G' } },
      { system_id: 'sys-2', name: 'Umber', discovered: false, position: { x: 760, y: 520 }, star: { type: 'M' } },
    ],
  };
}

function systemPayload() {
  return {
    system_id: 'sys-1',
    name: 'Aster',
    discovered: true,
    position: { x: 240, y: 360 },
    star: { type: 'G' },
    planets: [
      { planet_id: 'planet-1-1', name: 'Gaia', discovered: true, kind: 'terrestrial' },
      { planet_id: 'planet-1-2', name: 'Morrow', discovered: true, kind: 'barren' },
      { planet_id: 'planet-1-3', discovered: false, kind: 'gas_giant' },
    ],
  };
}

function eventsPayload(events: unknown[] = []) {
  return { available_from_tick: 1, has_more: false, events };
}

function alertsPayload(alerts: unknown[] = []) {
  return { available_from_tick: 1, has_more: false, alerts };
}

interface StubOptions {
  events?: unknown[];
  alerts?: unknown[];
  galaxyFails?: boolean;
  /** 覆盖 stats.energy_stats（用于开局无电场景）。 */
  energy?: {
    generation: number;
    consumption: number;
    storage: number;
    current_stored: number;
    shortage_ticks: number;
  };
  /** 覆盖 summary.players.p1.tech。 */
  tech?: {
    player_id: string;
    completed_techs?: string[];
    current_research?: {
      tech_id: string;
      state: string;
      progress: number;
      total_cost: number;
      blocked_reason?: string;
    };
  };
}

function stubFetch({
  events = [],
  alerts = [],
  galaxyFails = false,
  energy,
  tech,
}: StubOptions = {}) {
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/state/summary')) {
      const payload = summaryPayload();
      if (tech) {
        payload.players.p1.tech = tech;
      }
      return Promise.resolve(jsonResponse(payload));
    }
    if (url.endsWith('/state/stats')) {
      const payload = statsPayload();
      if (energy) {
        payload.energy_stats = energy;
      }
      return Promise.resolve(jsonResponse(payload));
    }
    if (url.includes('/events/snapshot')) {
      return Promise.resolve(jsonResponse(eventsPayload(events)));
    }
    if (url.includes('/alerts/production/snapshot')) {
      return Promise.resolve(jsonResponse(alertsPayload(alerts)));
    }
    if (url.endsWith('/world/galaxy')) {
      return galaxyFails
        ? Promise.reject(new Error('galaxy unavailable'))
        : Promise.resolve(jsonResponse(galaxyPayload()));
    }
    if (url.endsWith('/world/systems/sys-1')) {
      return Promise.resolve(jsonResponse(systemPayload()));
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  }));
}

const sampleEvents = [
  {
    event_id: 'evt-1',
    tick: 87,
    event_type: 'entity_created',
    visibility_scope: 'p1',
    payload: { entity_id: 'miner-1', type: 'miner' },
  },
];

const sampleAlerts = [
  {
    alert_id: 'alert-1',
    tick: 88,
    player_id: 'p1',
    building_id: 'assembler-1',
    building_type: 'assembling_machine_mk1',
    alert_type: 'power_low',
    severity: 'warning',
    message: '电力不足',
    metrics: {
      throughput: 0,
      backlog: 0,
      idle_ratio: 1,
      efficiency: 0,
      input_shortage: false,
      output_blocked: false,
      power_state: 'low',
    },
    details: {},
  },
];

describe('OverviewPage', () => {
  it('渲染指挥总览四区：态势横幅/星图卡/时间线/资源与行星', async () => {
    stubSession();
    stubFetch({ events: sampleEvents, alerts: sampleAlerts });

    renderApp(['/overview']);

    // 顶部态势横幅
    expect(await screen.findByRole('heading', { name: '全局总览' })).toBeInTheDocument();
    const hero = document.querySelector('.command-hero') as HTMLElement;
    expect(within(hero).getByText('88')).toBeInTheDocument();
    expect(within(hero).getByText('3')).toBeInTheDocument();
    expect(within(hero).getByText('40%')).toBeInTheDocument();

    // 文明6 式"下一步"主行动条：推荐告警 + 跳转当前行星
    const nextAction = within(hero).getByRole('link', { name: /下一步优先处理/ });
    expect(nextAction).toHaveAttribute('href', '/planet/planet-1-1');
    expect(within(nextAction).getByText('电力不足 · 制造台 Mk.I assembler-1')).toBeInTheDocument();

    // 中央时间线前置：告警与事件直接可见（不再折叠）
    const timeline = document.querySelector('.command-timeline') as HTMLElement;
    expect(within(timeline).getByText('实体已创建')).toBeInTheDocument();
    expect(within(timeline).getByText('T87 · 1 tick 前')).toBeInTheDocument();
    expect(within(timeline).getByText('电力不足')).toBeInTheDocument();
    expect(within(timeline).getByText('制造台 Mk.I assembler-1')).toBeInTheDocument();
    expect(within(timeline).getByText('T88 · 本 tick')).toBeInTheDocument();

    // 左栏：mini 星图卡（canvas）+ 快捷入口
    expect(screen.getByRole('link', { name: '打开银河星图' })).toHaveAttribute('href', '/galaxy');
    expect(document.querySelector('.mini-galaxy-map')).not.toBeNull();
    expect(screen.getByText('已探明 1/2 恒星系')).toBeInTheDocument();
    const quickNav = screen.getByRole('navigation', { name: '快捷入口' });
    expect(within(quickNav).getByRole('link', { name: /回放/ })).toHaveAttribute('href', '/replay');
    expect(within(quickNav).getByRole('button', { name: /情报/ })).toBeInTheDocument();

    // 右栏：资源脉搏（矿产/能量/电力/研究）
    const resources = document.querySelector('.command-resources') as HTMLElement;
    expect(within(resources).getByText('240')).toBeInTheDocument();
    expect(within(resources).getByText('铁矿 24 · 石矿 3 · 硅矿 8')).toBeInTheDocument();
    expect(within(resources).getByText('140')).toBeInTheDocument();
    expect(within(resources).getByText('120/90')).toBeInTheDocument();
    expect(within(resources).getByText('供电稳定')).toBeInTheDocument();
    expect(within(resources).getByText('基础能源学 40/100')).toBeInTheDocument();

    // 右栏：行星态势（活跃行星置顶 + 当前徽标）
    const planets = document.querySelector('.command-planets') as HTMLElement;
    expect(await within(planets).findByText('Gaia')).toBeInTheDocument();
    expect(within(planets).getByText('Morrow')).toBeInTheDocument();
    expect(within(planets).getByText('当前')).toBeInTheDocument();
    expect(within(planets).getByRole('link', { name: /Morrow/ })).toHaveAttribute('href', '/planet/planet-1-2');
  });

  it('空态：无告警且有电力产出时，下一步降级为侦察引导', async () => {
    stubSession();
    stubFetch({ events: [], alerts: [] });

    renderApp(['/overview']);

    expect(await screen.findByRole('heading', { name: '全局总览' })).toBeInTheDocument();
    expect(screen.getByText('星海平静，暂无告警与事件')).toBeInTheDocument();

    // 默认 stats 有 generation=120 且 summary 正在研究，故显示研究进度态
    const nextAction = screen.getByRole('link', { name: /下一步优先处理/ });
    expect(nextAction).toHaveAttribute('href', '/planet/planet-1-1');
    expect(within(nextAction).getByText(/研究进行中/)).toBeInTheDocument();
  });

  it('新局无电无告警：下一步引导建造风力涡轮机', async () => {
    stubSession();
    stubFetch({
      events: [],
      alerts: [],
      energy: { generation: 0, consumption: 0, storage: 0, current_stored: 0, shortage_ticks: 0 },
      tech: {
        player_id: 'p1',
        completed_techs: ['dyson_sphere_program'],
      },
    });

    renderApp(['/overview']);

    expect(await screen.findByRole('heading', { name: '全局总览' })).toBeInTheDocument();
    const nextAction = screen.getByRole('link', { name: /下一步优先处理/ });
    expect(nextAction).toHaveAttribute('href', '/planet/planet-1-1?build=wind_turbine');
    expect(within(nextAction).getByText(/风力涡轮机/)).toBeInTheDocument();
  });

  it('星图数据不可用时主面板正常渲染，星图卡与行星列表降级空态', async () => {
    stubSession();
    stubFetch({ events: sampleEvents, alerts: sampleAlerts, galaxyFails: true });

    renderApp(['/overview']);

    expect(await screen.findByRole('heading', { name: '全局总览' })).toBeInTheDocument();
    expect(screen.getByText('星图数据不可用')).toBeInTheDocument();
    expect(screen.getByText('尚未发现行星')).toBeInTheDocument();
    // 主数据区不受影响
    const timeline = document.querySelector('.command-timeline') as HTMLElement;
    expect(within(timeline).getByText('电力不足')).toBeInTheDocument();
  });
});
