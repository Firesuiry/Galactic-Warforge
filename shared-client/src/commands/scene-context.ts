import chalk from 'chalk';

import type { ApiClient } from '../api.js';
import { selectMyMecha } from '../mecha.js';
import type { MechaView, StateSummary } from '../types.js';

/** scene / inspect 的星球默认值：我的机甲所在星球，找不到用焦点星球。 */
export interface PlanetContext {
  planetId: string;
  /** 为什么选这颗星（提示行用）。 */
  source: 'mecha' | 'focus' | 'active';
  mecha?: MechaView;
}

/** 从 summary 解析「我的机甲」与默认星球；issuer 的机甲优先，其次焦点星球。 */
export function resolvePlanetContext(summary: StateSummary, playerId: string, issuerId: string): PlanetContext {
  const mecha = selectMyMecha(summary.players?.[playerId], issuerId);
  if (mecha) {
    return { planetId: mecha.planet_id, source: 'mecha', mecha };
  }
  const player = summary.players?.[playerId];
  if (player?.focus_planet_id) {
    return { planetId: player.focus_planet_id, source: 'focus' };
  }
  return { planetId: summary.active_planet_id, source: 'active' };
}

export async function fetchPlanetContext(
  api: ApiClient,
  issuerId: string,
): Promise<PlanetContext> {
  const summary = await api.fetchSummary();
  return resolvePlanetContext(summary, api.getAuth().playerId, issuerId);
}

export function fmtPlanetContext(context: PlanetContext): string {
  const why = context.source === 'mecha'
    ? `我的机甲 ${context.mecha?.unit_id} 所在星球`
    : context.source === 'focus' ? '焦点星球（未绑定机甲）' : '当前激活星球（未绑定机甲、无焦点）';
  return chalk.dim(`planet=${context.planetId}（${why}）`);
}

/**
 * 机甲居中窗口，按星球图集尺寸裁剪。atlas 是 cube-sphere 平面图集：
 * x ∈ [0, map_width)、y ∈ [0, map_height)，越界部分由服务端裁剪。
 */
export function centeredWindow(
  mecha: { position?: { x: number; y: number } } | undefined,
  size: number,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number; width: number; height: number } {
  const width = Math.max(1, Math.min(size, mapWidth));
  const height = Math.max(1, Math.min(size, mapHeight));
  const anchor = mecha?.position;
  if (!anchor) {
    return { x: 0, y: 0, width, height };
  }
  const x = Math.min(Math.max(0, anchor.x - Math.floor(width / 2)), Math.max(0, mapWidth - width));
  const y = Math.min(Math.max(0, anchor.y - Math.floor(height / 2)), Math.max(0, mapHeight - height));
  return { x, y, width, height };
}
