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
import { usePlanetCommandStore } from '@/features/planet-commands/store';
import { usePlanetViewStore } from '@/features/planet-map/store';

interface UsePlanetRealtimeSyncOptions {
  client: ApiClient;
  fetchFn?: typeof fetch;
  serverUrl: string;
  playerId: string;
  playerKey: string;
  planetId: string;
  systemId?: string;
}

interface InvalidationFlags {
  scene: boolean;
  runtime: boolean;
  networks: boolean;
  systemRuntime: boolean;
  summary: boolean;
  stats: boolean;
  alerts: boolean;
}

function createInvalidationFlags(): InvalidationFlags {
  return {
    scene: false,
    runtime: false,
    networks: false,
    systemRuntime: false,
    summary: false,
    stats: false,
    alerts: false,
  };
}

export function usePlanetRealtimeSync(options: UsePlanetRealtimeSyncOptions) {
  const queryClient = useQueryClient();
  const pendingInvalidationsRef = useRef<InvalidationFlags>(createInvalidationFlags());
  const invalidateTimerRef = useRef<number | null>(null);
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

  const sseClient = useMemo(
    () => createSseClient({
      fetchFn: options.fetchFn,
      serverUrl: options.serverUrl,
    }),
    [options.fetchFn, options.serverUrl],
  );

  async function pullMissedEvents() {
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
      usePlanetViewStore.getState().markFullSync();
      scheduleInvalidation({
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

  function scheduleInvalidation(nextFlags: Partial<InvalidationFlags>) {
    const current = pendingInvalidationsRef.current;
    pendingInvalidationsRef.current = {
      scene: current.scene || Boolean(nextFlags.scene),
      runtime: current.runtime || Boolean(nextFlags.runtime),
      networks: current.networks || Boolean(nextFlags.networks),
      systemRuntime: current.systemRuntime || Boolean(nextFlags.systemRuntime),
      summary: current.summary || Boolean(nextFlags.summary),
      stats: current.stats || Boolean(nextFlags.stats),
      alerts: current.alerts || Boolean(nextFlags.alerts),
    };

    if (invalidateTimerRef.current !== null) {
      return;
    }

    invalidateTimerRef.current = window.setTimeout(() => {
      const flags = pendingInvalidationsRef.current;
      const scope = latestQueryScopeRef.current;
      pendingInvalidationsRef.current = createInvalidationFlags();
      invalidateTimerRef.current = null;

      if (flags.scene) {
        void queryClient.invalidateQueries({
          queryKey: ['planet-scene', scope.serverUrl, scope.playerId, scope.planetId],
        });
      }
      if (flags.runtime) {
        void queryClient.invalidateQueries({
          queryKey: ['planet-runtime', scope.serverUrl, scope.playerId, scope.planetId],
        });
      }
      if (flags.networks) {
        void queryClient.invalidateQueries({
          queryKey: ['planet-networks', scope.serverUrl, scope.playerId, scope.planetId],
        });
      }
      if (flags.systemRuntime && scope.systemId) {
        void queryClient.invalidateQueries({
          queryKey: ['system-runtime', scope.serverUrl, scope.playerId, scope.systemId],
        });
      }
      if (flags.summary) {
        void queryClient.invalidateQueries({
          queryKey: ['summary', scope.serverUrl, scope.playerId],
        });
      }
      if (flags.stats) {
        void queryClient.invalidateQueries({
          queryKey: ['stats', scope.serverUrl, scope.playerId],
        });
      }
      if (flags.alerts) {
        void queryClient.invalidateQueries({
          queryKey: ['alerts-snapshot', scope.serverUrl, scope.playerId, scope.planetId],
        });
      }
      usePlanetViewStore.getState().markFullSync();
    }, 150);
  }

  useEffect(() => {
    if (!options.playerKey || !options.planetId) {
      return undefined;
    }

    const unsubscribeEvent = sseClient.subscribe((message) => {
      if (message.type !== 'game') {
        return;
      }

      const event = message.event;
      const store = usePlanetViewStore.getState();
      store.appendRecentEvent(event);
      store.setLastEventId(event.event_id);
      usePlanetCommandStore.getState().ingestEvent(event);

      const alert = extractAlertFromEvent(event);
      if (alert) {
        store.appendRecentAlert(alert);
      }

      const refreshPlanet = shouldRefreshPlanet(event, options.planetId);
      const refreshSummary = shouldRefreshSummary(event);
      const refreshStats = shouldRefreshStats(event);
      scheduleInvalidation({
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
  }, [options.planetId, options.playerKey, sseClient]);

  return {
    pullMissedEvents,
  };
}
