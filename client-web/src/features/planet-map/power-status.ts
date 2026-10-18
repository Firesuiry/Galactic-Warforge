/**
 * 供电状态判定（纯逻辑）：缺电建筑、孤立电网。
 *
 * 试玩 1010 F/I：石矿机 `no_power` 挂了 50 分钟玩家没发现——地图上没有缺电标记，
 * 通知里 `power_shortage` 混在上百条 `input_shortage`/`output_blocked` 里；
 * 两台不在任何电塔覆盖内的风机自成一个电网，永远不参与主网，UI 只笼统显示「缺电」。
 *
 * 数据来源（都来自服务端权威视图）：
 * - 建筑运行态：planet.buildings[].runtime.state === 'no_power'；
 * - 电网覆盖：networks.power_coverage[]（connected / reason / network_id）；
 * - 电网拓扑：networks.power_networks[]（supply / demand / node_ids）与 power_nodes[]。
 */

import type { Building, PlanetNetworksView } from '@shared/types';

import { getBuildingList, type PlanetRenderView } from '@/features/planet-map/model';

/** 产线告警里属于「断电」的告警类型（优先级高于吞吐类）。 */
const POWER_ALERT_TYPES = new Set(['power_shortage', 'power_low']);

/** 该告警是否是断电类（通知面板置顶 + 顶栏计数用）。 */
export function isPowerAlertType(alertType: string | undefined | null): boolean {
  return Boolean(alertType && POWER_ALERT_TYPES.has(alertType));
}

/**
 * 孤立电网：己方电网里「有发电、无用电」的孤岛。
 *
 * 例：两台风机不在任何电塔无线覆盖（4 格）内 → 各自 supply=8 / demand=0 / nodes=1，
 * 永远不参与主网。返回这些电网的 id 与成员建筑 id（供地图标记与详情提示）。
 */
export function isolatedPowerNetworks(
  networks: PlanetNetworksView | undefined,
  playerId: string,
): { networkIds: string[]; buildingIds: string[] } {
  const isolated = (networks?.power_networks ?? []).filter(
    (network) => network.owner_id === playerId && network.supply > 0 && network.demand <= 0,
  );
  if (isolated.length === 0) {
    return { networkIds: [], buildingIds: [] };
  }
  const networkIds = new Set(isolated.map((network) => network.id));
  const buildingIds = (networks?.power_nodes ?? [])
    .filter((node) => node.owner_id === playerId && node.network_id && networkIds.has(node.network_id))
    .map((node) => node.building_id);
  return { networkIds: [...networkIds], buildingIds };
}

/** 建筑是否属于孤立电网（建筑详情提示用）。 */
export function isInIsolatedNetwork(
  networks: PlanetNetworksView | undefined,
  playerId: string,
  buildingId: string,
): boolean {
  const node = (networks?.power_nodes ?? []).find((entry) => entry.building_id === buildingId);
  if (!node?.network_id) {
    return false;
  }
  return isolatedPowerNetworks(networks, playerId).networkIds.includes(node.network_id);
}

/**
 * 该建筑是否「缺电/停机」（己方才提示）：地图缺电角标与详情提示共用。
 * 服务端建筑运行态 `no_power`（缺电）/ `error`（故障）都算「没在干活」。
 */
export function isOwnStalledBuilding(
  building: Pick<Building, 'owner_id'> & { runtime?: { state?: string } },
  playerId: string,
): boolean {
  if (building.owner_id !== playerId) {
    return false;
  }
  const state = building.runtime?.state;
  return state === 'no_power' || state === 'error';
}
