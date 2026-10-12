/**
 * 顶栏/警报条共用的产线告警快照（shell-alerts）。
 *
 * 单一来源：query key 只在这里定义，limit 也只有一份（50）——过去 TopNav(50) 与
 * Outliner(5) 共用同一个 key、各写各的 limit，先挂载的一方决定缓存内容，
 * 「几座建筑缺电」的统计因此会随路由/渲染顺序抖动。
 *
 * 过滤：研究站的吞吐类告警是噪音（见 production-alerts），这里统一剔除，
 * 顶栏计数、警报条、缺电统计都看同一份过滤后的列表。
 */

import { useQuery } from '@tanstack/react-query';

import type { AlertEntry } from '@shared/types';

import { isResearchStationAlertNoise } from '@/features/production-alerts';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';

/** 快照条数上限：要覆盖「按建筑统计缺电」与警报条展开列表，50 足够且不拖慢轮询。 */
export const SHELL_ALERT_LIMIT = 50;

export function useShellAlerts() {
  const client = useApiClient();
  const session = useSessionSnapshot();

  const query = useQuery({
    queryKey: ['shell-alerts', session.serverUrl, session.playerId],
    queryFn: () => client.fetchAlertSnapshot({ limit: SHELL_ALERT_LIMIT }),
    enabled: Boolean(session.playerId),
    refetchInterval: 8000,
  });

  const alerts: AlertEntry[] = (query.data?.alerts ?? []).filter(
    (alert) => !isResearchStationAlertNoise(alert),
  );

  return { alerts, query };
}
