import { useQuery } from '@tanstack/react-query';

import { isFixtureServerUrl } from '@/fixtures';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';

export const CURRENT_GAME_QUERY_KEY = 'current-game';
export const CURRENT_GAME_REFETCH_INTERVAL_MS = 10_000;

/**
 * C10：GET /games/current 共享轮询（大厅页与局变更守卫共用同一 queryKey，自动去重）。
 * 离线样例模式下禁用（fixtures 无此端点）。
 */
export function useCurrentGameQuery() {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const fixtureMode = isFixtureServerUrl(session.serverUrl);

  return useQuery({
    queryKey: [CURRENT_GAME_QUERY_KEY, session.serverUrl, session.playerId],
    queryFn: () => client.fetchCurrentGame(),
    enabled: Boolean(session.playerId && session.playerKey) && !fixtureMode,
    refetchInterval: CURRENT_GAME_REFETCH_INTERVAL_MS,
    // 后台标签页也要继续轮询：换局后旧 key 的 401 需要被守卫及时捕获并登出，
    // 否则挂后台的玩家端会一直拿旧 key 空转（SSE 重连死循环）
    refetchIntervalInBackground: true,
    retry: false,
  });
}
