import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import type { FogMapView, PlanetView } from '@shared/types';
import { ALL_EVENT_TYPES } from '@shared/config';
import { useParams, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';

import { createFixtureFetch, isFixtureServerUrl } from '@/fixtures';
import { PlanetCommandPanel } from '@/features/planet-map/PlanetCommandPanel';
import { PlanetMapCanvas } from '@/features/planet-map/PlanetMapCanvas';
import { PlanetActivityPanel, PlanetDebugPanel, PlanetEntityPanel, PlanetLayerPanel } from '@/features/planet-map/PlanetPanels';
import {
  extractAlertFromEvent,
  getTechDisplayName,
  getViewportTileBounds,
  parseEnabledLayers,
  resolveSelectionFromQueryValue,
  selectionLabel,
} from '@/features/planet-map/model';
import { PLANET_ZOOM_LEVELS, usePlanetViewStore } from '@/features/planet-map/store';
import { usePlanetRealtimeSync } from '@/features/planet-map/use-planet-realtime';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';

const DEFAULT_SCENE_VIEWPORT = {
  width: 960,
  height: 640,
};

const DEFAULT_SCENE_LAYERS = ['terrain', 'fog', 'resources', 'buildings', 'units'];

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
  const [intelOpen, setIntelOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const {
    camera,
    hoveredTile,
    hydrateRecentAlerts,
    hydrateRecentEvents,
    markFullSync,
    recentAlerts,
    recentEvents,
    resetCamera,
    resetForPlanet,
    selected,
    setLayers,
    setLastEventId,
    setSelected,
    setZoomIndex,
    requestFocus,
    toggleDebugOpen,
  } = usePlanetViewStore(useShallow((state) => ({
    camera: state.camera,
    hoveredTile: state.hoveredTile,
    hydrateRecentAlerts: state.hydrateRecentAlerts,
    hydrateRecentEvents: state.hydrateRecentEvents,
    markFullSync: state.markFullSync,
    recentAlerts: state.recentAlerts,
    recentEvents: state.recentEvents,
    resetCamera: state.resetCamera,
    resetForPlanet: state.resetForPlanet,
    selected: state.selected,
    setLayers: state.setLayers,
    setLastEventId: state.setLastEventId,
    setSelected: state.setSelected,
    setZoomIndex: state.setZoomIndex,
    requestFocus: state.requestFocus,
    toggleDebugOpen: state.toggleDebugOpen,
  })));

  const planetQuery = useQuery({
    queryKey: ['planet', session.serverUrl, session.playerId, planetId],
    queryFn: () => client.fetchPlanet(planetId),
    enabled: Boolean(planetId),
  });

  const sceneRequest = useMemo(() => {
    if (!planetQuery.data) {
      return null;
    }
    const tileSize = PLANET_ZOOM_LEVELS[camera.zoomIndex] ?? PLANET_ZOOM_LEVELS[0];
    const bounds = getViewportTileBounds(
      planetQuery.data,
      camera,
      tileSize,
      DEFAULT_SCENE_VIEWPORT.width,
      DEFAULT_SCENE_VIEWPORT.height,
    );
    return {
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.maxX - bounds.minX + 1,
      height: bounds.maxY - bounds.minY + 1,
      detailLevel: 'tile' as const,
      layers: DEFAULT_SCENE_LAYERS,
    };
  }, [camera, planetQuery.data]);
  const deferredSceneRequest = useDeferredValue(sceneRequest);

  const sceneQuery = useQuery({
    queryKey: ['planet-scene', session.serverUrl, session.playerId, planetId, deferredSceneRequest],
    queryFn: () => client.fetchPlanetScene(planetId, deferredSceneRequest!),
    enabled: Boolean(planetId && deferredSceneRequest),
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

  const inspectTarget = selected && selected.kind !== 'tile'
    ? { entityKind: selected.kind, entityId: selected.id }
    : null;

  const inspectQuery = useQuery({
    queryKey: ['planet-inspect', session.serverUrl, session.playerId, planetId, inspectTarget],
    queryFn: () => client.fetchPlanetInspect(planetId, inspectTarget!),
    enabled: Boolean(planetId && inspectTarget),
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
    setIntelOpen(false);
    setLayersOpen(false);
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

    const sharedSelection = resolveSelectionFromQueryValue(planetViewFromScene(planetQuery.data, sceneQuery.data), searchParams.get('select'));
    if (sharedSelection) {
      setSelected(sharedSelection);
    }

    restoredViewRef.current = signature;
  }, [planetId, planetQuery.data, requestFocus, sceneQuery.data, searchParams, setLayers, setSelected, setZoomIndex]);

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
    sceneQuery.isLoading,
    catalogQuery.isLoading,
    summaryQuery.isLoading,
    statsQuery.isLoading,
    eventQuery.isLoading,
    alertQuery.isLoading,
  ].some(Boolean);

  if (isLoading) {
    return <div className="panel">正在加载行星观察页...</div>;
  }

  const error = planetQuery.error
    || sceneQuery.error
    || runtimeQuery.error
    || networksQuery.error
    || catalogQuery.error
    || summaryQuery.error
    || statsQuery.error
    || eventQuery.error
    || alertQuery.error;

  if (error || !planetQuery.data || !sceneQuery.data || !catalogQuery.data) {
    return (
      <div className="panel error-banner" role="alert">
        {error instanceof Error ? error.message : '行星数据加载失败'}
      </div>
    );
  }

  const planet = planetViewFromScene(planetQuery.data, sceneQuery.data);
  const fog = fogViewFromScene(sceneQuery.data);
  const runtime = runtimeQuery.data;
  const networks = networksQuery.data;
  const catalog = catalogQuery.data;
  const summary = summaryQuery.data;
  const stats = statsQuery.data;
  const currentPlayer = summary?.players?.[session.playerId];
  const currentResearchName = getTechDisplayName(catalog, currentPlayer?.tech?.current_research?.tech_id ?? '');
  const sceneBoundsLabel = deferredSceneRequest
    ? `${deferredSceneRequest.x},${deferredSceneRequest.y} · ${deferredSceneRequest.width}x${deferredSceneRequest.height}`
    : '-';
  const inspectLabel = inspectQuery.data?.title
    || inspectQuery.data?.entity_id
    || selectionLabel(selected);
  const unreadIntel = recentEvents.length + recentAlerts.length;

  return (
    <div className="page-grid page-grid--planet">
      <section className="panel page-hero page-hero--planet">
        <div className="page-header">
          <p className="eyebrow">Planet Command Theater</p>
          <h1>{planet.name || planet.planet_id}</h1>
          <p className="subtle-text">
            tick {planet.tick} · {planet.kind || 'unknown'} · {planet.map_width} x {planet.map_height}
          </p>
        </div>
        <div className="hero-actions hero-actions--planet">
          <div className="hero-chip">建筑 {planetQuery.data.building_count}</div>
          <div className="hero-chip">单位 {planetQuery.data.unit_count}</div>
          <div className="hero-chip">资源点 {planetQuery.data.resource_count}</div>
          <div className="hero-chip">
            资源 {currentPlayer?.resources?.minerals ?? 0} / {currentPlayer?.resources?.energy ?? 0}
          </div>
          <div className="hero-chip">
            电力 {stats ? `${stats.energy_stats.generation}/${stats.energy_stats.consumption}` : '-'}
          </div>
          <div className="hero-chip">研究 {currentResearchName || '无'}</div>
        </div>
      </section>

      <section className="planet-workbench planet-workbench--grand">
        <aside className="planet-rail">
          <button
            className={layersOpen ? 'secondary-button planet-rail__button planet-rail__button--active' : 'secondary-button planet-rail__button'}
            onClick={() => setLayersOpen((current) => !current)}
            type="button"
          >
            图层
          </button>
          <button
            className={intelOpen ? 'secondary-button planet-rail__button planet-rail__button--active' : 'secondary-button planet-rail__button'}
            onClick={() => setIntelOpen((current) => !current)}
            type="button"
          >
            情报
          </button>
          <button className="secondary-button planet-rail__button" onClick={toggleDebugOpen} type="button">
            调试
          </button>
          <button className="secondary-button planet-rail__button" onClick={resetCamera} type="button">
            重置视角
          </button>
          <div className="planet-rail__meta">
            <span>未读 {unreadIntel}</span>
            <span>视窗 {sceneBoundsLabel}</span>
          </div>
        </aside>

        <section className="panel planet-map-shell planet-map-shell--grand">
          <div className="planet-map-stage">
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

            {layersOpen ? (
              <div className="planet-overlay planet-overlay--left">
                <PlanetLayerPanel networks={networks} planet={planet} runtime={runtime} />
              </div>
            ) : null}

            {intelOpen ? (
              <div className="planet-overlay planet-overlay--intel">
                <PlanetActivityPanel alerts={recentAlerts} events={recentEvents} planet={planet} />
              </div>
            ) : null}

            <PlanetDebugPanel
              catalog={catalog}
              canvas={canvasRef.current}
              currentTick={planet.tick}
              networks={networks}
              onPullEvents={pullMissedEvents}
              onRefreshFog={async () => {
                await sceneQuery.refetch();
                markFullSync();
              }}
              onRefreshPlanet={async () => {
                await Promise.all([
                  planetQuery.refetch(),
                  sceneQuery.refetch(),
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
          </div>
          <div className="planet-command-bar">
            <span>hover {hoveredTile ? `${hoveredTile.x}, ${hoveredTile.y}` : '-'}</span>
            <span>选中 {inspectLabel}</span>
            <span>tick {planet.tick}</span>
            <span>
              scene {sceneQuery.data.bounds.min_x},{sceneQuery.data.bounds.min_y} → {sceneQuery.data.bounds.max_x},{sceneQuery.data.bounds.max_y}
            </span>
          </div>
        </section>

        <aside className="panel planet-detail-shell planet-detail-shell--grand">
          <section className="planet-side-section planet-side-section--summary">
            <div className="section-title">当前局势</div>
            <dl className="planet-kv-list">
              <div>
                <dt>当前侦察</dt>
                <dd>{inspectLabel}</dd>
              </div>
              <div>
                <dt>地图</dt>
                <dd>{planet.map_width} x {planet.map_height}</dd>
              </div>
              <div>
                <dt>视窗</dt>
                <dd>{sceneBoundsLabel}</dd>
              </div>
              <div>
                <dt>威胁</dt>
                <dd>{runtime?.threat_level ?? stats?.combat_stats.threat_level ?? 0}</dd>
              </div>
              <div>
                <dt>物流</dt>
                <dd>{runtime?.logistics_drones?.length ?? 0}</dd>
              </div>
              <div>
                <dt>施工</dt>
                <dd>{runtime?.construction_tasks?.length ?? 0}</dd>
              </div>
              <div>
                <dt>电网</dt>
                <dd>{networks?.power_networks?.length ?? 0}</dd>
              </div>
              <div>
                <dt>管网</dt>
                <dd>{networks?.pipeline_segments?.length ?? 0}</dd>
              </div>
            </dl>
          </section>

          <PlanetEntityPanel
            catalog={catalog}
            fog={fog}
            networks={networks}
            planet={planet}
            runtime={runtime}
            stats={stats}
            summary={summary}
          />
          <PlanetCommandPanel catalog={catalog} client={client} planet={planet} />
        </aside>
      </section>
    </div>
  );
}

function planetViewFromScene(summary: Awaited<ReturnType<ReturnType<typeof useApiClient>['fetchPlanet']>>, scene?: Awaited<ReturnType<ReturnType<typeof useApiClient>['fetchPlanetScene']>>): PlanetView {
  return {
    planet_id: summary.planet_id,
    name: summary.name,
    discovered: summary.discovered,
    kind: summary.kind,
    map_width: summary.map_width,
    map_height: summary.map_height,
    tick: scene?.tick ?? summary.tick,
    terrain: scene?.terrain,
    scene_bounds: scene?.bounds,
    buildings: scene?.buildings,
    units: scene?.units,
    resources: scene?.resources,
  };
}

function fogViewFromScene(scene: Awaited<ReturnType<ReturnType<typeof useApiClient>['fetchPlanetScene']>>): FogMapView {
  return {
    planet_id: scene.planet_id,
    discovered: scene.discovered,
    map_width: scene.map_width,
    map_height: scene.map_height,
    scene_bounds: scene.bounds,
    visible: scene.fog?.visible,
    explored: scene.fog?.explored,
  };
}
