import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";

import { ALL_EVENT_TYPES } from "@shared/config";

import {
  PlanetActivityPanel,
  PlanetDebugPanel,
  PlanetEntityPanel,
  PlanetLayerPanel,
} from "@/features/planet-map/PlanetPanels";
import { PlanetCommandCenter } from "@/features/planet-commands/PlanetCommandCenter";
import { PlanetOperationHeader } from "@/features/planet-commands/PlanetOperationHeader";
import {
  getLatestCommandEntry,
  getPendingCommandCount,
  usePlanetCommandStore,
} from "@/features/planet-commands/store";
import { PlanetMapCanvas } from "@/features/planet-map/PlanetMapCanvas";
import { formatMineralInventory } from "@/features/mineral-summary";
import {
  extractAlertFromEvent,
  parseEnabledLayers,
  resolveSelectionFromQueryValue,
  getTechDisplayName,
} from "@/features/planet-map/model";
import { usePlanetRealtimeSync } from "@/features/planet-map/use-planet-realtime";
import { useApiClient } from "@/hooks/use-api-client";
import { useSessionSnapshot } from "@/hooks/use-session";
import { translatePlanetKind } from "@/i18n/translate";
import { usePlanetViewStore } from "@/features/planet-map/store";
import {
  getPlanetOverviewRequestStep,
  getPlanetZoomLevel,
  resolvePlanetZoomIndex,
} from "@/features/planet-map/store";
import { useEffect, useMemo, useRef, useState } from "react";
import { createFixtureFetch, isFixtureServerUrl } from "@/fixtures";
import { useShallow } from "zustand/react/shallow";

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const mediaQuery = window.matchMedia(query);
    const update = (event: MediaQueryListEvent | MediaQueryList) => {
      setMatches(event.matches);
    };

    update(mediaQuery);
    mediaQuery.addEventListener?.("change", update);
    mediaQuery.addListener?.(update);

    return () => {
      mediaQuery.removeEventListener?.("change", update);
      mediaQuery.removeListener?.(update);
    };
  }, [query]);

  return matches;
}

export function PlanetPage() {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const [searchParams] = useSearchParams();
  const realtimeFetchFn = useMemo(
    () =>
      isFixtureServerUrl(session.serverUrl)
        ? createFixtureFetch(session.serverUrl)
        : undefined,
    [session.serverUrl],
  );
  const { planetId = "" } = useParams();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const restoredViewRef = useRef("");
  const {
    hydrateRecentAlerts,
    hydrateRecentEvents,
    markFullSync,
    recentAlerts,
    recentEvents,
    resetForPlanet,
    sceneWindow,
    setLayers,
    setLastEventId,
    setSelected,
    setZoomIndex,
    zoomIndex,
    requestFocus,
  } = usePlanetViewStore(
    useShallow((state) => ({
      hydrateRecentAlerts: state.hydrateRecentAlerts,
      hydrateRecentEvents: state.hydrateRecentEvents,
      markFullSync: state.markFullSync,
      recentAlerts: state.recentAlerts,
      recentEvents: state.recentEvents,
      resetForPlanet: state.resetForPlanet,
      sceneWindow: state.sceneWindow,
      setLayers: state.setLayers,
      setLastEventId: state.setLastEventId,
      setSelected: state.setSelected,
      setZoomIndex: state.setZoomIndex,
      zoomIndex: state.camera.zoomIndex,
      requestFocus: state.requestFocus,
    })),
  );
  const resetCommandStore = usePlanetCommandStore((state) => state.resetForPlanet);
  const latestCommandEntry = usePlanetCommandStore((state) =>
    getLatestCommandEntry(state.journal),
  );
  const pendingCommandCount = usePlanetCommandStore((state) =>
    getPendingCommandCount(state.journal),
  );
  const activeZoomLevel = getPlanetZoomLevel(zoomIndex);
  const isCompactLayout = useMediaQuery("(max-width: 900px)");
  const [compactPanel, setCompactPanel] = useState<
    "workbench" | "selection" | "activity"
  >("workbench");

  const sceneQuery = useQuery({
    queryKey: [
      "planet-scene",
      session.serverUrl,
      session.playerId,
      planetId,
      sceneWindow.x,
      sceneWindow.y,
      sceneWindow.width,
      sceneWindow.height,
    ],
    queryFn: () => client.fetchPlanetScene(planetId, sceneWindow),
    placeholderData: keepPreviousData,
    enabled: Boolean(planetId),
  });

  const runtimeQuery = useQuery({
    queryKey: ["planet-runtime", session.serverUrl, session.playerId, planetId],
    queryFn: () => client.fetchPlanetRuntime(planetId),
    enabled: Boolean(planetId),
  });

  const systemId = sceneQuery.data?.system_id ?? "";

  const systemQuery = useQuery({
    queryKey: ["system", session.serverUrl, session.playerId, systemId],
    queryFn: () => client.fetchSystem(systemId),
    enabled: Boolean(sceneQuery.data?.system_id),
  });

  const systemRuntimeQuery = useQuery({
    queryKey: [
      "system-runtime",
      session.serverUrl,
      session.playerId,
      systemId,
    ],
    queryFn: () => client.fetchSystemRuntime(systemId),
    enabled: Boolean(sceneQuery.data?.system_id),
  });

  const networksQuery = useQuery({
    queryKey: [
      "planet-networks",
      session.serverUrl,
      session.playerId,
      planetId,
    ],
    queryFn: () => client.fetchPlanetNetworks(planetId),
    enabled: Boolean(planetId),
  });

  const catalogQuery = useQuery({
    queryKey: ["catalog", session.serverUrl, session.playerId],
    queryFn: () => client.fetchCatalog(),
    enabled: Boolean(planetId),
  });

  const summaryQuery = useQuery({
    queryKey: ["summary", session.serverUrl, session.playerId],
    queryFn: () => client.fetchSummary(),
    enabled: Boolean(planetId),
  });

  const statsQuery = useQuery({
    queryKey: ["stats", session.serverUrl, session.playerId],
    queryFn: () => client.fetchStats(),
    enabled: Boolean(planetId),
  });

  const overviewRequestStep = getPlanetOverviewRequestStep(
    zoomIndex,
    sceneQuery.data?.map_width ?? 0,
    sceneQuery.data?.map_height ?? 0,
  );

  const eventQuery = useQuery({
    queryKey: [
      "events-snapshot",
      session.serverUrl,
      session.playerId,
      planetId,
    ],
    queryFn: () =>
      client.fetchEventSnapshot({
        event_types: [...ALL_EVENT_TYPES],
        limit: 30,
      }),
    enabled: Boolean(planetId),
  });

  const alertQuery = useQuery({
    queryKey: [
      "alerts-snapshot",
      session.serverUrl,
      session.playerId,
      planetId,
    ],
    queryFn: () => client.fetchAlertSnapshot({ limit: 20 }),
    enabled: Boolean(planetId),
  });

  const overviewQuery = useQuery({
    queryKey: [
      "planet-overview",
      session.serverUrl,
      session.playerId,
      planetId,
      overviewRequestStep,
    ],
    queryFn: () =>
      client.fetchPlanetOverview(planetId, {
        step: overviewRequestStep ?? 100,
      }),
    enabled: Boolean(planetId) &&
      activeZoomLevel.mode === "overview" &&
      overviewRequestStep !== undefined,
  });

  const { pullMissedEvents } = usePlanetRealtimeSync({
    client,
    fetchFn: realtimeFetchFn,
    serverUrl: session.serverUrl,
    playerId: session.playerId,
    playerKey: session.playerKey,
    planetId,
    systemId,
  });

  useEffect(() => {
    restoredViewRef.current = "";
    resetForPlanet(planetId);
    resetCommandStore(planetId);
    setCompactPanel("workbench");
  }, [planetId, resetCommandStore, resetForPlanet]);

  useEffect(() => {
    if (!sceneQuery.data) {
      return;
    }
    const signature = `${planetId}?${searchParams.toString()}`;
    if (restoredViewRef.current === signature) {
      return;
    }

    const zoomRaw = searchParams.get("zoom");
    if (zoomRaw !== null && zoomRaw.trim() !== "") {
      const zoomParam = Number(zoomRaw);
      if (Number.isFinite(zoomParam)) {
        setZoomIndex(resolvePlanetZoomIndex(zoomParam));
      }
    }

    const layerPatch = parseEnabledLayers(
      searchParams.get("layers"),
      usePlanetViewStore.getState().layers,
    );
    if (layerPatch) {
      setLayers(layerPatch);
    }

    const focusXRaw = searchParams.get("x");
    const focusYRaw = searchParams.get("y");
    if (
      focusXRaw !== null &&
      focusXRaw.trim() !== "" &&
      focusYRaw !== null &&
      focusYRaw.trim() !== ""
    ) {
      const focusX = Number(focusXRaw);
      const focusY = Number(focusYRaw);
      if (Number.isFinite(focusX) && Number.isFinite(focusY)) {
        requestFocus({ x: Math.round(focusX), y: Math.round(focusY) });
      }
    }

    const sharedSelection = resolveSelectionFromQueryValue(
      sceneQuery.data,
      searchParams.get("select"),
    );
    if (sharedSelection) {
      setSelected(sharedSelection);
    }

    restoredViewRef.current = signature;
  }, [
    planetId,
    sceneQuery.data,
    requestFocus,
    searchParams,
    setLayers,
    setSelected,
    setZoomIndex,
  ]);

  useEffect(() => {
    if (!eventQuery.data) {
      return;
    }
    hydrateRecentEvents(eventQuery.data.events);
    const latestEventId =
      eventQuery.data.next_event_id ||
      eventQuery.data.events[0]?.event_id ||
      "";
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
  }, [
    eventQuery.data,
    hydrateRecentAlerts,
    hydrateRecentEvents,
    markFullSync,
    setLastEventId,
  ]);

  useEffect(() => {
    if (!alertQuery.data) {
      return;
    }
    hydrateRecentAlerts(alertQuery.data.alerts);
    markFullSync();
  }, [alertQuery.data, hydrateRecentAlerts, markFullSync]);

  const isLoading = [
    sceneQuery.isLoading,
    activeZoomLevel.mode === "overview" ? overviewQuery.isLoading : false,
    runtimeQuery.isLoading,
    systemQuery.isLoading,
    systemRuntimeQuery.isLoading,
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

  const error =
    sceneQuery.error ||
    (activeZoomLevel.mode === "overview" ? overviewQuery.error : null) ||
    runtimeQuery.error ||
    systemQuery.error ||
    systemRuntimeQuery.error ||
    networksQuery.error ||
    catalogQuery.error ||
    summaryQuery.error ||
    statsQuery.error ||
    eventQuery.error ||
    alertQuery.error;

  if (
    error ||
    !sceneQuery.data ||
    !runtimeQuery.data ||
    !networksQuery.data ||
    !catalogQuery.data
  ) {
    return (
      <div className="panel error-banner" role="alert">
        {error instanceof Error ? error.message : "行星数据加载失败"}
      </div>
    );
  }

  const planet = sceneQuery.data;
  const runtime = runtimeQuery.data;
  const networks = networksQuery.data;
  const catalog = catalogQuery.data;
  const summary = summaryQuery.data;
  const system = systemQuery.data;
  const systemRuntime = systemRuntimeQuery.data;
  const stats = statsQuery.data;
  const currentPlayer = summary?.players?.[session.playerId];
  const mineralSummary = formatMineralInventory(currentPlayer?.inventory);
  const currentResearchName = getTechDisplayName(
    catalog,
    currentPlayer?.tech?.current_research?.tech_id ?? "",
  );
  const detailPanels = (
    <>
      {isCompactLayout ? (
        <div
          aria-label="行星工作台面板"
          className="planet-detail-tabs"
          role="tablist"
        >
          {[
            { id: "workbench", label: "工作台" },
            { id: "selection", label: "选中对象" },
            { id: "activity", label: "活动流" },
          ].map((panel) => (
            <button
              aria-controls={`planet-compact-panel-${panel.id}`}
              aria-selected={compactPanel === panel.id}
              className={
                compactPanel === panel.id
                  ? "secondary-button planet-detail-tabs__tab planet-detail-tabs__tab--active"
                  : "secondary-button planet-detail-tabs__tab"
              }
              id={`planet-compact-tab-${panel.id}`}
              key={panel.id}
              onClick={() =>
                setCompactPanel(
                  panel.id as "workbench" | "selection" | "activity",
                )
              }
              role="tab"
              type="button"
            >
              {panel.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="planet-detail-shell__content">
        {!isCompactLayout || compactPanel === "workbench" ? (
          <div
            hidden={isCompactLayout && compactPanel !== "workbench"}
            id="planet-compact-panel-workbench"
            role={isCompactLayout ? "tabpanel" : undefined}
          >
            <PlanetCommandCenter
              catalog={catalog}
              client={client}
              networks={networks}
              planet={planet}
              runtime={runtime}
              summary={summary}
              system={system}
              systemRuntime={systemRuntime}
            />
          </div>
        ) : null}
        {!isCompactLayout || compactPanel === "selection" ? (
          <div
            hidden={isCompactLayout && compactPanel !== "selection"}
            id="planet-compact-panel-selection"
            role={isCompactLayout ? "tabpanel" : undefined}
          >
            <PlanetEntityPanel
              catalog={catalog}
              fog={planet}
              networks={networks}
              planet={planet}
              runtime={runtime}
              stats={stats}
              summary={summary}
            />
          </div>
        ) : null}
        {isCompactLayout && compactPanel === "activity" ? (
          <div id="planet-compact-panel-activity" role="tabpanel">
            <PlanetActivityPanel
              alerts={recentAlerts}
              events={recentEvents}
              planet={planet}
            />
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="page-grid page-grid--planet">
      <section className="panel page-hero">
        <div className="page-header">
          <p className="eyebrow">T007-T012 行星观察端</p>
          <h1>{planet.name || planet.planet_id}</h1>
          <p className="subtle-text">
            tick {planet.tick} · {translatePlanetKind(planet.kind)} ·{" "}
            {planet.map_width} x {planet.map_height}
          </p>
        </div>
        <div className="hero-actions">
          <div className="hero-chip">矿产 {mineralSummary}</div>
          <div className="hero-chip">
            能量 {currentPlayer?.resources?.energy ?? 0}
          </div>
          <div className="hero-chip">
            电力{" "}
            {stats
              ? `${stats.energy_stats.generation}/${stats.energy_stats.consumption}`
              : "-"}
          </div>
          <div className="hero-chip">研究 {currentResearchName || "无"}</div>
        </div>
      </section>

      <section className="planet-workbench">
        {!isCompactLayout ? (
          <aside className="panel planet-sidebar">
            <PlanetLayerPanel
              networks={networks}
              planet={planet}
              runtime={runtime}
            />
          </aside>
        ) : null}

        <section className="panel planet-map-shell">
          <PlanetMapCanvas
            catalog={catalog}
            fog={planet}
            networks={networks}
            onCanvasReady={(canvas) => {
              canvasRef.current = canvas;
            }}
            overview={overviewQuery.data}
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
              await sceneQuery.refetch();
              markFullSync();
            }}
            onRefreshPlanet={async () => {
              await Promise.all([
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
        </section>

        <aside className="panel planet-detail-shell">
          <PlanetOperationHeader
            activePlanetId={summary?.active_planet_id ?? planet.planet_id}
            latestEntry={latestCommandEntry}
            pendingCount={pendingCommandCount}
            routePlanetId={planet.planet_id}
            routePlanetName={planet.name}
            systemName={system?.name ?? system?.system_id}
          />
          {detailPanels}
        </aside>
      </section>

      {!isCompactLayout ? (
        <PlanetActivityPanel
          alerts={recentAlerts}
          events={recentEvents}
          planet={planet}
        />
      ) : null}
    </div>
  );
}
