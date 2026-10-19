import chalk from 'chalk';

import type { CatalogView } from '../types.js';
import { fmtError } from './format.js';
import type { CommandContext } from './game-commands.js';
import { getStringOption, hasFlag, parseArgs } from './args.js';
import {
  fmtCatalogBuilding,
  fmtCatalogBuildings,
  fmtCatalogItems,
  fmtCatalogRecipes,
  fmtCatalogTechs,
  fmtCatalogUnits,
  type CatalogTechFilter,
} from './catalog-format.js';

export const CATALOG_USAGE = [
  'catalog buildings [关键词]',
  'catalog building <id>',
  'catalog recipes [--handcraft] [--building <type>] [关键词]',
  'catalog items [关键词]',
  'catalog techs [--available|--done]',
  'catalog units',
].join('\n  ');

/** 已完成科技：summary 里是 `{tech_id: level}` 对象，只关心键。 */
export async function completedTechIds(ctx: CommandContext): Promise<Set<string>> {
  const summary = await ctx.api.fetchSummary();
  const player = summary.players?.[ctx.api.getAuth().playerId];
  return new Set(Object.keys(player?.tech?.completed_techs ?? {}));
}

export async function cmdCatalog(args: string[], ctx: CommandContext): Promise<string> {
  const parsed = parseArgs(args);
  if (hasFlag(parsed, 'help') || parsed.positionals.length === 0) {
    return `${chalk.bold('catalog')} <buildings|building|recipes|items|techs|units>\n  ${CATALOG_USAGE}`;
  }
  const sub = parsed.positionals[0].toLowerCase();
  const keyword = parsed.positionals[1];
  try {
    const catalog: CatalogView = await ctx.api.fetchCatalog();
    switch (sub) {
      case 'buildings': {
        const completed = await completedTechIds(ctx);
        return fmtCatalogBuildings(catalog, { keyword, completed });
      }
      case 'building': {
        if (!keyword) {
          return fmtError('用法: catalog building <id>');
        }
        const completed = await completedTechIds(ctx);
        const found = (catalog.buildings ?? []).some((building) => building.id === keyword);
        const out = fmtCatalogBuilding(catalog, keyword, completed);
        return found ? out : fmtError(out);
      }
      case 'recipes': {
        const completed = await completedTechIds(ctx);
        return fmtCatalogRecipes(catalog, {
          keyword,
          handcraftOnly: hasFlag(parsed, 'handcraft'),
          building: getStringOption(parsed, 'building'),
          completed,
        });
      }
      case 'items':
        return fmtCatalogItems(catalog, keyword);
      case 'techs': {
        const completed = await completedTechIds(ctx);
        const filter: CatalogTechFilter = hasFlag(parsed, 'available')
          ? 'available'
          : hasFlag(parsed, 'done') ? 'done' : 'all';
        return fmtCatalogTechs(catalog, filter, completed);
      }
      case 'units':
        return fmtCatalogUnits(catalog);
      default:
        return fmtError(`未知 catalog 子命令：${sub}\n  ${CATALOG_USAGE}`);
    }
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
}
