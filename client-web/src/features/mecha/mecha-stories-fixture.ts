import type { CatalogView, PlayerState, StateSummary, Unit } from '@shared/types';

import type { MechaView } from './model';

/**
 * 视觉夹具（第 21 轮契约 §7.3 第 6 条）：MechaControls 三态 / 总览机甲卡片 / HUD chip
 * 用的固定数据。不起服务端、不登录，Storybook 直接渲染组件。
 *
 * 机甲：u-3（我的）、u-4（agent builder-a 的）、u-5（空闲）；另有 u-6（阵亡，复活于 tick 512）
 * 只出现在总览卡片里，用来核对「复活于 tick N」。
 */

const mechaBase = {
  planet_id: 'planet-1-1',
  alive: true,
  respawn_at_tick: 0,
  inventory_slots_total: 40,
  operate_range: 18,
  concurrent_tasks: 2,
  construction_active: 0,
  construction_pending: 0,
} as const;

export const myMecha: MechaView = {
  ...mechaBase,
  unit_id: 'u-3',
  operator: 'p1',
  position: { x: 40, y: 52, z: 0 },
  inventory: { circuit_board: 2, iron_ingot: 12, gear: 6, coal: 9 },
  inventory_slots_used: 4,
  construction_active: 1,
  construction_pending: 2,
};

export const agentMecha: MechaView = {
  ...mechaBase,
  unit_id: 'u-4',
  operator: 'builder-a',
  position: { x: 47, y: 60, z: 0 },
  inventory: { iron_ingot: 8, magnetic_coil: 4 },
  inventory_slots_used: 2,
};

export const idleMecha: MechaView = {
  ...mechaBase,
  unit_id: 'u-5',
  operator: '',
  position: { x: 36, y: 48, z: 0 },
  inventory: {},
  inventory_slots_used: 0,
};

export const deadMecha: MechaView = {
  ...mechaBase,
  unit_id: 'u-6',
  planet_id: 'planet-1-2',
  operator: 'p1',
  alive: false,
  respawn_at_tick: 512,
  inventory: { gear: 2 },
  inventory_slots_used: 1,
};

export const allMechas: MechaView[] = [myMecha, agentMecha, idleMecha, deadMecha];

/** 侧栏选中的那台机甲单位（scene 里的 Unit，带 mecha 运行时状态）。 */
export function mechaUnit(mecha: MechaView): Unit {
  return {
    id: mecha.unit_id,
    type: 'executor',
    owner_id: 'p1',
    position: mecha.position ?? { x: 40, y: 52, z: 0 },
    hp: mecha.alive ? 120 : 0,
    max_hp: 120,
    attack: 20,
    defense: 8,
    attack_range: 4,
    move_range: 14,
    vision_range: 6,
    mecha: {
      energy: mecha.unit_id === 'u-3' ? 82 : 64,
      max_energy: 110,
      fuel_energy: 0,
      shield: 8,
      max_shield: 20,
      attack_energy_cost: 8,
      move_energy_cost: 1,
      shield_recharge_delay: 10,
      last_hit_tick: 0,
      inventory_slots: mecha.inventory_slots_total,
    },
  };
}

/** 夹具目录：燃料 + 手搓配方 + 物品名（MechaControls 只读这些）。 */
export const storyCatalog: CatalogView = {
  items: [
    { id: 'coal', name: '煤矿', category: 'fuel', form: 'solid', stack_limit: 100, unit_volume: 1, icon_key: 'coal', color: '#495057', mecha_fuel_energy: 25 },
    { id: 'iron_ingot', name: '铁块', category: 'material', form: 'solid', stack_limit: 100, unit_volume: 1, icon_key: 'iron_ingot', color: '#ced4da' },
    { id: 'circuit_board', name: '电路板', category: 'component', form: 'solid', stack_limit: 100, unit_volume: 1, icon_key: 'circuit_board', color: '#12b886' },
    { id: 'gear', name: '齿轮', category: 'component', form: 'solid', stack_limit: 100, unit_volume: 1, icon_key: 'gear', color: '#ffd43b' },
    { id: 'magnetic_coil', name: '磁线圈', category: 'component', form: 'solid', stack_limit: 100, unit_volume: 1, icon_key: 'magnetic_coil', color: '#4dabf7' },
  ],
  recipes: [
    {
      id: 'gear',
      name: '齿轮',
      handcraft_allowed: true,
      inputs: [{ item_id: 'iron_ingot', quantity: 1 }],
      outputs: [{ item_id: 'gear', quantity: 1 }],
      duration: 4,
      energy_cost: 20,
      icon_key: 'gear',
      color: '#ffd43b',
    },
    {
      id: 'magnetic_coil',
      name: '磁线圈',
      handcraft_allowed: true,
      inputs: [{ item_id: 'iron_ingot', quantity: 2 }, { item_id: 'gear', quantity: 1 }],
      outputs: [{ item_id: 'magnetic_coil', quantity: 1 }],
      duration: 6,
      energy_cost: 20,
      icon_key: 'magnetic_coil',
      color: '#4dabf7',
    },
  ],
  techs: [],
};

/** 玩家（只提供科技/研究状态；背包在机甲档案上）。 */
export const storyPlayer: PlayerState = {
  player_id: 'p1',
  is_alive: true,
  resources: { energy: 260 },
  tech: { player_id: 'p1', completed_techs: ['dyson_sphere_program'] },
};

/** summary：总览卡片与 chip 用（4 台机甲，覆盖 我 / agent / 空闲 / 阵亡）。 */
export const storySummary: StateSummary = {
  tick: 128,
  active_planet_id: 'planet-1-1',
  surface: { topology: 'cube_sphere', face_size: 8 },
  map_width: 24,
  map_height: 16,
  players: {
    p1: {
      player_id: 'p1',
      is_alive: true,
      resources: { energy: 260 },
      mechas: allMechas,
      tech: storyPlayer.tech,
    },
  },
};

export const planetNames: Record<string, string> = {
  'planet-1-1': 'Gaia',
  'planet-1-2': 'Morrow',
};
