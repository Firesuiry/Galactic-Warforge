import { useEffect, useMemo } from 'react';

import { ALL_EVENT_TYPES } from '@shared/config';
import { createSseClient } from '@shared/sse';

import { notifyGameEvent } from '@/features/notifications/notify';

/**
 * 星图路由的 SSE 通知桥。
 *
 * /war 与 /planet 的实时层只挂在各自路由，星图（跃迁光点的主观察位）此前
 * 没有任何 SSE 源，`fleet_move_started` / `fleet_arrived` 等 toast 不会触发。
 * 这里只桥接 game 事件 → 全局 toast（notify 内部 event_id 去重，?freeze=1 不弹），
 * 不做查询失效——星图数据刷新走 war-fleets 轮询与命令回执失效。
 */
export function useStarmapNotify(serverUrl: string, playerKey: string) {
  const sseClient = useMemo(() => createSseClient({ serverUrl }), [serverUrl]);

  useEffect(() => {
    if (!playerKey) {
      return undefined;
    }
    const unsubscribe = sseClient.subscribe((message) => {
      if (message.type === 'game') {
        notifyGameEvent(message.event);
      }
    });
    sseClient.start({ playerKey, eventTypes: [...ALL_EVENT_TYPES] });
    return () => {
      unsubscribe();
      sseClient.stop();
    };
  }, [playerKey, sseClient]);
}
