import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair, ChevronDown, ChevronRight, Hammer, Factory, ScrollText, type LucideIcon } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ALL_EVENT_TYPES } from "@shared/config";
import type { PlanetSceneView } from "@shared/types";
import { buildPlanetSceneRequest } from "@/features/planet-map/scene-query";

import { Icon } from "@/common/Icon";
import { MapDrawer } from "@/common/MapDrawer";
import {
  PlanetActivityPanel,
  PlanetDebugPanel,
  PlanetEntityPanel,
} from "@/features/planet-map/PlanetPanels";
import { PlanetCommandCenter } from "@/features/planet-commands/PlanetCommandCenter";
import { ProductionPlanner } from "@/features/production/ProductionPlanner";
import { ColonyProgressionPanel } from "@/features/progression/ColonyProgressionPanel";
import { gameIdentityOf } from "@/features/lobby/current-game";
import { useCurrentGameQuery } from "@/features/lobby/use-current-game";
import { normalizeCompletedTechIds } from "@/features/planet-map/research-workflow";
import { PlanetOperationHeader } from "@/features/planet-commands/PlanetOperationHeader";
import { parseCommandWorkflowId, type CommandWorkflowId } from "@/features/planet-map/PlanetCommandPanel";
import {
  getLatestCommandEntry,
  getPendingCommandCount,
  usePlanetCommandStore,
} from "@/features/planet-commands/store";
import { PlanetMapPixi, type PlanetMapCapture } from "@/features/planet-map/PlanetMapPixi";
import { PlanetBuildBar } from "@/features/planet-map/PlanetBuildBar";
import { initialBuildDirection } from "@/features/planet-map/build-workflow";
import { BuildPlacementHint } from "@/features/planet-map/BuildPlacementHint";
import { notifyApproachingThreats } from "@/features/planet-map/attack-alerts";
import { PlanetLayerPanel } from "@/features/planet-map/PlanetPanels";
import { PlanetMapToolbar } from "@/features/planet-map/PlanetMapToolbar";
import { PlanetMinimap } from "@/features/planet-map/PlanetMinimap";
import { PlanetSelectionBar } from "@/features/planet-map/PlanetSelectionBar";
import { WarGuidePanel } from "@/features/onboarding/WarGuidePanel";
import { resolveWarGuide } from "@/features/onboarding/war-guide";
import { ownLegions } from "@/features/planet-map/legion-model";
import { countOutOfAmmoUnits } from "@/features/planet-map/ammo-alert";
import { useMechaJobProgress } from "@/features/planet-map/mecha-job-progress";
import { PlanetLegionPanel } from "@/features/planet-map/PlanetLegionPanel";
import { PlanetTheaterControls } from "@/features/planet-map/PlanetTheaterControls";
import { submitPlanetCommand } from "@/features/planet-commands/executor";
import { reportLocalPreflightBlock } from "@/features/planet-commands/local-preflight";
import { PLANET_COMMAND_RECOVERY_EVENT_TYPES } from "@/features/planet-commands/store";
import type { TheaterZoneGeometry } from "@/features/planet-map/squad-commands";
import { toPlayerFacingMessage } from "@/common/player-facing-error";
import { usePlanetInteractions } from "@/features/planet-map/use-planet-interactions";
import { usePlanetRtsHotkeys } from "@/features/planet-map/use-planet-rts-hotkeys";
import { formatInventorySummary } from "@/features/inventory-summary";
import {
  extractAlertFromEvent,
  parseEnabledLayers,
  resolveHomeTile,
  resolveSelectionFromQueryValue,
  getTechDisplayName,
} from "@/features/planet-map/model";
import { usePlanetRealtimeSync } from "@/features/planet-map/use-planet-realtime";
import { useShellAlerts } from "@/features/production-alerts-query";
import { accumulateOwnEntities, createOwnEntityCache, ownEntitySnapshot } from "@/features/planet-map/own-entity-cache";
import { indexUnitsById } from "@/features/planet-map/rts-commands";
import { useApiClient } from "@/hooks/use-api-client";
import { useSessionSnapshot } from "@/hooks/use-session";
import { translatePlanetKind, translateUi } from "@/i18n/translate";
import { usePlanetViewStore } from "@/features/planet-map/store";
import {
  getPlanetOverviewRequestStep,
  getPlanetZoomLevel,
  PLANET_FOCUS_FIT_ZOOM,
  resolvePlanetZoomIndex,
} from "@/features/planet-map/store";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

const PlanetMapThree = lazy(() => import("@/features/planet-map/PlanetMapThree").then(module => ({ default: module.PlanetMapThree })));
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

type PlanetDetailPanel = "workbench" | "selection" | "production" | "activity";

interface DetailTabConfig {
  id: PlanetDetailPanel;
  /** 桌面端图标 Tab 用的 lucide 图标组件（工作台/选中/活动）。 */
  icon: LucideIcon;
  /** i18n key → 文案（移动端文本 Tab + 桌面端 aria-label 共用）。 */
  labelKey: "planet.tab.workbench" | "planet.tab.selection" | "planet.tab.production" | "planet.tab.activity";
}

const DETAIL_TABS: DetailTabConfig[] = [
  { id: "workbench", icon: Hammer, labelKey: "planet.tab.workbench" },
  { id: "selection", icon: Crosshair, labelKey: "planet.tab.selection" },
  { id: "production", icon: Factory, labelKey: "planet.tab.production" },
  { id: "activity", icon: ScrollText, labelKey: "planet.tab.activity" },
];

export function PlanetPage() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const session = useSessionSnapshot();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const realtimeFetchFn = useMemo(
    () =>
      isFixtureServerUrl(session.serverUrl)
        ? createFixtureFetch(session.serverUrl)
        : undefined,
    [session.serverUrl],
  );
  const { planetId = "" } = useParams();
  const captureRef = useRef<PlanetMapCapture | null>(null);
  // 跨场景窗口的己方实体累积（只增不减）：新手引导是「有没有建过」的历史推导，
  // 不能用只覆盖相机窗口的 sceneQuery 数据——镜头一平移，窗口外的基地就从响应里
  // 消失，引导会从 4/8 回退到 1/8（试玩报告 2026-10-07 阻断级 4）。
  const ownEntityCacheRef = useRef(createOwnEntityCache());
  const restoredViewRef = useRef("");
  const {
    hydrateRecentAlerts,
    hydrateRecentEvents,
    markFullSync,
    recentAlerts,
    recentEvents,
    resetForPlanet,
    sceneWindow,
    selected,
    setLayers,
    setLastEventId,
    setSelected,
    setZoomIndex,
    setInteractionMode,
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
      selected: state.selected,
      setLayers: state.setLayers,
      setLastEventId: state.setLastEventId,
      setSelected: state.setSelected,
      setZoomIndex: state.setZoomIndex,
      setInteractionMode: state.setInteractionMode,
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
  const isThree = searchParams.get("view") !== "2d";
  const isCompactLayout = useMediaQuery("(max-width: 900px)");
  const [activeDetailPanel, setActiveDetailPanel] = useState<PlanetDetailPanel>(
    "workbench",
  );
  // 右侧工作台抽屉：默认收起为边缘把手；点选实体/新命令回执时自动滑出。
  const [drawerOpen, setDrawerOpen] = useState(false);
  const buildBarDocked = usePlanetViewStore((state) => state.buildBarDocked);
  const setBuildBarDocked = usePlanetViewStore((state) => state.setBuildBarDocked);
  // 抽屉打开时建造栏自动收起（覆盖式抽屉会压住右下角建造卡片）；关闭时不自动展开，
  // 尊重玩家手动收起的意图。buildBarDocked 是 store 状态，供 PlanetBuildBar 渲染把手。
  const toggleDrawer = useCallback((open: boolean) => {
    setDrawerOpen(open);
    if (open) {
      setBuildBarDocked(true);
    }
  }, [setBuildBarDocked]);
  // 左上行星胶囊（§3.2）：默认收成一行（名称 · 电力 · 研究），展开才看详情与「生产规划」。
  // 默认收起是因为它常驻在左上角地图上——展开态的四张资源芯片会盖掉一块可点区域。
  const [titleChipCollapsed, setTitleChipCollapsed] = useState(true);
  // 胶囊实测底边写进 :root：左上「新手引导 + 军团」栈据此下移，保证与胶囊垂直堆叠、
  // 留 8px 间距（3D 壳的 --planet-top-inset 与 2D 不同，写死偏移会在 3D 下压住胶囊下沿）。
  //
  // 用**回调 ref** 而不是「ref + useLayoutEffect」：行星数据到达前页面先渲染一版骨架，
  // 那时 effect 已经跑过一次（ref 还是 null），而 deps 不会再变，于是永远量不到胶囊，
  // 引导条就压在胶囊下沿上（§3.2 复核 2 的成因）。回调 ref 在节点真正挂载时才执行。
  // ResizeObserver 只报尺寸变化，所以再挂一个 window.resize 兜底视口变化。
  const titleChipRef = useRef<HTMLDivElement | null>(null);
  const titleChipObserverRef = useRef<ResizeObserver | null>(null);
  const publishTitleChipBottom = useCallback((node: HTMLDivElement | null) => {
    titleChipObserverRef.current?.disconnect();
    titleChipObserverRef.current = null;
    titleChipRef.current = node;
    if (!node) {
      return;
    }
    const publish = () => {
      const shell = node.closest(".planet-map-shell");
      if (!shell) {
        return;
      }
      const bottom = node.getBoundingClientRect().bottom - shell.getBoundingClientRect().top;
      document.documentElement.style.setProperty("--planet-title-chip-bottom", `${Math.round(bottom)}px`);
    };
    publish();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(publish);
      observer.observe(node);
      titleChipObserverRef.current = observer;
    }
  }, []);
  useEffect(() => {
    const onResize = () => {
      const node = titleChipRef.current;
      const shell = node?.closest(".planet-map-shell");
      if (!node || !shell) {
        return;
      }
      const bottom = node.getBoundingClientRect().bottom - shell.getBoundingClientRect().top;
      document.documentElement.style.setProperty("--planet-title-chip-bottom", `${Math.round(bottom)}px`);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      titleChipObserverRef.current?.disconnect();
    };
  }, []);

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
    queryFn: () => {
      const knownPlanet = queryClient.getQueriesData<PlanetSceneView>({
        queryKey: ["planet-scene", session.serverUrl, session.playerId, planetId],
      }).find(([, data]) => data !== undefined)?.[1];
      return client.fetchPlanetScene(planetId, buildPlanetSceneRequest(sceneWindow, knownPlanet));
    },
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

  // tick 速率是运行参数（server.tick_rate_override 可覆盖存档设置）：
  // 机甲剩余时间换算必须用 /games/current 的 max_tick_rate，不能用写死的 10。
  const currentGameQuery = useCurrentGameQuery();
  // 机甲批量进度（主界面常驻横幅 + 完成通知）：与 scene/catalog 同源，
  // 放在 query 定义之后、任何早返回之前，避免 hooks 出现在条件分支后。
  const mechaJob = useMechaJobProgress(catalogQuery.data, sceneQuery.data, session.playerId, currentGameQuery.data?.max_tick_rate ?? 0);

  const summaryQuery = useQuery({
    queryKey: ["summary", session.serverUrl, session.playerId],
    queryFn: () => client.fetchSummary(),
    enabled: Boolean(planetId),
    refetchInterval: 2000,
  });

  const statsQuery = useQuery({
    queryKey: ["stats", session.serverUrl, session.playerId],
    queryFn: () => client.fetchStats(),
    enabled: Boolean(planetId),
  });

  // C4 军事 UI：小队右键部署（任务群归属）/战区拖拽划定/小队卡片的蓝图解析。
  // SSE 失效由各自命令提交点负责，这里给低频兜底轮询。
  const taskForcesQuery = useQuery({
    queryKey: ["war-task-forces", session.serverUrl, session.playerId],
    queryFn: () => client.fetchWarTaskForces(),
    enabled: Boolean(planetId),
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  const theatersQuery = useQuery({
    queryKey: ["war-theaters", session.serverUrl, session.playerId],
    queryFn: () => client.fetchWarTheaters(),
    enabled: Boolean(planetId),
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  const warBlueprintsQuery = useQuery({
    queryKey: ["war-blueprints", session.serverUrl, session.playerId],
    queryFn: () => client.fetchWarfareBlueprints(),
    enabled: Boolean(planetId),
  });

  /**
   * 缩略图右键下令的本地拦截回执（无选中单位 / 未编组小队）：
   * 与 use-planet-interactions 的 reportLocalBlock 共用 local-preflight 同一条路径
   * （journal 失败条目 + 全局 danger toast），让「右键缩略图没反应」变成一个
   * 可见的失败提示而不是静默（试玩 1014 层 01 P1）。
   */
  function reportMinimapBlock(message: string, position: { x: number; y: number }) {
    reportLocalPreflightBlock("move", planet.planet_id, message, { position: { ...position, z: 0 } });
  }

  /**
   * 工作台命令结算后立刻重取 summary（装料表单的背包数量/按钮禁用判定读它）。
   * 只靠 2s 轮询 + SSE 失效会出现「背包够料却灰着，重开抽屉才恢复」（试玩 1014 层 12 P2）。
   */
  function refetchSummaryAfterCommand() {
    void summaryQuery.refetch();
  }

  /**
   * 建筑详情 → 工作台直达入口（试玩 1014 层 12：「装入建筑/切换配方/量产」藏得太深）。
   * 只切抽屉页签 + ?workflow= 深链：PlanetCommandPanel 已按 ?workflow= 同步命令 Tab，
   * 不需要第二套跳转协议。
   */
  function openWorkflow(workflow: CommandWorkflowId) {
    setActiveDetailPanel("workbench");
    toggleDrawer(true);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("workflow", workflow);
      return next;
    }, { replace: true });
  }

  /** C4：theater_zone 拖拽落点 → theater_define_zone（planet_id+position+radius）。 */
  function handleDefineZone(zone: TheaterZoneGeometry) {
    const mode = usePlanetViewStore.getState().interactionMode;
    if (mode.kind !== "theater_zone" || !planetId) {
      return;
    }
    void submitPlanetCommand({
      commandType: "theater_define_zone",
      planetId,
      focus: { position: zone.position },
      execute: () => client.cmdTheaterDefineZone(mode.theaterId, {
        zoneType: mode.zoneType,
        planetId,
        position: zone.position,
        radius: zone.radius,
      }),
      fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({
        event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
        limit: 50,
      }),
    }).then(() => {
      void theatersQuery.refetch();
    });
    // 保持划定模式，便于连续画多个区域（右键/Esc 退出，对齐建造模式）
  }

  // 每来一帧窗口数据就并入累积缓存；引导只看这份历史（见 own-entity-cache 注释）。
  // 放在 useMemo 里而不是 effect：ref 更新不会触发重渲染，写在 effect 里引导会晚一帧且可能一直不更新。
  // 对局标识（started_at::map_seed）一起作为失效条件：同一行星开新局时实体 id 会复用，
  // 只按 planetId 判断会用上一局的建筑点亮新手引导。
  // 同一份缓存也喂给命令选择器（commandableUnitIds）：/scene 只返回相机窗口内的实体，
  // 镜头移开后被选中的单位会掉出窗口，右键就成了静默无命令（试玩 1010 E）。
  const gameIdentity = currentGameQuery.data ? gameIdentityOf(currentGameQuery.data) : '';
  const guideEntities = useMemo(
    () => ownEntitySnapshot(accumulateOwnEntities(ownEntityCacheRef.current, sceneQuery.data, session.playerId, gameIdentity)),
    [sceneQuery.data, session.playerId, gameIdentity],
  );

  /*
   * 换局（读档存档点 / 管理员开新局）时把行星页的本地交互状态一起复位。
   *
   * 试玩 1012 问题 3：连读两次存档后建造卡「点了没反应」——planetId 没变，上面的
   * planetId effect 不跑，上一局的残留状态就活到了新局：
   * - interactionMode 停在 build：点卡片只是「选中另一个建筑」，地图上不会放置；
   * - buildBarDocked 停在 true：建造栏只剩一行把手，看起来就像卡片消失/失灵；
   * - drawerOpen/activeDetailPanel 停在上一局的抽屉；
   * - PlanetCommandPanel 的表单（装入建筑/生产/物流参数等）留着上一局选中的建筑 id，
   *   新局里该 id 已不存在，提交只会静默失败——工作台内容区用 key 按对局身份重挂载。
   * 首次拿到对局概要时 identity 由空串变成实际值，只做一次无副作用的重挂载。
   */
  useEffect(() => {
    if (!gameIdentity) {
      return;
    }
    restoredViewRef.current = "";
    resetForPlanet(planetId);
    resetCommandStore(planetId);
    setActiveDetailPanel("workbench");
    toggleDrawer(false);
  }, [gameIdentity, planetId, resetCommandStore, resetForPlanet]);
  const knownOwnUnits = useMemo(() => indexUnitsById(guideEntities.units), [guideEntities.units]);
  // 「家」按累积的己方实体算（不随镜头窗口丢失），供聚焦基地/回到基地共用。
  useEffect(() => {
    const scene = sceneQuery.data;
    if (!scene) return;
    const home = resolveHomeTile({
      ...scene,
      buildings: Object.fromEntries(guideEntities.buildings.map((building) => [building.id, building])),
      units: Object.fromEntries(guideEntities.units.map((unit) => [unit.id, unit])),
    }, session.playerId);
    if (home) usePlanetViewStore.getState().setHomeTile(home);
  }, [guideEntities, sceneQuery.data, session.playerId]);

  const interactions = usePlanetInteractions({
    catalog: catalogQuery.data,
    inventory: summaryQuery.data?.players?.[session.playerId]?.inventory,
    planet: sceneQuery.data,
    runtime: runtimeQuery.data,
    knownOwnUnits,
    taskForces: taskForcesQuery.data?.task_forces,
    onTaskForceDeployed: () => { void taskForcesQuery.refetch(); },
  });

  // 敌袭预警：敌对单位逼近己方建筑（20 格）时告警 + 小地图闪点（中立黑雾不报）
  const darkFogHostile = summaryQuery.data?.players?.[session.playerId]?.dark_fog?.hostile ?? false;
  useEffect(() => {
    if (sceneQuery.data && session.playerId) {
      notifyApproachingThreats(sceneQuery.data, session.playerId, darkFogHostile);
    }
  }, [sceneQuery.data, session.playerId, darkFogHostile]);

  // RTS 快捷键体系（C1）：A/S/H/P/G + Ctrl/数字编队，2D/3D 共用（输入框聚焦自动忽略）
  usePlanetRtsHotkeys({
    planet: sceneQuery.data,
    runtime: runtimeQuery.data,
    knownOwnUnits,
    interactions,
  });

  const overviewRequestStep = getPlanetOverviewRequestStep(
    isThree ? 2 : zoomIndex,
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

  /**
   * 地图标记用的「当前仍成立的告警」：与顶栏/警报条同一份快照
   * （`useShellAlerts`，limit 50，已滤研究站噪音）。
   *
   * 不用上面那份 limit=20 的补拉：它按告警**首现顺序**取最早 20 条，
   * 老对局里早被常态告警占满，新出现的 `belt_blocked` 根本不在里面，
   * 地图上于是没有红杠（试玩 1016 复现）。20 条那份继续负责活动流的首次回填。
   */
  const { alerts: liveAlerts } = useShellAlerts();

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
      (isThree || activeZoomLevel.mode === "overview") &&
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
    toggleDrawer(false);
  }, [planetId, resetCommandStore, resetForPlanet]);

  // 抽屉只由玩家点开；点选实体时预先切到"选中对象" Tab，打开时即见详情。
  useEffect(() => {
    if (selected && (selected.kind === "building" || selected.kind === "unit" || selected.kind === "squad")) {
      setActiveDetailPanel("selection");
    }
  }, [selected]);

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
    } else {
      // 首次进入（无深链坐标）：相机聚焦玩家基地并自适应占屏（小图放到 60-80%），避免全图漆黑找不到家。
      const home = resolveHomeTile(sceneQuery.data, session.playerId);
      if (home) {
        requestFocus(home, PLANET_FOCUS_FIT_ZOOM);
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

    // 深链 build=<buildingType>：进入建造模式（对标总览「下一步」开局引导）
    const buildType = searchParams.get("build");
    if (buildType && buildType.trim() !== "") {
      setInteractionMode({
        kind: "build",
        buildingType: buildType.trim(),
        direction: initialBuildDirection(buildType.trim()),
      });
    }

    // 深链 workflow=research|logistics|dyson…：打开工作台并落到对应命令 Tab
    const workflowRaw = searchParams.get("workflow");
    if (workflowRaw && workflowRaw.trim() !== "") {
      // 校验合法 id（非法时仍打开抽屉，子面板回落 basic）
      parseCommandWorkflowId(workflowRaw);
      setActiveDetailPanel("workbench");
      toggleDrawer(true);
    }

    restoredViewRef.current = signature;
  }, [
    planetId,
    sceneQuery.data,
    requestFocus,
    searchParams,
    session.playerId,
    setInteractionMode,
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
    !isThree && activeZoomLevel.mode === "overview" ? overviewQuery.isLoading : false,
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
        {error instanceof Error ? toPlayerFacingMessage(error.message) : "行星数据加载失败"}
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
  const liveTick = Math.max(summary?.tick ?? 0, planet.tick);
  const inventorySummary = formatInventorySummary(currentPlayer?.inventory);
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
                <tab.icon size={18} strokeWidth={2} />
              </span>
              {isCompactLayout ? (
                <span className="planet-detail-tabs__text">{label}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="planet-detail-shell__content" key={gameIdentity || "pending"}>
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
              onCommandSettled={refetchSummaryAfterCommand}
            />
          </div>
        ) : null}
        {activeDetailPanel === "selection" ? (
          <div id="planet-detail-panel-selection" role="tabpanel">
            <PlanetEntityPanel
              blueprints={warBlueprintsQuery.data?.blueprints}
              catalog={catalog}
              fog={planet}
              knownOwnUnits={knownOwnUnits}
              networks={networks}
              onOpenWorkflow={openWorkflow}
              planet={planet}
              runtime={runtime}
              stats={stats}
              summary={summary}
              taskForces={taskForcesQuery.data?.task_forces}
              tickRate={currentGameQuery.data?.max_tick_rate}
            />
          </div>
        ) : null}
        {activeDetailPanel === "production" ? (
          <div id="planet-detail-panel-production" role="tabpanel">
            <ProductionPlanner
              key={planet.planet_id}
              catalog={catalog}
              buildings={planet.buildings}
              playerId={session.playerId}
              completedTechs={normalizeCompletedTechIds(currentPlayer?.tech)}
              onFocusBuilding={building => {
                setSelected({ kind: "building", id: building.id, position: building.position });
                requestFocus(building.position);
                setActiveDetailPanel("selection");
              }}
              onBuildRecipe={(buildingType, recipeId) => {
                setInteractionMode({ kind: "build", buildingType, recipeId, direction: initialBuildDirection(buildingType) });
                toggleDrawer(false);
              }}
            />
            {/* 戴森式长线发展路线：遭遇战之外的进阶内容，默认折叠，不和新手引导抢主线 */}
            <details className="planet-advanced-progression">
              <summary>进阶：长线发展路线</summary>
            <ColonyProgressionPanel
              key={planet.planet_id}
              catalog={catalog}
              planet={planet}
              player={currentPlayer}
              runtime={runtime}
              systemRuntime={systemRuntime}
              onNavigate={to => {
                const destination = new URL(to, window.location.origin);
                if (destination.pathname !== `/planet/${encodeURIComponent(planet.planet_id)}`) {
                  navigate(to);
                  return;
                }
                setSearchParams(previous => {
                  const next = new URLSearchParams(previous);
                  next.delete("build");
                  next.delete("workflow");
                  destination.searchParams.forEach((value, key) => next.set(key, value));
                  return next;
                });
                const buildingType = destination.searchParams.get("build");
                if (buildingType) setInteractionMode({ kind: "build", buildingType, direction: initialBuildDirection(buildingType) });
                setActiveDetailPanel("workbench");
                toggleDrawer(true);
              }}
            />
            </details>
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
    <div className="page-grid page-grid--map">
      <section className={`panel planet-map-shell${isThree ? " planet-map-shell--3d" : ""}`}>
        <Suspense fallback={<div className="panel">正在加载 3D 行星...</div>}>
        {isThree ? <PlanetMapThree
          key={planet.planet_id}
          alerts={liveAlerts}
          catalog={catalog}
          inventory={summary?.players?.[session.playerId]?.inventory}
          darkFogHostile={darkFogHostile}
          fog={planet}
          networks={networks}
          onCanvasReady={(capture) => { captureRef.current = capture; }}
          onContextTile={interactions.contextTile}
          onInteractTile={interactions.interactTile}
          onSelectEntity={() => {
            setActiveDetailPanel("selection");
            toggleDrawer(true);
          }}
          overview={overviewQuery.data}
          planet={planet}
          runtime={runtime}
          theaters={theatersQuery.data?.theaters}
          /* 3D 左下那一列的「图层与视角」与 2D 工具条是**同一份**面板：
             两个视图各维护一套图层开关时，勾选状态与文案会漂移（§3.2 复核）。 */
          layerPanel={<PlanetLayerPanel networks={networks} planet={planet} runtime={runtime} />}
        /> : <PlanetMapPixi
          alerts={liveAlerts}
          catalog={catalog}
          inventory={summary?.players?.[session.playerId]?.inventory}
          darkFogHostile={darkFogHostile}
          fog={planet}
          networks={networks}
          onCanvasReady={(capture) => {
            captureRef.current = capture;
          }}
          onContextTile={interactions.contextTile}
          onDefineZone={handleDefineZone}
          onInteractTile={interactions.interactTile}
          overview={overviewQuery.data}
          planet={planet}
          runtime={runtime}
          theaters={theatersQuery.data?.theaters}
        />}
        </Suspense>
        <BuildPlacementHint catalog={catalog} inventory={summary?.players?.[session.playerId]?.inventory} planet={planet} playerId={session.playerId} runtime={runtime} />
        <div className="planet-view-switch" aria-label="地图视图">
          {isThree && systemId && <Link className="secondary-button" to={`/system/${systemId}?planet=${planet.planet_id}`}>恒星系 ↗</Link>}
          <button className="secondary-button" aria-pressed={isThree} onClick={() => setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete("view"); return next; }, { replace: true })}>3D 星球</button>
          <button className="secondary-button" aria-pressed={!isThree} onClick={() => setSearchParams(previous => { const next = new URLSearchParams(previous); next.set("view", "2d"); return next; }, { replace: true })}>平面战术</button>
        </div>
        {/* 左上行星胶囊（§3.2）：默认一行「名称 · 电力 · 研究」，点开才展开原详情与「生产规划」。
            收起态不再压住左上角地图，展开态才铺开四张资源芯片。 */}
        <div
          className={
            titleChipCollapsed
              ? "planet-title-chip planet-title-chip--collapsed"
              : "planet-title-chip"
          }
          ref={publishTitleChipBottom}
        >
          <div className="planet-title-chip__head">
            <h1>{planet.name || planet.planet_id}</h1>
            <span className="planet-title-chip__inline" aria-hidden={titleChipCollapsed ? undefined : true}>
              <span className="planet-title-chip__inline-item">
                <Icon iconKey="ray_receiver" color="#39e6d0" size={14} />
                {stats
                  ? `${stats.energy_stats.generation}/${stats.energy_stats.consumption}`
                  : "-"}
              </span>
              <span className="planet-title-chip__inline-item">
                <Icon iconKey="lab" color="#5fb0ff" size={14} />
                {currentResearchName || "无"}
              </span>
            </span>
            <button
              aria-expanded={!titleChipCollapsed}
              aria-label={titleChipCollapsed ? "展开行星信息" : "折叠行星信息"}
              className="planet-title-chip__toggle"
              onClick={() => setTitleChipCollapsed((collapsed) => !collapsed)}
              title={titleChipCollapsed ? "展开行星信息" : "折叠行星信息"}
              type="button"
            >
              <span aria-hidden="true">
                {titleChipCollapsed ? (
                  <ChevronRight size={14} strokeWidth={2} />
                ) : (
                  <ChevronDown size={14} strokeWidth={2} />
                )}
              </span>
            </button>
            {/* tick / 星球类型 / 尺寸只在展开态显示：收起态是一行胶囊
                （名称 · 电力 · 研究），多这一行会让「PLANET-1-1」折成两行。 */}
            {titleChipCollapsed ? null : (
              <p className="subtle-text">
                {/* 场景只在相关事件后重取，tick 以 2s 轮询的 summary 为准 */}
                <span className="tick-pulse" key={`hero-tick-${liveTick}`}>
                  tick {liveTick}
                </span>
                {" · "}
                {translatePlanetKind(planet.kind)} ·{" "}
                {planet.map_width} x {planet.map_height}
              </p>
            )}
          </div>
          {titleChipCollapsed ? null : (
            <>
              <div className="planet-title-chip__chips">
                <div
                  className="hero-chip"
                  title={`电网结余（只读展示）· 背包库存：${inventorySummary}`}
                >
                  <Icon iconKey="tesla_tower" color="#ffb454" size={18} />
                  <span>电网结余 {currentPlayer?.resources?.energy ?? 0}</span>
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
              <div className="planet-management-actions" aria-label="工业发展">
                <button className="secondary-button" onClick={() => { setActiveDetailPanel("production"); toggleDrawer(true); }}>
                  <Factory size={13} aria-hidden="true" /> 生产规划
                </button>
              </div>
            </>
          )}
        </div>
        <div className="planet-map-shell__overlay">
          <PlanetSelectionBar
            catalog={catalog}
            onShowDetail={() => {
              setActiveDetailPanel("selection");
              toggleDrawer(true);
            }}
            planet={planet}
            squads={runtime.combat_squads}
          />
          <PlanetBuildBar
            catalog={catalog}
            onExpand={() => {
              // 窄屏：抽屉是覆盖式的，展开建造栏会与抽屉抢同一块底部空间（必然重叠），
              // 让抽屉让位；宽屏选择条/建造栏本就右移让出抽屉宽度，保持抽屉不动。
              if (isCompactLayout) {
                setDrawerOpen(false);
              }
            }}
            planet={planet}
            summary={summary}
            dimensional={isThree}
          />
        </div>
        {/* 小地图（C3）：2D/3D 均可用；3D 下无视口框（mapProjection 缺省优雅降级），敌我标记层照常。
            左键=移镜头（requestFocus），右键=RTS 标准「给选中单位下移动/攻击命令到该格」。 */}
        <PlanetMinimap
          fog={planet}
          onAttackMove={interactions.attackMove}
          onContextTile={interactions.contextTile}
          onOrderBlocked={reportMinimapBlock}
          overview={overviewQuery.data}
          planet={planet}
          runtime={runtime}
        />
        <PlanetDebugPanel
          capture={captureRef.current}
          catalog={catalog}
          currentTick={planet.tick}
          game={currentGameQuery.data}
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
        {/* 工具条（C3）：2D 的左下图标列；3D 由 PlanetMapThree 自带的同构列渲染
            （dimensional 时整条返回 null，避免左下出现两列重复图标）。
            战区划定（C4）作为这一列的最后一格：2D 拖矩形建 zone；
            3D 不渲染——球面拖拽是旋转，划不出矩形（§3.2 复核）。 */}
        <PlanetMapToolbar
          dimensional={isThree}
          networks={networks}
          onOpenSelection={() => {
            setActiveDetailPanel("selection");
            toggleDrawer(true);
          }}
          planet={planet}
          runtime={runtime}
        >
          {isThree ? null : (
            <PlanetTheaterControls
              dimensional={false}
              onChanged={() => { void theatersQuery.refetch(); }}
              planetId={planet.planet_id}
              theaters={theatersQuery.data?.theaters ?? []}
            />
          )}
        </PlanetMapToolbar>
        {countOutOfAmmoUnits(planet.units, session.playerId) > 0 ? (
          <div className="planet-ammo-alert" role="alert" data-testid="planet-ammo-alert">
            {countOutOfAmmoUnits(planet.units, session.playerId)} 个单位弹药耗尽：请补给或建造补给站
          </div>
        ) : null}
        {/* 机甲手搓/采集批量进度：主界面常驻，不必展开机甲详情（试玩报告 #8） */}
        {mechaJob ? (
          <div className="planet-mecha-job" data-testid="planet-mecha-job" role="status">
            <span className="planet-mecha-job__title">
              {mechaJob.title} · 已完成 {mechaJob.completed} / {mechaJob.total}
            </span>
            <progress
              aria-label="机甲批量进度"
              className="planet-mecha-job__bar"
              max={Math.max(1, mechaJob.total)}
              value={mechaJob.completed}
            />
            <span className="planet-mecha-job__meta">
              预计剩余 {mechaJob.remainingLabel}
              {mechaJob.stateLabel ? ` · ${mechaJob.stateLabel}` : ""}
            </span>
          </div>
        ) : null}
        {/* 军团列表（3.4）：编队入口、一键选中、进攻/防守/撤退/补给优先、解散 */}
        <div className="planet-left-stack">
          <WarGuidePanel
            guide={resolveWarGuide({
              playerId: session.playerId,
              buildings: guideEntities.buildings,
              units: [...guideEntities.units, ...guideEntities.fogUnits],
              legions: ownLegions(runtime.combat_squads, session.playerId),
              playerInventory: currentPlayer?.inventory,
              tech: currentPlayer?.tech,
              catalog,
              darkFogHostile,
            })}
          />
          <PlanetLegionPanel planetId={planet.planet_id} squads={runtime.combat_squads} units={planet.units} />
        </div>
        {/* 右侧工作台抽屉：默认收起为边缘把手，点击/选中实体/新回执时滑出（共用 MapDrawer） */}
        <MapDrawer
          label="工作台"
          onToggle={() => toggleDrawer(!drawerOpen)}
          open={drawerOpen}
          reserveBottom
        >
          {activeDetailPanel === "production" ? (
            <div className="planet-management-context">
              <strong>{planet.name || planet.planet_id}</strong>
              <span>工业生产</span>
            </div>
          ) : <PlanetOperationHeader
            activePlanetId={summary?.active_planet_id ?? planet.planet_id}
            latestEntry={latestCommandEntry}
            pendingCount={pendingCommandCount}
            routePlanetId={planet.planet_id}
            routePlanetName={planet.name}
            systemName={system?.name ?? system?.system_id}
          />}
          {detailPanels}
        </MapDrawer>
      </section>
    </div>
  );
}
