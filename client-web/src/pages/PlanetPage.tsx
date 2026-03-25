import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';

import { ALL_EVENT_TYPES } from '@shared/config';

import { PlanetActivityPanel, PlanetDebugPanel, PlanetEntityPanel, PlanetLayerPanel } from '@/features/planet-map/PlanetPanels';
import { PlanetCommandPanel } from '@/features/planet-map/PlanetCommandPanel';
import { PlanetMapCanvas } from '@/features/planet-map/PlanetMapCanvas';
import { extractAlertFromEvent, parseEnabledLayers, resolveSelectionFromQueryValue, getTechDisplayName } from '@/features/planet-map/model';
import { usePlanetRealtimeSync } from '@/features/planet-map/use-planet-realtime';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { usePlanetViewStore } from '@/features/planet-map/store';
import { PLANET_ZOOM_LEVELS } from '@/features/planet-map/store';
import { useEffect, useMemo, useRef } from 'react';
import { createFixtureFetch, isFixtureServerUrl } from '@/fixtures';
import { useShallow } from 'zustand/react/shallow';

export function PlanetPage() {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const [searchParams] = useSearchParams();
  const realtimeFetchFn = useMemo(
    () => (isFixtureServerUrl(session.serverUrl) ? createFixtureFetch(session.serverUrl) : undefined),
    [session.serverUrl],
  );
  const { planetId = '' } = useParams();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const restoredViewRef = useRef('');
  const {
    hydrateRecentAlerts,
    hydrateRecentEvents,
    markFullSync,
    recentAlerts,
    recentEvents,
    resetForPlanet,
    setLayers,
    setLastEventId,
    setSelected,
    setZoomIndex,
    requestFocus,
  } = usePlanetViewStore(useShallow((state) => ({
    hydrateRecentAlerts: state.hydrateRecentAlerts,
    hydrateRecentEvents: state.hydrateRecentEvents,
    markFullSync: state.markFullSync,
    recentAlerts: state.recentAlerts,
    recentEvents: state.recentEvents,
    resetForPlanet: state.resetForPlanet,
    setLayers: state.setLayers,
    setLastEventId: state.setLastEventId,
    setSelected: state.setSelected,
    setZoomIndex: state.setZoomIndex,
    requestFocus: state.requestFocus,
  })));

  const planetQuery = useQuery({
    queryKey: ['planet', session.serverUrl, session.playerId, planetId],
    queryFn: () => client.fetchPlanet(planetId),
    enabled: Boolean(planetId),
  });

  const fogQuery = useQuery({
    queryKey: ['planet-fog', session.serverUrl, session.playerId, planetId],
    queryFn: () => client.fetchFogMap(planetId),
    enabled: Boolean(planetId),
  });

  const runtimeQuery = useQuery({
    queryKey: ['planet-runtime', session.serverUrl, session.playerId, planetId],
    queryFn: () => client.fetchPlanetRuntime(planetId),
    enabled: Boolean(planetId),
  });

  const networksQuery = useQuery({
    queryKey: ['planet-networks', session.serverUrl, session.playerId, planetId],
    queryFn: () => client.fetchPlanetNetworks(planetId),
    enabled: Boolean(planetId),
  });

  const catalogQuery = useQuery({
    queryKey: ['catalog', session.serverUrl, session.playerId],
    queryFn: () => client.fetchCatalog(),
    enabled: Boolean(planetId),
  });

  const summaryQuery = useQuery({
    queryKey: ['summary', session.serverUrl, session.playerId],
    queryFn: () => client.fetchSummary(),
    enabled: Boolean(planetId),
  });

  const statsQuery = useQuery({
    queryKey: ['stats', session.serverUrl, session.playerId],
    queryFn: () => client.fetchStats(),
    enabled: Boolean(planetId),
  });

  const eventQuery = useQuery({
    queryKey: ['events-snapshot', session.serverUrl, session.playerId, planetId],
    queryFn: () => client.fetchEventSnapshot({
      event_types: [...ALL_EVENT_TYPES],
      limit: 30,
    }),
    enabled: Boolean(planetId),
  });

  const alertQuery = useQuery({
    queryKey: ['alerts-snapshot', session.serverUrl, session.playerId, planetId],
    queryFn: () => client.fetchAlertSnapshot({ limit: 20 }),
    enabled: Boolean(planetId),
  });

  const { pullMissedEvents } = usePlanetRealtimeSync({
    client,
    fetchFn: realtimeFetchFn,
    serverUrl: session.serverUrl,
    playerId: session.playerId,
    playerKey: session.playerKey,
    planetId,
  });

  useEffect(() => {
    restoredViewRef.current = '';
    resetForPlanet(planetId);
  }, [planetId, resetForPlanet]);

  useEffect(() => {
    if (!planetQuery.data) {
      return;
    }
    const signature = `${planetId}?${searchParams.toString()}`;
    if (restoredViewRef.current === signature) {
      return;
    }

    const zoomParam = Number(searchParams.get('zoom') ?? '');
    if (Number.isFinite(zoomParam)) {
      const zoomIndex = PLANET_ZOOM_LEVELS.reduce((bestIndex, currentZoom, index) => (
        Math.abs(currentZoom - zoomParam) < Math.abs(PLANET_ZOOM_LEVELS[bestIndex] - zoomParam)
          ? index
          : bestIndex
      ), 0);
      setZoomIndex(zoomIndex);
    }

    const layerPatch = parseEnabledLayers(searchParams.get('layers'), usePlanetViewStore.getState().layers);
    if (layerPatch) {
      setLayers(layerPatch);
    }

    const focusX = Number(searchParams.get('x') ?? '');
    const focusY = Number(searchParams.get('y') ?? '');
    if (Number.isFinite(focusX) && Number.isFinite(focusY)) {
      requestFocus({ x: Math.round(focusX), y: Math.round(focusY) });
    }

    const sharedSelection = resolveSelectionFromQueryValue(planetQuery.data, searchParams.get('select'));
    if (sharedSelection) {
      setSelected(sharedSelection);
    }

    restoredViewRef.current = signature;
  }, [planetId, planetQuery.data, requestFocus, searchParams, setLayers, setSelected, setZoomIndex]);

  useEffect(() => {
    if (!eventQuery.data) {
      return;
    }
    hydrateRecentEvents(eventQuery.data.events);
    const latestEventId = eventQuery.data.next_event_id || eventQuery.data.events[0]?.event_id || '';
    if (latestEventId) {
      setLastEventId(latestEventId);
    }
    const derivedAlerts = eventQuery.data.events
      .map((event) => extractAlertFromEvent(event))
      .filter((alert): alert is NonNullable<typeof alert> => Boolean(alert));
    if (derivedAlerts.length > 0) {
      hydrateRecentAlerts(derivedAlerts);
    }
    markFullSync();
  }, [eventQuery.data, hydrateRecentAlerts, hydrateRecentEvents, markFullSync, setLastEventId]);

  useEffect(() => {
    if (!alertQuery.data) {
      return;
    }
    hydrateRecentAlerts(alertQuery.data.alerts);
    markFullSync();
  }, [alertQuery.data, hydrateRecentAlerts, markFullSync]);

  const isLoading = [
    planetQuery.isLoading,
    fogQuery.isLoading,
    runtimeQuery.isLoading,
    networksQuery.isLoading,
    catalogQuery.isLoading,
    summaryQuery.isLoading,
    statsQuery.isLoading,
    eventQuery.isLoading,
    alertQuery.isLoading,
  ].some(Boolean);

  if (isLoading) {
    return <div className="panel">正在加载行星观察页...</div>;
  }

  const error = planetQuery.error || fogQuery.error || runtimeQuery.error || networksQuery.error || catalogQuery.error || summaryQuery.error || statsQuery.error || eventQuery.error || alertQuery.error;

  if (error || !planetQuery.data || !fogQuery.data || !runtimeQuery.data || !networksQuery.data || !catalogQuery.data) {
    return (
      <div className="panel error-banner" role="alert">
        {error instanceof Error ? error.message : '行星数据加载失败'}
      </div>
    );
  }

  const planet = planetQuery.data;
  const fog = fogQuery.data;
  const runtime = runtimeQuery.data;
  const networks = networksQuery.data;
  const catalog = catalogQuery.data;
  const summary = summaryQuery.data;
  const stats = statsQuery.data;
  const currentPlayer = summary?.players?.[session.playerId];
  const currentResearchName = getTechDisplayName(catalog, currentPlayer?.tech?.current_research?.tech_id ?? '');

  return (
    <div className="page-grid">
      <section className="panel page-hero">
        <div className="page-header">
          <p className="eyebrow">T007-T012 行星观察端</p>
          <h1>{planet.name || planet.planet_id}</h1>
          <p className="subtle-text">
            tick {planet.tick} · {planet.kind || 'unknown'} · {planet.map_width} x {planet.map_height}
          </p>
        </div>
        <div className="hero-actions">
          <div className="hero-chip">
            资源 {currentPlayer?.resources?.minerals ?? 0} / {currentPlayer?.resources?.energy ?? 0}
          </div>
          <div className="hero-chip">
            电力 {stats ? `${stats.energy_stats.generation}/${stats.energy_stats.consumption}` : '-'}
          </div>
          <div className="hero-chip">
            研究 {currentResearchName || '无'}
          </div>
        </div>
      </section>

      <section className="planet-workbench">
        <aside className="panel planet-sidebar">
          <PlanetLayerPanel networks={networks} planet={planet} runtime={runtime} />
        </aside>

        <section className="panel planet-map-shell">
          <PlanetMapCanvas
            catalog={catalog}
            fog={fog}
            networks={networks}
            onCanvasReady={(canvas) => {
              canvasRef.current = canvas;
            }}
            planet={planet}
            runtime={runtime}
          />
          <PlanetDebugPanel
            catalog={catalog}
            canvas={canvasRef.current}
            currentTick={planet.tick}
            networks={networks}
            onPullEvents={pullMissedEvents}
            onRefreshFog={async () => {
              await fogQuery.refetch();
              markFullSync();
            }}
            onRefreshPlanet={async () => {
              await Promise.all([
                planetQuery.refetch(),
                runtimeQuery.refetch(),
                networksQuery.refetch(),
                summaryQuery.refetch(),
                statsQuery.refetch(),
              ]);
              markFullSync();
            }}
            planet={planet}
            runtime={runtime}
          />
        </section>

        <aside className="panel planet-detail-shell">
          <PlanetEntityPanel catalog={catalog} fog={fog} networks={networks} planet={planet} runtime={runtime} stats={stats} summary={summary} />
          <PlanetCommandPanel catalog={catalog} client={client} planet={planet} />
        </aside>
      </section>

      <PlanetActivityPanel alerts={recentAlerts} events={recentEvents} planet={planet} />
    </div>
  );
}
