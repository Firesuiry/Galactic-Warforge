/**
 * 顶栏/警报条共用的产线告警快照（shell-alerts）。
 *
 * 单一来源：query key 只在这里定义，limit 也只有一份——过去 TopNav(50) 与
 * Outliner(5) 共用同一个 key、各写各的 limit，先挂载的一方决定缓存内容，
 * 「几座建筑缺电」的统计因此会随路由/渲染顺序抖动。
 *
 * 只取仍成立的告警（`active_only=true`）：服务端快照会保留已解除的历史条目，
 * 老对局里历史条目动辄几十上百条；只取 50 条时它们会把新出现的
 * `haul_unreachable` / `belt_blocked` 挤出客户端视野（试玩 1016 严重 1）。
 * 服务端新顺序（仍成立在前、最新在前）已保证 50 条足以覆盖当前告警。
 *
 * 过滤：研究站的吞吐类告警是噪音（见 production-alerts）；
 * 已解除的告警（旧服务端 / 旧存档里可能仍混进来）也不再计入顶栏计数、
 * 警报条与地图红标。顶栏计数、警报条、缺电统计都看同一份过滤后的列表。
 */

import { useQuery } from '@tanstack/react-query';

import type { AlertEntry } from '@shared/types';

import { isAlertActive } from '@shared/alerts';

import { isResearchStationAlertNoise } from '@/features/production-alerts';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';

/**
 * 快照条数上限：要覆盖「按建筑统计缺电」与警报条展开列表，50 足够且不拖慢轮询。
 * 服务端 `active_only=true` 下 limit 只作用于仍成立的告警，不再被历史条目挤占。
 */
export const SHELL_ALERT_LIMIT = 50;

export function useShellAlerts() {
  const client = useApiClient();
  const session = useSessionSnapshot();

  const query = useQuery({
    queryKey: ['shell-alerts', session.serverUrl, session.playerId],
    queryFn: () => client.fetchAlertSnapshot({ limit: SHELL_ALERT_LIMIT, active_only: true }),
    enabled: Boolean(session.playerId),
    refetchInterval: 8000,
  });

  const alerts: AlertEntry[] = (query.data?.alerts ?? []).filter(
    (alert) => isAlertActive(alert) && !isResearchStationAlertNoise(alert),
  );

  return { alerts, query };
}
