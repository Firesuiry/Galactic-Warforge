import { useEffect, useMemo, useRef } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { ALL_EVENT_TYPES } from '@shared/config';
import { createSseClient } from '@shared/sse';
import type { ApiClient } from '@shared/api';

import {
  extractAlertFromEvent,
  shouldRefreshAlerts,
  shouldRefreshFog,
  shouldRefreshPlanet,
  shouldRefreshStats,
  shouldRefreshSummary,
} from '@/features/planet-map/model';
import { forwardGameEventToBattleBus } from '@/engine/battle-events';
import { playPlanetEventAudio } from '@/features/audio/planet-audio';
import { notifyGameEvent } from '@/features/notifications/notify';
import { usePlanetCommandStore } from '@/features/planet-commands/store';
import { usePlanetViewStore } from '@/features/planet-map/store';
import { createPlanetInvalidationScheduler } from '@/features/planet-map/realtime-invalidation';

interface UsePlanetRealtimeSyncOptions {
  client: ApiClient;
  fetchFn?: typeof fetch;
  serverUrl: string;
  playerId: string;
  playerKey: string;
  planetId: string;
  systemId?: string;
}

export function usePlanetRealtimeSync(options: UsePlanetRealtimeSyncOptions) {
  const queryClient = useQueryClient();
  const syncGenerationRef = useRef(0);
  const hasConnectedRef = useRef(false);
  const latestQueryScopeRef = useRef({
    serverUrl: options.serverUrl,
    playerId: options.playerId,
    planetId: options.planetId,
    systemId: options.systemId ?? '',
  });

  latestQueryScopeRef.current = {
    serverUrl: options.serverUrl,
    playerId: options.playerId,
    planetId: options.planetId,
    systemId: options.systemId ?? '',
  };

  const invalidations = useMemo(() => createPlanetInvalidationScheduler(
    queryClient,
    () => latestQueryScopeRef.current,
    () => usePlanetViewStore.getState().markFullSync(),
  ), [queryClient]);

  const sseClient = useMemo(
    () => createSseClient({
      fetchFn: options.fetchFn,
      serverUrl: options.serverUrl,
    }),
    [options.fetchFn, options.serverUrl],
  );

  async function pullMissedEvents() {
    const generation = syncGenerationRef.current;
    const state = usePlanetViewStore.getState();
    let nextCursor = state.lastEventId || undefined;
    let pagesLeft = 4;
    let sawEvent = false;

    while (pagesLeft > 0) {
      const response = await options.client.fetchEventSnapshot({
        event_types: [...ALL_EVENT_TYPES],
        after_event_id: nextCursor,
        limit: 50,
      });

      if (generation !== syncGenerationRef.current) return;

      if (response.events.length === 0) {
        break;
      }

      sawEvent = true;
      const store = usePlanetViewStore.getState();
      store.hydrateRecentEvents(response.events);
      response.events.forEach((event) => {
        usePlanetCommandStore.getState().ingestEvent(event);
        const alert = extractAlertFromEvent(event);
        if (alert) {
          store.appendRecentAlert(alert);
        }
      });

      const lastEvent = response.events[response.events.length - 1];
      const nextEventId = response.next_event_id || lastEvent?.event_id || '';
      if (nextEventId) {
        store.setLastEventId(nextEventId);
      }
      nextCursor = nextEventId || undefined;

      if (!response.has_more) {
        break;
      }
      pagesLeft -= 1;
    }

    if (sawEvent) {
      invalidations.schedule({
        scene: true,
        runtime: true,
        networks: true,
        systemRuntime: true,
        summary: true,
        stats: true,
        alerts: true,
      });
    }
  }

  useEffect(() => {
    if (!options.playerKey || !options.planetId) {
      return undefined;
    }

    syncGenerationRef.current++;
    const unsubscribeEvent = sseClient.subscribe((message) => {
      if (message.type !== 'game') {
        return;
      }

      const event = message.event;
      const store = usePlanetViewStore.getState();
      store.appendRecentEvent(event);
      store.setLastEventId(event.event_id);
      usePlanetCommandStore.getState().ingestEvent(event);

      // 行星事件音效分流（建造完成/研究完成/产线告警/火箭发射），内部按 event_id 去重
      playPlanetEventAudio(event);

      // 全局事件通知 toast（内部 event_id 去重；?freeze=1 不弹）
      notifyGameEvent(event);

      // 战斗事件总线分流（damage_applied 等瞬时战斗事件 → 行星地图特效演出）。
      // use-war-realtime 挂在 /war 路由、本 hook 挂在 /planet 路由，二者不会同页
      // 共存，同一事件不会被双转发；场景订阅侧另有 seq 去重兜底。
      forwardGameEventToBattleBus(event);

      const alert = extractAlertFromEvent(event);
      if (alert) {
        store.appendRecentAlert(alert);
      }

      const refreshPlanet = shouldRefreshPlanet(event, options.planetId);
      const refreshSummary = shouldRefreshSummary(event);
      const refreshStats = shouldRefreshStats(event);
      invalidations.schedule({
        scene: refreshPlanet || shouldRefreshFog(event, options.planetId),
        runtime: refreshPlanet || refreshStats || refreshSummary,
        networks: refreshPlanet || event.event_type === 'building_state_changed',
        systemRuntime: refreshSummary || event.event_type === 'rocket_launched',
        summary: refreshSummary,
        stats: refreshStats,
        alerts: shouldRefreshAlerts(event),
      });
    });

    const unsubscribeStatus = sseClient.subscribeStatus((status) => {
      usePlanetViewStore.getState().setSseStatus(status);

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
      syncGenerationRef.current++;
      invalidations.reset();
      unsubscribeEvent();
      unsubscribeStatus();
      sseClient.stop();
      hasConnectedRef.current = false;
    };
  }, [options.planetId, options.playerId, options.playerKey, sseClient, invalidations]);

  return {
    pullMissedEvents,
  };
}
