import { useEffect, useMemo, useRef } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { ALL_EVENT_TYPES } from '@shared/config';
import { createSseClient } from '@shared/sse';
import type { ApiClient } from '@shared/api';

import { forwardGameEventToBattleBus } from '@/engine/battle-events';
import { notifyGameEvent } from '@/features/notifications/notify';
import {
  shouldRefreshWarBlueprints,
  shouldRefreshWarFleets,
  shouldRefreshWarIndustry,
  shouldRefreshWarSummary,
  shouldRefreshWarSystemRuntime,
  shouldRefreshWarTaskForces,
  shouldRefreshWarTheaters,
} from '@/features/war/model';

interface UseWarRealtimeOptions {
  client: ApiClient;
  fetchFn?: typeof fetch;
  serverUrl: string;
  playerId: string;
  playerKey: string;
  focusSystemId: string;
}

interface WarInvalidationFlags {
  summary: boolean;
  blueprints: boolean;
  industry: boolean;
  taskForces: boolean;
  theaters: boolean;
  fleets: boolean;
  systemRuntime: boolean;
}

function createInvalidationFlags(): WarInvalidationFlags {
  return {
    summary: false,
    blueprints: false,
    industry: false,
    taskForces: false,
    theaters: false,
    fleets: false,
    systemRuntime: false,
  };
}

interface WarScope {
  serverUrl: string;
  playerId: string;
  focusSystemId: string;
}

/**
 * 战争工作台 SSE 实时层：把 8 路 1s 轮询收敛为「SSE 事件驱动失效 + 低频兜底轮询」。
 *
 * 结构复刻 use-planet-realtime：
 * - createSseClient 订阅 game 事件 → 150ms 防抖批量 invalidateQueries
 * - 瞬时战斗事件（导弹/点防/战报/伤害/击毁）同步分流到 engine/battle-events
 *   战斗事件总线，供战场特效（后续音效）消费；payload 透传，不进任何 store
 * - subscribeStatus 重连后用 /events/snapshot 补齐遗漏事件（游标用 useRef，不引入 war store）
 * - 不做事件缓冲/journal：战报/接触/封锁列表全部来自 react-query 缓存，失效即刷新
 */
export function useWarRealtime(options: UseWarRealtimeOptions) {
  const queryClient = useQueryClient();
  const pendingInvalidationsRef = useRef<WarInvalidationFlags>(createInvalidationFlags());
  const invalidateTimerRef = useRef<number | null>(null);
  const lastEventIdRef = useRef<string>('');
  const hasConnectedRef = useRef(false);
  const latestScopeRef = useRef<WarScope>({
    serverUrl: options.serverUrl,
    playerId: options.playerId,
    focusSystemId: options.focusSystemId,
  });

  latestScopeRef.current = {
    serverUrl: options.serverUrl,
    playerId: options.playerId,
    focusSystemId: options.focusSystemId,
  };

  const sseClient = useMemo(
    () => createSseClient({
      fetchFn: options.fetchFn,
      serverUrl: options.serverUrl,
    }),
    [options.fetchFn, options.serverUrl],
  );

  function scheduleInvalidation(next: Partial<WarInvalidationFlags>) {
    const current = pendingInvalidationsRef.current;
    pendingInvalidationsRef.current = {
      summary: current.summary || Boolean(next.summary),
      blueprints: current.blueprints || Boolean(next.blueprints),
      industry: current.industry || Boolean(next.industry),
      taskForces: current.taskForces || Boolean(next.taskForces),
      theaters: current.theaters || Boolean(next.theaters),
      fleets: current.fleets || Boolean(next.fleets),
      systemRuntime: current.systemRuntime || Boolean(next.systemRuntime),
    };

    if (invalidateTimerRef.current !== null) {
      return;
    }

    invalidateTimerRef.current = window.setTimeout(() => {
      const flags = pendingInvalidationsRef.current;
      const scope = latestScopeRef.current;
      pendingInvalidationsRef.current = createInvalidationFlags();
      invalidateTimerRef.current = null;

      if (flags.summary) {
        void queryClient.invalidateQueries({ queryKey: ['summary', scope.serverUrl, scope.playerId] });
      }
      if (flags.blueprints) {
        void queryClient.invalidateQueries({ queryKey: ['war-blueprints', scope.serverUrl, scope.playerId] });
      }
      if (flags.industry) {
        void queryClient.invalidateQueries({ queryKey: ['war-industry', scope.serverUrl, scope.playerId] });
      }
      if (flags.taskForces) {
        void queryClient.invalidateQueries({ queryKey: ['war-task-forces', scope.serverUrl, scope.playerId] });
      }
      if (flags.theaters) {
        void queryClient.invalidateQueries({ queryKey: ['war-theaters', scope.serverUrl, scope.playerId] });
      }
      if (flags.fleets) {
        void queryClient.invalidateQueries({ queryKey: ['war-fleets', scope.serverUrl, scope.playerId] });
      }
      if (flags.systemRuntime && scope.focusSystemId) {
        void queryClient.invalidateQueries({
          queryKey: ['system-runtime', scope.serverUrl, scope.playerId, scope.focusSystemId],
        });
      }
    }, 150);
  }

  async function pullMissedEvents() {
    let nextCursor = lastEventIdRef.current || undefined;
    let pagesLeft = 4;
    let sawEvent = false;

    while (pagesLeft > 0) {
      const response = await options.client.fetchEventSnapshot({
        event_types: [...ALL_EVENT_TYPES],
        after_event_id: nextCursor,
        limit: 50,
      });

      if (response.events.length === 0) {
        break;
      }

      sawEvent = true;
      response.events.forEach((event) => {
        lastEventIdRef.current = event.event_id || lastEventIdRef.current;
      });

      const lastEvent = response.events[response.events.length - 1];
      const nextEventId = response.next_event_id || lastEvent?.event_id || '';
      if (nextEventId) {
        lastEventIdRef.current = nextEventId;
      }
      nextCursor = nextEventId || undefined;

      if (!response.has_more) {
        break;
      }
      pagesLeft -= 1;
    }

    if (sawEvent) {
      // 补齐期间整段丢失的可能性更高，做一次全量失效兜底
      scheduleInvalidation({
        summary: true,
        blueprints: true,
        industry: true,
        taskForces: true,
        theaters: true,
        fleets: true,
        systemRuntime: true,
      });
    }
  }

  useEffect(() => {
    if (!options.playerKey) {
      return undefined;
    }

    const unsubscribeEvent = sseClient.subscribe((message) => {
      if (message.type !== 'game') {
        return;
      }
      const event = message.event;
      if (event.event_id) {
        lastEventIdRef.current = event.event_id;
      }

      // 瞬时战斗事件分流一份到战斗事件总线（战场特效/后续音效消费），
      // 下面的 react-query 防抖失效逻辑保持不变。
      forwardGameEventToBattleBus(event);

      // 全局事件通知 toast（内部 event_id 去重；?freeze=1 不弹）
      notifyGameEvent(event);

      scheduleInvalidation({
        summary: shouldRefreshWarSummary(event),
        blueprints: shouldRefreshWarBlueprints(event),
        industry: shouldRefreshWarIndustry(event),
        taskForces: shouldRefreshWarTaskForces(event),
        theaters: shouldRefreshWarTheaters(event),
        fleets: shouldRefreshWarFleets(event),
        systemRuntime: shouldRefreshWarSystemRuntime(event),
      });
    });

    const unsubscribeStatus = sseClient.subscribeStatus((status) => {
      if (status === 'connected') {
        if (hasConnectedRef.current) {
          void pullMissedEvents();
        }
        hasConnectedRef.current = true;
      }
    });

    sseClient.start({
      playerKey: options.playerKey,
      eventTypes: [...ALL_EVENT_TYPES],
    });

    return () => {
      unsubscribeEvent();
      unsubscribeStatus();
      sseClient.stop();
      hasConnectedRef.current = false;
      if (invalidateTimerRef.current !== null) {
        window.clearTimeout(invalidateTimerRef.current);
        invalidateTimerRef.current = null;
      }
      pendingInvalidationsRef.current = createInvalidationFlags();
    };
  }, [options.playerKey, sseClient]);

  return { pullMissedEvents };
}
