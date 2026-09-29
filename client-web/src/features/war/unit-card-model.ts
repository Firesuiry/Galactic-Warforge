/**
 * 单位卡片数据模型（C4）：蓝图 / 世界单位 / 运行时单位 / 战斗小队 → 统一卡片视图。
 *
 * 数据出处纪律（单一出处，禁止硬编码数值表）：
 * - 战斗数值只来自运行时实体（Unit / CombatSquad 的 hp/attack/weapon/shield 等字段）；
 * - 蓝图（含公共蓝图）与世界单位的目录条目目前【不暴露】战斗数值
 *   （WarPublicBlueprintCatalogEntry / WorldUnitCatalogEntry 无 HP/攻击/射程字段），
 *   卡片以 statsSource='catalog' 明示"数值由服务端运行时决定"；
 * - 护甲类别（armor_class）目录未暴露；武器类别仅小队运行时 weapon.type 可得，
 *   其余来源为 undefined，卡片相应降级展示；
 * - 克制关系：服务端系数表未暴露，文案为静态说明并显式标注出处。
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

/** 卡片战斗数值的出处：runtime=实测运行时实体；none=目录未暴露，仅展示静态信息。 */
export type UnitCardStatsSource = 'runtime' | 'none';

export interface UnitCardTechGate {
  techId: string;
  techName: string;
  unlocked: boolean;
}

export interface UnitCardModel {
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
  /** 武器类别（仅小队运行时可得：weapon.type）。 */
  weaponClass?: string;
  /** 护甲类别：catalog 未暴露，恒 undefined（占位字段，服务端暴露后在此接线）。 */
  armorClass?: string;
  techGate?: UnitCardTechGate;
  /** 克制说明（静态文案；精确系数待服务端暴露，文案内已标注）。 */
  countersText: string;
}

export const UNIT_CARD_DOMAIN_LABELS: Record<string, string> = {
  ground: '地面',
  air: '空中',
  orbital: '轨道',
  space: '太空',
};

export function unitCardDomainLabel(domain: string | undefined): string {
  if (!domain) {
    return '未知域';
  }
  return UNIT_CARD_DOMAIN_LABELS[domain] ?? domain;
}

export const UNIT_CARD_RUNTIME_CLASS_LABELS: Record<string, string> = {
  world_unit: '世界单位',
  combat_squad: '战斗小队',
  fleet_unit: '舰队单位',
};

/**
 * 克制说明静态文案（按域）。精确克制系数在服务端结算表内、目录未暴露，
 * 此处只给方向性说明并标注出处；服务端暴露后改为读系数表渲染。
 */
export function unitCardCountersText(domain: string | undefined): string {
  const note = '（精确克制系数表待服务端目录暴露，以上为方向性说明）';
  switch (domain) {
    case 'ground':
      return `地面单位擅长占领与推进，惧怕空中打击与远程火力${note}`;
    case 'air':
      return `空中单位机动压制地面，惧怕防空火力与拦截机${note}`;
    case 'orbital':
      return `轨道单位提供火力支援与封锁，受制于点防与制空权争夺${note}`;
    case 'space':
      return `太空舰队主宰星系机动与封锁，交战胜负由武器谱系与护盾博弈决定${note}`;
    default:
      return `克制关系由服务端系数表结算${note}`;
  }
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

/** 运行时世界单位（worker/soldier/mecha 等 planet.units 实体）→ 卡片。 */
export function unitCardFromRuntimeUnit(
  unit: Unit,
  typeName: string,
): UnitCardModel {
  return {
    title: typeName,
    subtitle: unit.id,
    domain: 'ground',
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
    countersText: unitCardCountersText('ground'),
  };
}

/** 战斗小队（planet_runtime.combat_squads 实体）→ 卡片。 */
export function unitCardFromSquad(
  squad: CombatSquad,
  blueprintName: string | undefined,
  domain: string | undefined,
): UnitCardModel {
  const weapon = squad.weapon;
  return {
    title: blueprintName ?? squad.blueprint_id,
    subtitle: `${squad.id} · 在编 ${squad.count}`,
    domain,
    runtimeClass: 'combat_squad',
    statsSource: 'runtime',
    stats: compactStats([
      { key: 'hp', label: 'HP', value: `${squad.hp}/${squad.max_hp}` },
      stat('attack', '攻击', weapon?.damage),
      stat('range', '射程', weapon?.range),
      stat('cooldown', '冷却', weapon?.fire_rate, ' tick'),
      stat('speed', '速度', squad.move_speed, ' tile/tick'),
      squad.shield
        ? { key: 'shield', label: '护盾', value: `${squad.shield.level}/${squad.shield.max_level}` }
        : null,
    ]),
    weaponClass: weapon?.type,
    countersText: unitCardCountersText(domain),
  };
}

/** 玩家/公共蓝图 → 卡片。目录未暴露蓝图战斗数值，statsSource='none'。 */
export function unitCardFromBlueprint(input: {
  id: string;
  name: string;
  domain: string;
  runtimeClass?: string;
  visibleTechId?: string;
  subtitle?: string;
  catalog?: CatalogView;
  completedTechIds: ReadonlySet<string>;
}): UnitCardModel {
  return {
    title: input.name,
    subtitle: input.subtitle ?? input.id,
    domain: input.domain,
    runtimeClass: input.runtimeClass,
    statsSource: 'none',
    stats: [],
    techGate: techGateOf(input.catalog, input.visibleTechId, input.completedTechIds),
    countersText: unitCardCountersText(input.domain),
  };
}

/** 玩家蓝图详情视图 → 卡片（visible_tech_id 从公共蓝图目录按 id/父蓝图回溯）。 */
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
    subtitle: blueprint.id,
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
    subtitle: `${entry.id} · 公共蓝图`,
    catalog,
    completedTechIds,
  });
}

/** 世界单位目录条目（worker/soldier/mecha）→ 卡片。 */
export function unitCardFromWorldUnit(
  entry: WorldUnitCatalogEntry,
  catalog: CatalogView | undefined,
  completedTechIds: ReadonlySet<string>,
): UnitCardModel {
  return {
    title: entry.name,
    subtitle: `${entry.id} · 世界单位`,
    domain: entry.domain,
    runtimeClass: entry.runtime_class,
    statsSource: 'none',
    stats: [],
    techGate: techGateOf(catalog, entry.visible_tech_id, completedTechIds),
    countersText: unitCardCountersText(entry.domain),
  };
}
