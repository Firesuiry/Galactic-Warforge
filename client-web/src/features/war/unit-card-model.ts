/**
 * 单位卡片数据模型：蓝图 / 世界单位 / 运行时单位 / 战斗小队 → 统一卡片视图。
 *
 * 战斗数值与克制来自 catalog 或运行时实体，不在卡片内再推导护甲或系数。
 * - runtime：Unit 实测字段（军团卡片汇总成员单位）；缺类别时按 type 补目录
 * - catalog：目录已暴露的 armor/weapon/attack/range/max_hp
 * - none：该来源没有数值
 * 老兵等级不做。
 */

import type {
  CatalogView,
  CombatSquad,
  Unit,
  WarBlueprintDetailView,
  WarPublicBlueprintCatalogEntry,
  WorldUnitCatalogEntry,
} from '@shared/types';

import { getTechDisplayName } from '@/features/planet-map/model';

export type UnitCardStatKey =
  | 'hp'
  | 'attack'
  | 'defense'
  | 'range'
  | 'cooldown'
  | 'speed'
  | 'shield';

export interface UnitCardStat {
  key: UnitCardStatKey;
  label: string;
  value: string;
}

/** runtime=运行时实体；catalog=目录数值；none=该来源无数值。 */
export type UnitCardStatsSource = 'runtime' | 'catalog' | 'none';

export interface UnitCardTechGate {
  techId: string;
  techName: string;
  unlocked: boolean;
}

export interface UnitCardModel {
 ammunition?:{current:number;capacity:number;item?:string};
  /** 卡片标题（蓝图名/单位类型名/小队蓝图名）。 */
  title: string;
  /** 副标题（id / 来源说明）。 */
  subtitle?: string;
  /** 作战域原文（ground/air/orbital/space）。 */
  domain?: string;
  /** 运行时类别（world_unit/combat_squad/fleet_unit）。 */
  runtimeClass?: string;
  stats: UnitCardStat[];
  statsSource: UnitCardStatsSource;
  weaponClass?: string;
  armorClass?: string;
  techGate?: UnitCardTechGate;
  /** 由 catalog.damage_coefficients 生成；无表时为短降级句。 */
  countersText: string;
}

export const UNIT_CARD_DOMAIN_LABELS: Record<string, string> = {
  ground: '地面',
  air: '空中',
  orbital: '轨道',
  space: '太空',
};

const WEAPON_CLASS_LABELS: Record<string, string> = {
  gun: '机枪',
  cannon: '加农',
  missile: '导弹',
  laser: '激光',
};

const ARMOR_CLASS_LABELS: Record<string, string> = {
  light: '轻甲',
  heavy: '重甲',
  structure: '建筑',
  air: '空中',
  ship: '舰船',
};

const ARMOR_CLASS_ORDER = ['light', 'heavy', 'structure', 'air', 'ship'] as const;

const NO_COEFFICIENTS = '克制系数未加载';

export function unitCardDomainLabel(domain: string | undefined): string {
  if (!domain) {
    return '未知域';
  }
  return UNIT_CARD_DOMAIN_LABELS[domain] ?? domain;
}

export function unitCardWeaponLabel(weaponClass: string | undefined): string {
  if (!weaponClass) {
    return '未知';
  }
  return WEAPON_CLASS_LABELS[weaponClass] ?? weaponClass;
}

export function unitCardArmorLabel(armorClass: string | undefined): string {
  if (!armorClass) {
    return '未知';
  }
  return ARMOR_CLASS_LABELS[armorClass] ?? armorClass;
}

export const UNIT_CARD_RUNTIME_CLASS_LABELS: Record<string, string> = {
  world_unit: '世界单位',
  combat_squad: '战斗小队',
  fleet_unit: '舰队单位',
};

/** 系数 > 1 为克制，< 1 为被克制。无系数表时返回短降级句。 */
export function unitCardCountersText(
  weaponClass: string | undefined,
  coefficients: Record<string, Record<string, number>> | undefined,
): string {
  if (!coefficients) {
    return NO_COEFFICIENTS;
  }
  if (!weaponClass) {
    return '武器类别未知';
  }
  const row = coefficients[weaponClass];
  if (!row) {
    return NO_COEFFICIENTS;
  }
  const weapon = WEAPON_CLASS_LABELS[weaponClass] ?? weaponClass;
  const counters: string[] = [];
  const countered: string[] = [];
  for (const armor of ARMOR_CLASS_ORDER) {
    const coef = row[armor];
    if (typeof coef !== 'number' || coef === 1) {
      continue;
    }
    const label = ARMOR_CLASS_LABELS[armor] ?? armor;
    if (coef > 1) {
      counters.push(label);
    } else if (coef < 1) {
      countered.push(label);
    }
  }
  if (counters.length > 0 && countered.length > 0) {
    return `${weapon}克制${counters.join('、')}；被${countered.join('、')}克制`;
  }
  if (counters.length > 0) {
    return `${weapon}克制${counters.join('、')}`;
  }
  if (countered.length > 0) {
    return `${weapon}被${countered.join('、')}克制`;
  }
  return `${weapon}无明显克制`;
}

function techGateOf(
  catalog: CatalogView | undefined,
  visibleTechId: string | undefined,
  completedTechIds: ReadonlySet<string>,
): UnitCardTechGate | undefined {
  if (!visibleTechId) {
    return undefined;
  }
  return {
    techId: visibleTechId,
    techName: getTechDisplayName(catalog, visibleTechId),
    unlocked: completedTechIds.has(visibleTechId),
  };
}

function stat(key: UnitCardStatKey, label: string, value: number | undefined, suffix = ''): UnitCardStat | null {
  if (value === undefined || Number.isNaN(value)) {
    return null;
  }
  return { key, label, value: `${value}${suffix}` };
}

function compactStats(entries: Array<UnitCardStat | null>): UnitCardStat[] {
  return entries.filter((entry): entry is UnitCardStat => Boolean(entry));
}

function firstText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value) {
      return value;
    }
  }
  return undefined;
}

function worldUnitByType(catalog: CatalogView | undefined, type: string | undefined) {
  if (!catalog || !type) {
    return undefined;
  }
  return catalog.world_units?.find((entry) => entry.id === type);
}

function publicBlueprintByID(catalog: CatalogView | undefined, id: string | undefined) {
  if (!catalog || !id) {
    return undefined;
  }
  return catalog.warfare?.public_blueprints?.find((entry) => entry.id === id);
}

/** 运行时世界单位 → 卡片。类别优先用实体字段，缺则按 type 补 world_units。 */
export function unitCardFromRuntimeUnit(
  unit: Unit,
  typeName: string,
  catalog?: CatalogView,
): UnitCardModel {
  const entry = worldUnitByType(catalog, unit.type);
  const weaponClass = firstText(unit.weapon_class, entry?.weapon_class);
  const armorClass = firstText(unit.armor_class, entry?.armor_class);
  return {
    title: typeName,
    // 副标题用实体位置而不是内部 id（u-7 这类裸 id 不上界面）
    subtitle: `(${unit.position.x}, ${unit.position.y})`,
    ammunition:unit.ammo_capacity?{current:unit.ammo??0,capacity:unit.ammo_capacity,item:unit.ammo_item}:undefined,
    domain: entry?.domain ?? 'ground',
    runtimeClass: 'world_unit',
    statsSource: 'runtime',
    stats: compactStats([
      { key: 'hp', label: 'HP', value: `${unit.hp}/${unit.max_hp}` },
      stat('attack', '攻击', unit.attack),
      stat('defense', '防御', unit.defense),
      stat('range', '射程', unit.attack_range),
      stat('cooldown', '冷却', unit.attack_cooldown_ticks, ' tick'),
      stat('speed', '速度', unit.move_speed, ' tile/tick'),
    ]),
    weaponClass,
    armorClass,
    countersText: unitCardCountersText(weaponClass, catalog?.damage_coefficients),
  };
}

/** 军团 → 卡片。军团只是命令容器：HP 汇总自成员单位，类别取首个成员（缺则按 type 补目录）。 */
export function unitCardFromSquad(
  squad: CombatSquad,
  members: readonly Unit[],
  catalog?: CatalogView,
): UnitCardModel {
  const lead = members[0];
  const entry = worldUnitByType(catalog, lead?.type);
  const weaponClass = firstText(lead?.weapon_class, entry?.weapon_class);
  const hp = members.reduce((sum, unit) => sum + unit.hp, 0);
  const maxHp = members.reduce((sum, unit) => sum + unit.max_hp, 0);
  return {
    title: squad.name || '军团',
    subtitle: `在编 ${squad.member_ids?.length ?? 0} 个单位`,
    domain: entry?.domain,
    runtimeClass: 'combat_squad',
    statsSource: members.length > 0 ? 'runtime' : 'none',
    stats: members.length > 0 ? [{ key: 'hp', label: 'HP', value: `${hp}/${maxHp}` }] : [],
    weaponClass,
    armorClass: firstText(lead?.armor_class, entry?.armor_class),
    countersText: unitCardCountersText(weaponClass, catalog?.damage_coefficients),
  };
}

/** 玩家/公共蓝图 → 卡片。数值来自目录条目；没有数值时 statsSource='none'。 */
export function unitCardFromBlueprint(input: {
  id: string;
  name: string;
  domain: string;
  runtimeClass?: string;
  visibleTechId?: string;
  subtitle?: string;
  armorClass?: string;
  weaponClass?: string;
  attack?: number;
  range?: number;
  maxHp?: number;
  catalog?: CatalogView;
  completedTechIds: ReadonlySet<string>;
}): UnitCardModel {
  const stats = compactStats([
    stat('hp', 'HP', input.maxHp),
    stat('attack', '攻击', input.attack),
    stat('range', '射程', input.range),
  ]);
  return {
    title: input.name,
    subtitle: input.subtitle,
    domain: input.domain,
    runtimeClass: input.runtimeClass,
    statsSource: stats.length > 0 ? 'catalog' : 'none',
    stats,
    weaponClass: input.weaponClass,
    armorClass: input.armorClass,
    techGate: techGateOf(input.catalog, input.visibleTechId, input.completedTechIds),
    countersText: unitCardCountersText(input.weaponClass, input.catalog?.damage_coefficients),
  };
}

function combatFieldsOf(entry: WarPublicBlueprintCatalogEntry | undefined) {
  if (!entry) {
    return {};
  }
  return {
    armorClass: entry.armor_class,
    weaponClass: entry.weapon_class,
    attack: entry.attack,
    range: entry.range,
    maxHp: entry.max_hp,
  };
}

/** 玩家蓝图详情视图 → 卡片（visible_tech_id 与战斗字段从公共蓝图按 id/父蓝图回溯）。 */
export function unitCardFromBlueprintDetail(
  blueprint: WarBlueprintDetailView,
  catalog: CatalogView | undefined,
  completedTechIds: ReadonlySet<string>,
): UnitCardModel {
  const publicEntries = catalog?.warfare?.public_blueprints ?? [];
  const publicEntry =
    publicEntries.find((entry) => entry.id === blueprint.id)
    ?? publicEntries.find((entry) => entry.id === blueprint.parent_blueprint_id);
  return unitCardFromBlueprint({
    id: blueprint.id,
    name: blueprint.name,
    domain: blueprint.domain,
    runtimeClass: publicEntry?.runtime_class,
    visibleTechId: publicEntry?.visible_tech_id,
    subtitle: '定型蓝图',
    ...combatFieldsOf(publicEntry),
    catalog,
    completedTechIds,
  });
}

/** 公共蓝图目录条目 → 卡片。 */
export function unitCardFromPublicBlueprint(
  entry: WarPublicBlueprintCatalogEntry,
  catalog: CatalogView | undefined,
  completedTechIds: ReadonlySet<string>,
): UnitCardModel {
  return unitCardFromBlueprint({
    id: entry.id,
    name: entry.name,
    domain: entry.domain,
    runtimeClass: entry.runtime_class,
    visibleTechId: entry.visible_tech_id,
    subtitle: '公共蓝图',
    ...combatFieldsOf(entry),
    catalog,
    completedTechIds,
  });
}

/** 世界单位目录条目 → 卡片。 */
export function unitCardFromWorldUnit(
  entry: WorldUnitCatalogEntry,
  catalog: CatalogView | undefined,
  completedTechIds: ReadonlySet<string>,
): UnitCardModel {
  const stats = compactStats([
    stat('hp', 'HP', entry.max_hp),
    stat('attack', '攻击', entry.attack),
    stat('range', '射程', entry.attack_range),
    stat('cooldown', '冷却', entry.attack_cooldown_tick, ' tick'),
    stat('speed', '速度', entry.move_speed, ' tile/tick'),
  ]);
  return {
    title: entry.name,
    subtitle: '世界单位',
    domain: entry.domain,
    runtimeClass: entry.runtime_class,
    statsSource: stats.length > 0 ? 'catalog' : 'none',
    stats,
    weaponClass: entry.weapon_class,
    armorClass: entry.armor_class,
    techGate: techGateOf(catalog, entry.visible_tech_id, completedTechIds),
    countersText: unitCardCountersText(entry.weapon_class, catalog?.damage_coefficients),
  };
}
