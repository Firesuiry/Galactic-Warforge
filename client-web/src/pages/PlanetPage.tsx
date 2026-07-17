import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";

import { ALL_EVENT_TYPES } from "@shared/config";

import { Icon } from "@/common/Icon";
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
import { PlanetBuildBar } from "@/features/planet-map/PlanetBuildBar";
import { PlanetMinimap } from "@/features/planet-map/PlanetMinimap";
import { PlanetSelectionBar } from "@/features/planet-map/PlanetSelectionBar";
import { usePlanetInteractions } from "@/features/planet-map/use-planet-interactions";
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
import { translatePlanetKind, translateUi } from "@/i18n/translate";
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

type PlanetDetailPanel = "workbench" | "selection" | "activity";

interface DetailTabConfig {
  id: PlanetDetailPanel;
  /** 桌面端图标 Tab 用的 emoji 字形（工作台🛠️/选中🎯/活动📜）。 */
  glyph: string;
  /** i18n key → 文案（移动端文本 Tab + 桌面端 aria-label 共用）。 */
  labelKey: "planet.tab.workbench" | "planet.tab.selection" | "planet.tab.activity";
}

const DETAIL_TABS: DetailTabConfig[] = [
  { id: "workbench", glyph: "🛠️", labelKey: "planet.tab.workbench" },
  { id: "selection", glyph: "🎯", labelKey: "planet.tab.selection" },
  { id: "activity", glyph: "📜", labelKey: "planet.tab.activity" },
];

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
  const [activeDetailPanel, setActiveDetailPanel] = useState<PlanetDetailPanel>(
    "workbench",
  );

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

  const handleInteractTile = usePlanetInteractions({
    catalog: catalogQuery.data,
    planet: sceneQuery.data,
    runtime: runtimeQuery.data,
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
    setActiveDetailPanel("workbench");
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
      // 深链直达选中实体：自动切到"选中对象" Tab，让用户立刻看到详情
      setActiveDetailPanel("selection");
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
      <div
        aria-label="行星工作台面板"
        className={
          isCompactLayout
            ? "planet-detail-tabs"
            : "planet-detail-tabs planet-detail-tabs--icon"
        }
        role="tablist"
      >
        {DETAIL_TABS.map((tab) => {
          const label = translateUi(tab.labelKey);
          const isActive = activeDetailPanel === tab.id;
          return (
            <button
              aria-controls={`planet-detail-panel-${tab.id}`}
              aria-label={label}
              aria-selected={isActive}
              className={
                isActive
                  ? "secondary-button planet-detail-tabs__tab planet-detail-tabs__tab--active"
                  : "secondary-button planet-detail-tabs__tab"
              }
              id={`planet-detail-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveDetailPanel(tab.id)}
              role="tab"
              title={label}
              type="button"
            >
              <span aria-hidden="true" className="planet-detail-tabs__glyph">
                {tab.glyph}
              </span>
              {isCompactLayout ? (
                <span className="planet-detail-tabs__text">{label}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="planet-detail-shell__content">
        {activeDetailPanel === "workbench" ? (
          <div id="planet-detail-panel-workbench" role="tabpanel">
            <PlanetCommandCenter
              catalog={catalog}
              client={client}
              planet={planet}
              runtime={runtime}
              summary={summary}
              system={system}
              systemRuntime={systemRuntime}
            />
          </div>
        ) : null}
        {activeDetailPanel === "selection" ? (
          <div id="planet-detail-panel-selection" role="tabpanel">
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
        {activeDetailPanel === "activity" ? (
          <div id="planet-detail-panel-activity" role="tabpanel">
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
          <h1>{planet.name || planet.planet_id}</h1>
          <p className="subtle-text">
            <span className="tick-pulse" key={`hero-tick-${planet.tick}`}>
              tick {planet.tick}
            </span>
            {" · "}
            {translatePlanetKind(planet.kind)} ·{" "}
            {planet.map_width} x {planet.map_height}
          </p>
        </div>
        <div className="hero-actions">
          <div className="hero-chip">
            <Icon iconKey="iron_ore" color="#c9a06a" size={18} />
            <span>矿产 {mineralSummary}</span>
          </div>
          <div className="hero-chip">
            <Icon iconKey="tesla_tower" color="#ffb454" size={18} />
            <span>能量 {currentPlayer?.resources?.energy ?? 0}</span>
          </div>
          <div className="hero-chip">
            <Icon iconKey="ray_receiver" color="#39e6d0" size={18} />
            <span>
              电力{" "}
              {stats
                ? `${stats.energy_stats.generation}/${stats.energy_stats.consumption}`
                : "-"}
            </span>
          </div>
          <div className="hero-chip">
            <Icon iconKey="lab" color="#5fb0ff" size={18} />
            <span>研究 {currentResearchName || "无"}</span>
          </div>
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
            onInteractTile={handleInteractTile}
            overview={overviewQuery.data}
            planet={planet}
            runtime={runtime}
          />
          <div className="planet-map-shell__overlay">
            <PlanetSelectionBar catalog={catalog} planet={planet} />
            <PlanetBuildBar catalog={catalog} planet={planet} summary={summary} />
          </div>
          <PlanetMinimap
            fog={planet}
            overview={overviewQuery.data}
            planet={planet}
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
    </div>
  );
}
