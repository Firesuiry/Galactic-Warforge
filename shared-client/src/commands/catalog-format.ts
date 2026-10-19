import chalk from 'chalk';

import type {
  BuildingCatalogEntry,
  CatalogView,
  ItemAmount,
  RecipeCatalogEntry,
  TechCatalogEntry,
  WorldUnitCatalogEntry,
} from '../types.js';
import { table } from './format.js';

/** `iron_ingot×2, gear×1`：造价/配方/科技成本共用的紧凑写法。 */
export function fmtAmounts(items: ItemAmount[] | undefined): string {
  if (!items || items.length === 0) {
    return '-';
  }
  return items.map((item) => `${item.item_id}×${item.quantity}`).join(', ');
}

export function fmtTechList(techs: string[] | undefined): string {
  return techs && techs.length > 0 ? techs.join(',') : '-';
}

/** 关键词匹配 id 或中文名（大小写不敏感）；空关键词全匹配。 */
export function matchesKeyword(keyword: string | undefined, ...fields: string[]): boolean {
  if (!keyword) {
    return true;
  }
  const needle = keyword.toLowerCase();
  return fields.some((field) => field.toLowerCase().includes(needle));
}

/** `unlock_tech` 是「任一完成即可」：空 = 无门槛；否则看与已完成科技是否相交。 */
export function isUnlocked(unlockTech: string[] | undefined, completed: ReadonlySet<string>): boolean {
  if (!unlockTech || unlockTech.length === 0) {
    return true;
  }
  return unlockTech.some((tech) => completed.has(tech));
}

export interface CatalogBuildingsOptions {
  keyword?: string;
  completed: ReadonlySet<string>;
}

export function fmtCatalogBuildings(catalog: CatalogView, options: CatalogBuildingsOptions): string {
  const rows = (catalog.buildings ?? []).filter((entry) =>
    matchesKeyword(options.keyword, entry.id, entry.name),
  );
  if (rows.length === 0) {
    return chalk.dim(`没有匹配的建筑${options.keyword ? `：${options.keyword}` : ''}`);
  }
  const lines = [
    `${chalk.bold('Buildings')} (${rows.length}/${catalog.buildings?.length ?? 0})`,
    table(
      ['id', 'name', 'size', 'cost', 'unlock_tech', 'unlocked'],
      rows.map((entry) => [
        entry.id,
        entry.name,
        `${entry.footprint.width}x${entry.footprint.height}`,
        fmtAmounts(entry.build_cost?.items),
        fmtTechList(entry.unlock_tech),
        isUnlocked(entry.unlock_tech, options.completed) ? 'yes' : 'no',
      ]),
      (col, value) => (col === 5 ? (value.trim() === 'yes' ? chalk.green(value) : chalk.red(value)) : value),
    ),
  ];
  lines.push(chalk.dim('unlocked = 已完成 unlock_tech 中任意一项（空 unlock_tech 表示无门槛）'));
  return lines.join('\n');
}

function findRecipeUsers(catalog: CatalogView, buildingId: string): RecipeCatalogEntry[] {
  return (catalog.recipes ?? []).filter((recipe) => (recipe.building_types ?? []).includes(buildingId));
}

export function fmtCatalogBuilding(
  catalog: CatalogView,
  buildingId: string,
  completed: ReadonlySet<string>,
): string {
  const entry = (catalog.buildings ?? []).find((building) => building.id === buildingId);
  if (!entry) {
    return chalk.red(`未知建筑：${buildingId}（用 catalog buildings <关键词> 查 id）`);
  }
  const params = entry.runtime_params;
  const lines = [
    `${chalk.bold(entry.id)}  ${entry.name}`,
    `  category    ${entry.category}${entry.subcategory && entry.subcategory !== entry.category ? `/${entry.subcategory}` : ''}`,
    `  size        ${entry.footprint.width}x${entry.footprint.height}`,
    `  cost        ${fmtAmounts(entry.build_cost?.items)}`,
    `  power       consume=${params?.energy_consume ?? 0} generate=${params?.energy_generate ?? 0}`,
  ];
  if (params?.power_priority) {
    lines.push(`  priority    ${params.power_priority}`);
  }
  if (entry.combat_range) {
    lines.push(`  combat      range=${entry.combat_range}`);
  }
  if (entry.power_range) {
    lines.push(`  power_range ${entry.power_range}`);
  }
  if (entry.coverage_radius) {
    lines.push(`  coverage    radius=${entry.coverage_radius}`);
  }
  if (entry.default_recipe_id) {
    lines.push(`  recipe      default=${entry.default_recipe_id}`);
  }
  const ports = params?.io_ports ?? [];
  if (ports.length > 0) {
    lines.push(`  io_ports    ${ports.map((port) => `${port.id}:${port.direction}@(${port.offset.x},${port.offset.y})`).join(' ')}`);
  }
  const connectionPoints = params?.connection_points ?? [];
  if (connectionPoints.length > 0) {
    lines.push(`  connectors  ${connectionPoints.map((point) => `${point.id}:${point.kind ?? '-'}@(${point.offset.x},${point.offset.y})`).join(' ')}`);
  }
  const recipes = findRecipeUsers(catalog, entry.id);
  lines.push(`  recipes     ${recipes.length > 0 ? recipes.map((recipe) => recipe.id).join(',') : '-'}`);
  lines.push(`  unlock_tech ${fmtTechList(entry.unlock_tech)}  (${isUnlocked(entry.unlock_tech, completed) ? 'unlocked' : 'locked'})`);
  if (entry.requires_resource_node) {
    lines.push('  requires    resource_node');
  }
  if (entry.can_produce_units) {
    const units = (catalog.world_units ?? []).filter((unit) => unit.producer === entry.id);
    lines.push(`  produces    ${units.length > 0 ? units.map((unit) => unit.id).join(',') : '-'}`);
  }
  return lines.join('\n');
}

export interface CatalogRecipesOptions {
  keyword?: string;
  handcraftOnly?: boolean;
  building?: string;
  completed: ReadonlySet<string>;
}

export function fmtCatalogRecipes(catalog: CatalogView, options: CatalogRecipesOptions): string {
  const rows = (catalog.recipes ?? []).filter((recipe) => {
    if (options.handcraftOnly && !recipe.handcraft_allowed) {
      return false;
    }
    if (options.building && !(recipe.building_types ?? []).includes(options.building)) {
      return false;
    }
    return matchesKeyword(options.keyword, recipe.id, recipe.name);
  });
  if (rows.length === 0) {
    return chalk.dim(`没有匹配的配方${options.keyword ? `：${options.keyword}` : ''}`);
  }
  const lines = [
    `${chalk.bold('Recipes')} (${rows.length}/${catalog.recipes?.length ?? 0})`,
    table(
      ['id', 'name', 'inputs', 'outputs', 'ticks', 'handcraft', 'tech_unlock'],
      rows.map((recipe) => [
        recipe.id,
        recipe.name,
        fmtAmounts(recipe.inputs),
        fmtAmounts(recipe.outputs),
        String(recipe.duration),
        recipe.handcraft_allowed ? 'yes' : 'no',
        fmtTechList(recipe.tech_unlock),
      ]),
    ),
  ];
  lines.push(chalk.dim('tech_unlock 为空 = 无科技门槛；否则需已完成其中任意一项（建筑配方还要建筑本身已解锁）'));
  return lines.join('\n');
}

export function fmtCatalogItems(catalog: CatalogView, keyword?: string): string {
  const rows = (catalog.items ?? []).filter((item) => matchesKeyword(keyword, item.id, item.name));
  if (rows.length === 0) {
    return chalk.dim(`没有匹配的物品${keyword ? `：${keyword}` : ''}`);
  }
  return [
    `${chalk.bold('Items')} (${rows.length}/${catalog.items?.length ?? 0})`,
    table(
      ['id', 'name', 'form', 'stack_limit', 'fuel'],
      rows.map((item) => [
        item.id,
        item.name,
        item.form,
        String(item.stack_limit),
        item.mecha_fuel_energy ? String(item.mecha_fuel_energy) : '-',
      ]),
    ),
  ].join('\n');
}

export type CatalogTechFilter = 'all' | 'available' | 'done';

/** 前置必须**全部**完成；已完成的科技不再列入 available。 */
export function isTechAvailable(tech: TechCatalogEntry, completed: ReadonlySet<string>): boolean {
  return !completed.has(tech.id) && (tech.prerequisites ?? []).every((techId) => completed.has(techId));
}

export function fmtCatalogTechs(
  catalog: CatalogView,
  filter: CatalogTechFilter,
  completed: ReadonlySet<string>,
): string {
  const techs = catalog.techs ?? [];
  const rows = techs.filter((tech) => {
    if (filter === 'done') {
      return completed.has(tech.id);
    }
    if (filter === 'available') {
      return isTechAvailable(tech, completed);
    }
    return true;
  });
  if (rows.length === 0) {
    return chalk.dim(filter === 'done' ? '还没有已完成科技' : '没有可研究的科技（前置未完成）');
  }
  const label = filter === 'done' ? 'Done' : filter === 'available' ? 'Available' : 'Techs';
  return [
    `${chalk.bold(label)} (${rows.length}/${techs.length})`,
    table(
      ['id', 'name', 'type', 'level', 'cost', 'prerequisites', 'done'],
      rows.map((tech) => [
        tech.id,
        tech.name,
        tech.type,
        String(tech.level ?? 0),
        fmtAmounts(tech.cost),
        fmtTechList(tech.prerequisites),
        completed.has(tech.id) ? 'yes' : 'no',
      ]),
    ),
    chalk.dim('cost 已按本局 research_pace 缩放，可直接用于 start_research 预算'),
  ].join('\n');
}

export function fmtCatalogUnits(catalog: CatalogView): string {
  const units: WorldUnitCatalogEntry[] = catalog.world_units ?? [];
  if (units.length === 0) {
    return chalk.dim('没有可生产单位');
  }
  return [
    `${chalk.bold('World units')} (${units.length})`,
    table(
      ['id', 'name', 'producer', 'cost', 'ticks', 'hp', 'attack'],
      units.map((unit) => [
        unit.id,
        unit.name,
        unit.producer ?? '-',
        fmtAmounts(unit.cost),
        unit.production_ticks !== undefined ? String(unit.production_ticks) : '-',
        unit.max_hp !== undefined ? String(unit.max_hp) : '-',
        unit.attack !== undefined ? String(unit.attack) : '-',
      ]),
    ),
  ].join('\n');
}

export function buildingName(catalog: CatalogView, buildingType: string): string {
  const entry: BuildingCatalogEntry | undefined = (catalog.buildings ?? []).find((b) => b.id === buildingType);
  return entry?.name ?? buildingType;
}
