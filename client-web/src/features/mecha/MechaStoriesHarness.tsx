import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';

import { createFixtureServerUrl } from '@/fixtures';
import { useSessionStore } from '@/stores/session';

/**
 * 视觉夹具的故事壳（第 21 轮契约 §7.3 第 6 条）：固定 p1 会话 + QueryClient，
 * 不连服务端、不读档。三个故事文件（MechaControls / MechaFleetCard / MechaHudChip）共用。
 */

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

export function MechaStage({ children, width = 520 }: PropsWithChildren<{ width?: number }>) {
  useSessionStore.getState().setSession({
    // 离线 fixture 会话：api client 走 baseline 场景的 fetch stub（机甲故事不真正请求它）。
    serverUrl: createFixtureServerUrl('baseline'),
    playerId: 'p1',
    playerKey: 'key_player_1',
  });
  return (
    <QueryClientProvider client={queryClient}>
      <div className="mecha-story-stage" style={{ minHeight: '100vh', padding: 24, maxWidth: width }}>
        {children}
      </div>
    </QueryClientProvider>
  );
}
