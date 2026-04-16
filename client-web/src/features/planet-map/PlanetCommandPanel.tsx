import { useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_GALAXY_ID, DEFAULT_SYSTEM_ID } from "@shared/config";
import type { ApiClient } from "@shared/api";
import type {
  CatalogView,
  CommandResponse,
  PlanetNetworksView,
  PlanetRuntimeView,
  StateSummary,
  SystemRuntimeView,
  SystemView,
} from "@shared/types";

import { submitPlanetCommand } from "@/features/planet-commands/executor";
import {
  findLogisticsStation,
  formatPosition,
  formatItemInventorySummary,
  getBuildingDisplayName,
  getItemDisplayName,
  isLogisticsStationBuildingType,
  listOwnLogisticsStations,
  type PlanetRenderView,
} from "@/features/planet-map/model";
import {
  buildStarterGuide,
  deriveResearchGroups,
  getResearchProgressPercent,
  normalizeCompletedTechIds,
} from "@/features/planet-map/research-workflow";
import { deriveBuildWorkflowView } from "@/features/planet-map/build-workflow";
import { deriveMoveWorkflowView } from "@/features/planet-map/move-workflow";
import {
  PLANET_COMMAND_RECOVERY_EVENT_TYPES,
  usePlanetCommandStore,
  type CommandJournalFocus,
  type PlanetCommandJournalEntry,
} from "@/features/planet-commands/store";
import { usePlanetViewStore } from "@/features/planet-map/store";
import {
  translateCommandType,
  translateDirection,
  translateLogisticsMode,
  translateLogisticsScope,
  translateTechId,
  translateUi,
  translateUnitType,
} from "@/i18n/translate";

interface PlanetCommandPanelProps {
  catalog?: CatalogView;
  client: ApiClient;
  networks?: PlanetNetworksView;
  planet: PlanetRenderView;
  runtime?: PlanetRuntimeView;
  summary?: StateSummary;
  system?: SystemView;
  systemRuntime?: SystemRuntimeView;
}

type LogisticsScope = "planetary" | "interstellar";
type LogisticsMode = "none" | "supply" | "demand" | "both";
type CommandWorkflowId =
  | "basic"
  | "research"
  | "logistics"
  | "cross_planet"
  | "dyson";

const COMMAND_WORKFLOWS: Array<{
  id: CommandWorkflowId;
  label: string;
  description: string;
}> = [
  {
    id: "basic",
    label: "基础操作",
    description: "扫描、建造、移动和拆除都放在同一条开局操作链里。",
  },
  {
    id: "research",
    label: "研究与装料",
    description: "先看研究状态，再直接给研究站、发射建筑或其他建筑装料。",
  },
  {
    id: "logistics",
    label: "物流",
    description: "物流站总配置和槽位配置合并到同一条站点管理工作流。",
  },
  {
    id: "cross_planet",
    label: "跨星球",
    description: "先确认观察行星与 active planet，再切换命令上下文。",
  },
  {
    id: "dyson",
    label: "戴森",
    description: "把节点、框架、壳层、发射与射线接收站收口在戴森主链里。",
  },
];

function toOptionalInt(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getScopeSettings(
  runtime: PlanetRuntimeView | undefined,
  buildingId: string,
  scope: LogisticsScope,
) {
  const station = findLogisticsStation(runtime, buildingId);
  if (!station?.state) {
    return undefined;
  }
  return scope === "interstellar"
    ? station.state.interstellar_settings
    : station.state.settings;
}

function getPreferredSlotItemId(
  runtime: PlanetRuntimeView | undefined,
  buildingId: string,
  scope: LogisticsScope,
  fallbackItemId: string,
) {
  const settings = getScopeSettings(runtime, buildingId, scope);
  return Object.values(settings ?? {})[0]?.item_id ?? fallbackItemId;
}

function isResearchBuildingType(buildingType: string) {
  return buildingType === "matrix_lab" || buildingType === "self_evolution_lab";
}

function fieldLabel(key: string) {
  return translateUi(`field.${key}`);
}

function journalTone(entry: PlanetCommandJournalEntry) {
  if (entry.status === "failed") {
    return "error";
  }
  if (entry.status === "succeeded") {
    return "ok";
  }
  return "pending";
}

export function PlanetCommandPanel({
  catalog,
  client,
  networks,
  planet,
  runtime,
  summary,
  system,
  systemRuntime,
}: PlanetCommandPanelProps) {
  const selected = usePlanetViewStore((state) => state.selected);
  const journal = usePlanetCommandStore((state) => state.journal);
  const latestEntry = usePlanetCommandStore((state) => state.journal[0]);
  const playerId = client.getAuth().playerId;
  const [activeWorkflow, setActiveWorkflow] = useState<CommandWorkflowId>("basic");
  const [scanGalaxyId, setScanGalaxyId] = useState(DEFAULT_GALAXY_ID);
  const [scanSystemId, setScanSystemId] = useState(DEFAULT_SYSTEM_ID);
  const [buildX, setBuildX] = useState(0);
  const [buildY, setBuildY] = useState(0);
  const [buildingType, setBuildingType] = useState("");
  const [buildDirection, setBuildDirection] = useState<
    "north" | "east" | "south" | "west" | "auto"
  >("auto");
  const [showAdvancedBuild, setShowAdvancedBuild] = useState(false);
  const [recipeId, setRecipeId] = useState("");
  const [moveUnitId, setMoveUnitId] = useState("");
  const [moveX, setMoveX] = useState(0);
  const [moveY, setMoveY] = useState(0);
  const [researchId, setResearchId] = useState("");
  const [demolishId, setDemolishId] = useState("");
  const [stationConfigBuildingId, setStationConfigBuildingId] = useState("");
  const [slotConfigBuildingId, setSlotConfigBuildingId] = useState("");
  const [droneCapacity, setDroneCapacity] = useState("");
  const [inputPriority, setInputPriority] = useState("");
  const [outputPriority, setOutputPriority] = useState("");
  const [interstellarEnabled, setInterstellarEnabled] = useState(false);
  const [warpEnabled, setWarpEnabled] = useState(false);
  const [shipSlots, setShipSlots] = useState("");
  const [slotScope, setSlotScope] = useState<LogisticsScope>("planetary");
  const [slotItemId, setSlotItemId] = useState("");
  const [slotMode, setSlotMode] = useState<LogisticsMode>("supply");
  const [slotLocalStorage, setSlotLocalStorage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [transferBuildingId, setTransferBuildingId] = useState("");
  const [transferItemId, setTransferItemId] = useState("");
  const [transferQuantity, setTransferQuantity] = useState("10");
  const [switchPlanetId, setSwitchPlanetId] = useState("");
  const [switchPlanetManualId, setSwitchPlanetManualId] = useState("");
  const [rayReceiverBuildingId, setRayReceiverBuildingId] = useState("");
  const [rayReceiverMode, setRayReceiverMode] = useState<
    "power" | "photon" | "hybrid"
  >("power");
  const [launchMode, setLaunchMode] = useState<"solar_sail" | "rocket">(
    "solar_sail",
  );
  const [launchBuildingId, setLaunchBuildingId] = useState("");
  const [launchCount, setLaunchCount] = useState("1");
  const [launchOrbitRadius, setLaunchOrbitRadius] = useState("1.2");
  const [launchInclination, setLaunchInclination] = useState("5");
  const [launchLayerIndex, setLaunchLayerIndex] = useState("0");
  const [dysonBuildType, setDysonBuildType] = useState<
    "build_dyson_node" | "build_dyson_frame" | "build_dyson_shell"
  >("build_dyson_node");
  const [dysonSystemId, setDysonSystemId] = useState("");
  const [dysonLayerIndex, setDysonLayerIndex] = useState("0");
  const [dysonLatitude, setDysonLatitude] = useState("10");
  const [dysonLongitude, setDysonLongitude] = useState("20");
  const [dysonOrbitRadius, setDysonOrbitRadius] = useState("1.2");
  const [dysonNodeAId, setDysonNodeAId] = useState("");
  const [dysonNodeBId, setDysonNodeBId] = useState("");
  const [dysonLatitudeMin, setDysonLatitudeMin] = useState("-15");
  const [dysonLatitudeMax, setDysonLatitudeMax] = useState("15");
  const [dysonCoverage, setDysonCoverage] = useState("0.4");
  const currentResearchId =
    summary?.players?.[playerId]?.tech?.current_research?.tech_id ?? "";
  const playerTechState = summary?.players?.[playerId]?.tech;
  const currentSystemId =
    planet.system_id ??
    system?.system_id ??
    systemRuntime?.system_id ??
    DEFAULT_SYSTEM_ID;

  const ownBuildings = useMemo(
    () =>
      Object.values(planet.buildings ?? {}).filter(
        (building) => building.owner_id === playerId,
      ),
    [planet.buildings, playerId],
  );
  const ownUnits = useMemo(
    () =>
      Object.values(planet.units ?? {}).filter(
        (unit) => unit.owner_id === playerId,
      ),
    [planet.units, playerId],
  );
  const ownLogisticsStations = useMemo(
    () => listOwnLogisticsStations(planet, runtime, playerId),
    [planet, runtime, playerId],
  );
  const logisticsItems = useMemo(
    () =>
      [...(catalog?.items ?? [])].sort((left, right) =>
        left.name.localeCompare(right.name, "zh-CN"),
      ),
    [catalog?.items],
  );
  const completedTechIds = useMemo(
    () => new Set(normalizeCompletedTechIds(playerTechState)),
    [playerTechState],
  );
  const photonModeUnlocked = completedTechIds.has("dirac_inversion");
  const buildWorkflow = useMemo(
    () => deriveBuildWorkflowView({
      catalog,
      buildingType,
      journal,
      networks,
      planet,
      playerId,
      selectedPosition: { x: buildX, y: buildY, z: 0 },
      summary,
    }),
    [
      buildX,
      buildY,
      buildingType,
      catalog,
      journal,
      networks,
      planet,
      playerId,
      summary,
    ],
  );
  const moveWorkflow = useMemo(
    () =>
      deriveMoveWorkflowView({
        planet,
        targetPosition: { x: moveX, y: moveY, z: 0 },
        unitId: moveUnitId,
      }),
    [moveUnitId, moveX, moveY, planet],
  );
  const visibleBuildOptions = useMemo(
    () => [
      ...buildWorkflow.catalog.recommended,
      ...buildWorkflow.catalog.unlocked,
      ...(showAdvancedBuild ? buildWorkflow.catalog.locked : []),
      ...(showAdvancedBuild ? buildWorkflow.catalog.debugOnly : []),
    ],
    [buildWorkflow.catalog, showAdvancedBuild],
  );
  const recipesForBuilding = useMemo(
    () =>
      [...(catalog?.recipes ?? [])]
        .filter((recipe) => recipe.building_types?.includes(buildingType))
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    [buildingType, catalog?.recipes],
  );
  const researchGroups = useMemo(
    () => deriveResearchGroups(catalog, playerTechState),
    [catalog, playerTechState],
  );
  const starterGuide = useMemo(
    () => buildStarterGuide(playerTechState),
    [playerTechState],
  );
  const switchablePlanets = useMemo(
    () => [...(system?.planets ?? [])].sort((left, right) =>
      (left.name ?? left.planet_id).localeCompare(
        right.name ?? right.planet_id,
        "zh-CN",
      ),
    ),
    [system?.planets],
  );
  const transferTargets = useMemo(
    () =>
      ownBuildings.filter(
        (building) =>
          !isLogisticsStationBuildingType(building.type) ||
          Boolean(building.storage?.inventory),
      ),
    [ownBuildings],
  );
  const rayReceiverBuildings = useMemo(
    () => ownBuildings.filter((building) => building.type === "ray_receiver"),
    [ownBuildings],
  );
  const solarSailLaunchers = useMemo(
    () => ownBuildings.filter((building) => building.type === "em_rail_ejector"),
    [ownBuildings],
  );
  const rocketLaunchers = useMemo(
    () =>
      ownBuildings.filter(
        (building) => building.type === "vertical_launching_silo",
      ),
    [ownBuildings],
  );
  const rayReceiverModeOptions = useMemo(
    () => [
      { value: "power", label: "power · 电网回灌", disabled: false },
      { value: "hybrid", label: "hybrid · 发电 + 光子", disabled: false },
      {
        value: "photon",
        label: photonModeUnlocked
          ? "photon · 光子优先"
          : `photon · 未解锁（需 ${translateTechId("dirac_inversion")}）`,
        disabled: !photonModeUnlocked,
      },
    ] as const,
    [photonModeUnlocked],
  );
  const dysonLayers = useMemo(
    () =>
      [...(systemRuntime?.dyson_sphere?.layers ?? [])].sort(
        (left, right) => left.layer_index - right.layer_index,
      ),
    [systemRuntime?.dyson_sphere?.layers],
  );
  const activeDysonLayer = useMemo(
    () =>
      dysonLayers.find(
        (layer) => String(layer.layer_index) === dysonLayerIndex,
      ) ?? dysonLayers[0],
    [dysonLayerIndex, dysonLayers],
  );
  const dysonNodes = useMemo(
    () => [...(activeDysonLayer?.nodes ?? [])],
    [activeDysonLayer],
  );
  const selectedLogisticsStationId = useMemo(() => {
    if (selected?.kind !== "building") {
      return "";
    }
    const building = (planet.buildings ?? {})[selected.id];
    if (
      !building ||
      building.owner_id !== playerId ||
      !isLogisticsStationBuildingType(building.type)
    ) {
      return "";
    }
    return findLogisticsStation(runtime, selected.id) ? selected.id : "";
  }, [planet.buildings, playerId, runtime, selected]);
  const stationConfigStation = useMemo(
    () => findLogisticsStation(runtime, stationConfigBuildingId),
    [runtime, stationConfigBuildingId],
  );
  const slotConfigStation = useMemo(
    () => findLogisticsStation(runtime, slotConfigBuildingId),
    [runtime, slotConfigBuildingId],
  );
  const stationConfigSupportsInterstellar =
    stationConfigStation?.building_type === "interstellar_logistics_station";
  const slotConfigSupportsInterstellar =
    slotConfigStation?.building_type === "interstellar_logistics_station";
  const slotScopeOptions = slotConfigSupportsInterstellar
    ? ["planetary", "interstellar"]
    : ["planetary"];
  const previousSlotConfigContextRef = useRef("");
  const previousSlotSettingsContextRef = useRef("");
  const selectedOwnedBuildingId =
    selected?.kind === "building" &&
    ownBuildings.some((building) => building.id === selected.id)
      ? selected.id
      : "";
  const selectedResearch = useMemo(
    () =>
      researchGroups.available.find((tech) => tech.id === researchId)
      ?? researchGroups.available[0]
      ?? null,
    [researchGroups.available, researchId],
  );
  const selectedTransferBuilding = useMemo(
    () =>
      transferTargets.find((building) => building.id === transferBuildingId)
      ?? transferTargets[0]
      ?? null,
    [transferBuildingId, transferTargets],
  );
  const currentResearchProgressPercent = getResearchProgressPercent(
    playerTechState?.current_research,
  );

  useEffect(() => {
    if (visibleBuildOptions.length === 0) {
      if (buildingType) {
        setBuildingType("");
      }
      return;
    }
    if (!visibleBuildOptions.some((entry) => entry.id === buildingType)) {
      setBuildingType(visibleBuildOptions[0].id);
    }
  }, [buildingType, visibleBuildOptions]);

  useEffect(() => {
    const nextResearchId = researchGroups.available[0]?.id ?? "";
    if (!nextResearchId && researchId) {
      setResearchId("");
      return;
    }
    if (
      nextResearchId &&
      !researchGroups.available.some((tech) => tech.id === researchId)
    ) {
      setResearchId(nextResearchId);
    }
  }, [researchGroups.available, researchId]);

  useEffect(() => {
    if (scanSystemId === DEFAULT_SYSTEM_ID && currentSystemId) {
      setScanSystemId(currentSystemId);
    }
    if (!dysonSystemId && currentSystemId) {
      setDysonSystemId(currentSystemId);
    }
  }, [currentSystemId, dysonSystemId, scanSystemId]);

  useEffect(() => {
    if (selected?.position) {
      setBuildX(selected.position.x);
      setBuildY(selected.position.y);
      setMoveX(selected.position.x);
      setMoveY(selected.position.y);
    }
    if (selected?.kind === "building") {
      setDemolishId(selected.id);
    }
    if (selected?.kind === "unit") {
      setMoveUnitId(selected.id);
    }
  }, [selected]);

  useEffect(() => {
    if (selectedOwnedBuildingId) {
      setTransferBuildingId(selectedOwnedBuildingId);
      if (
        rayReceiverBuildings.some(
          (building) => building.id === selectedOwnedBuildingId,
        )
      ) {
        setRayReceiverBuildingId(selectedOwnedBuildingId);
      }
      if (
        solarSailLaunchers.some(
          (building) => building.id === selectedOwnedBuildingId,
        ) ||
        rocketLaunchers.some((building) => building.id === selectedOwnedBuildingId)
      ) {
        setLaunchBuildingId(selectedOwnedBuildingId);
      }
    }
  }, [
    rayReceiverBuildings,
    rocketLaunchers,
    selectedOwnedBuildingId,
    solarSailLaunchers,
  ]);

  useEffect(() => {
    if (selectedLogisticsStationId) {
      setStationConfigBuildingId(selectedLogisticsStationId);
      setSlotConfigBuildingId(selectedLogisticsStationId);
    }
  }, [selectedLogisticsStationId]);

  useEffect(() => {
    const fallbackId = ownLogisticsStations[0]?.building_id ?? "";
    if (
      !selectedLogisticsStationId &&
      !ownLogisticsStations.some(
        (station) => station.building_id === stationConfigBuildingId,
      )
    ) {
      setStationConfigBuildingId(fallbackId);
    }
    if (
      !selectedLogisticsStationId &&
      !ownLogisticsStations.some(
        (station) => station.building_id === slotConfigBuildingId,
      )
    ) {
      setSlotConfigBuildingId(fallbackId);
    }
  }, [
    ownLogisticsStations,
    selectedLogisticsStationId,
    slotConfigBuildingId,
    stationConfigBuildingId,
  ]);

  useEffect(() => {
    const state = stationConfigStation?.state;
    setDroneCapacity(
      state?.drone_capacity !== undefined ? String(state.drone_capacity) : "",
    );
    setInputPriority(
      state?.priority.input !== undefined ? String(state.priority.input) : "",
    );
    setOutputPriority(
      state?.priority.output !== undefined ? String(state.priority.output) : "",
    );
    if (stationConfigSupportsInterstellar) {
      setInterstellarEnabled(Boolean(state?.interstellar.enabled));
      setWarpEnabled(Boolean(state?.interstellar.warp_enabled));
      setShipSlots(
        state?.interstellar.ship_slots !== undefined
          ? String(state.interstellar.ship_slots)
          : "",
      );
      return;
    }
    setInterstellarEnabled(false);
    setWarpEnabled(false);
    setShipSlots("");
  }, [stationConfigStation, stationConfigSupportsInterstellar]);

  useEffect(() => {
    if (!slotConfigSupportsInterstellar && slotScope !== "planetary") {
      setSlotScope("planetary");
    }
  }, [slotConfigSupportsInterstellar, slotScope]);

  useEffect(() => {
    const fallbackItemId = logisticsItems[0]?.id ?? "";
    const preferredItemId = getPreferredSlotItemId(
      runtime,
      slotConfigBuildingId,
      slotScope,
      fallbackItemId,
    );
    const slotConfigContext = `${slotConfigBuildingId}:${slotScope}`;
    const selectionStillAvailable =
      slotItemId !== "" &&
      logisticsItems.some((item) => item.id === slotItemId);

    if (
      previousSlotConfigContextRef.current !== slotConfigContext ||
      !selectionStillAvailable
    ) {
      setSlotItemId(preferredItemId);
    }

    previousSlotConfigContextRef.current = slotConfigContext;
  }, [
    logisticsItems,
    runtime,
    slotConfigBuildingId,
    slotItemId,
    slotScope,
  ]);

  useEffect(() => {
    const settings = getScopeSettings(runtime, slotConfigBuildingId, slotScope);
    const setting = slotItemId ? settings?.[slotItemId] : undefined;
    const slotSettingsContext =
      `${slotConfigBuildingId}:${slotScope}:${slotItemId}`;

    if (previousSlotSettingsContextRef.current !== slotSettingsContext) {
      if (setting) {
        setSlotMode(setting.mode);
        setSlotLocalStorage(String(setting.local_storage));
      } else {
        setSlotMode("supply");
        setSlotLocalStorage("");
      }
    }

    previousSlotSettingsContextRef.current = slotSettingsContext;
  }, [runtime, slotConfigBuildingId, slotItemId, slotScope]);

  useEffect(() => {
    if (!switchPlanetId && summary?.active_planet_id) {
      setSwitchPlanetId(summary.active_planet_id);
    }
  }, [summary?.active_planet_id, switchPlanetId]);

  useEffect(() => {
    if (!transferBuildingId && transferTargets.length > 0) {
      setTransferBuildingId(transferTargets[0].id);
    }
  }, [transferBuildingId, transferTargets]);

  useEffect(() => {
    const preferredMatrixItemId =
      logisticsItems.find((item) => item.id === "electromagnetic_matrix")?.id ??
      logisticsItems[0]?.id ??
      "";
    const activeTransferBuilding =
      transferTargets.find((building) => building.id === transferBuildingId) ??
      transferTargets[0];
    const nextTransferItemId =
      activeTransferBuilding && isResearchBuildingType(activeTransferBuilding.type)
        ? preferredMatrixItemId
        : logisticsItems[0]?.id ?? "";

    if (
      nextTransferItemId &&
      (!transferItemId ||
        !logisticsItems.some((item) => item.id === transferItemId) ||
        activeTransferBuilding?.type === "matrix_lab")
    ) {
      setTransferItemId(nextTransferItemId);
    }
  }, [logisticsItems, transferBuildingId, transferItemId, transferTargets]);

  useEffect(() => {
    if (
      rayReceiverBuildings.length > 0 &&
      !rayReceiverBuildings.some(
        (building) => building.id === rayReceiverBuildingId,
      )
    ) {
      setRayReceiverBuildingId(rayReceiverBuildings[0].id);
    }
  }, [rayReceiverBuildingId, rayReceiverBuildings]);

  useEffect(() => {
    if (!photonModeUnlocked && rayReceiverMode === "photon") {
      setRayReceiverMode("power");
    }
  }, [photonModeUnlocked, rayReceiverMode]);

  useEffect(() => {
    const nextLaunchers =
      launchMode === "solar_sail" ? solarSailLaunchers : rocketLaunchers;
    if (
      nextLaunchers.length > 0 &&
      !nextLaunchers.some((building) => building.id === launchBuildingId)
    ) {
      setLaunchBuildingId(nextLaunchers[0].id);
    }
  }, [launchBuildingId, launchMode, rocketLaunchers, solarSailLaunchers]);

  useEffect(() => {
    if (dysonLayers.length > 0) {
      const firstLayerIndex = String(dysonLayers[0].layer_index);
      if (
        !dysonLayers.some((layer) => String(layer.layer_index) === dysonLayerIndex)
      ) {
        setDysonLayerIndex(firstLayerIndex);
      }
      if (
        !dysonLayers.some((layer) => String(layer.layer_index) === launchLayerIndex)
      ) {
        setLaunchLayerIndex(firstLayerIndex);
      }
    }
  }, [dysonLayerIndex, dysonLayers, launchLayerIndex]);

  useEffect(() => {
    if (dysonNodes.length === 0) {
      setDysonNodeAId("");
      setDysonNodeBId("");
      return;
    }
    if (!dysonNodes.some((node) => node.id === dysonNodeAId)) {
      setDysonNodeAId(dysonNodes[0].id);
    }
    if (!dysonNodes.some((node) => node.id === dysonNodeBId)) {
      setDysonNodeBId(dysonNodes[Math.min(1, dysonNodes.length - 1)]?.id ?? "");
    }
  }, [dysonNodeAId, dysonNodeBId, dysonNodes]);

  const latestResultTone =
    latestEntry?.status === "failed"
      ? "error"
      : latestEntry?.status === "succeeded"
        ? "ok"
        : "pending";
  const latestResultMessage = latestEntry
    ? latestEntry.status === "pending"
      ? `${translateCommandType(latestEntry.commandType)} 已受理：${latestEntry.acceptedMessage}`
      : latestEntry.authoritativeMessage ?? latestEntry.acceptedMessage
    : "";
  const recentEntries = journal.slice(0, 5);

  function getBuildOptionLabel(entry: (typeof visibleBuildOptions)[number]) {
    const displayName = entry.name || getBuildingDisplayName(catalog, entry.id);
    if (entry.visibility === "locked") {
      return `${displayName} · 未解锁`;
    }
    if (entry.visibility === "debugOnly") {
      return `${displayName} · 目录异常`;
    }
    return `${displayName} · ${entry.id}`;
  }

  function formatTerrainLabel(terrain: string) {
    switch (terrain) {
      case "buildable":
        return "可建造地块";
      case "blocked":
        return "障碍地块";
      case "water":
        return "水域";
      case "lava":
        return "岩浆";
      default:
        return terrain;
    }
  }

  function formatWaypointChain(positions: Array<{ x: number; y: number; z?: number }>) {
    return positions
      .map((position) =>
        formatPosition({ x: position.x, y: position.y, z: position.z ?? 0 }),
      )
      .join(" -> ");
  }

  function describeBlockedTile(
    tile: NonNullable<typeof buildWorkflow.tileAssessment>["blockedTiles"][number],
  ) {
    if (tile.reason === "terrain") {
      return `${formatPosition({ x: tile.x, y: tile.y, z: 0 })} 为${formatTerrainLabel(tile.terrain)}`;
    }
    if (tile.reason === "building") {
      return `${formatPosition({ x: tile.x, y: tile.y, z: 0 })} 已被建筑 ${tile.buildingId} 占用`;
    }
    return `${formatPosition({ x: tile.x, y: tile.y, z: 0 })} 已被资源点 ${tile.resourceId} 占用`;
  }

  function renderHintDetail(detail: string) {
    const lines = detail
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length <= 1) {
      return detail;
    }
    return lines[lines.length - 1];
  }

  async function runCommand(
    actionLabel: string,
    execute: () => Promise<CommandResponse>,
    options: {
      planetId?: string;
      focus?: CommandJournalFocus;
    } = {},
  ) {
    setBusyAction(actionLabel);
    try {
      await submitPlanetCommand({
        commandType: actionLabel,
        planetId: options.planetId ?? planet.planet_id,
        focus: options.focus,
        execute,
        fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({
          event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
          limit: 50,
        }),
        recoveryTimeoutMs: 1600,
      });
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="planet-panel-stack">
      <section className="planet-side-section">
        <div className="section-title">命令工作流</div>
        <p className="subtle-text">
          所有操作都走同一套 `/commands` authoritative 契约，但界面改成按玩家实际操作链来分组。
        </p>
        {latestEntry ? (
          <div
            className={
              latestResultTone === "ok"
                ? "command-result command-result--ok"
                : latestResultTone === "error"
                  ? "command-result command-result--error"
                  : "command-result command-result--pending"
            }
          >
            <strong>{latestResultMessage}</strong>
            {latestEntry.nextHint ? (
              <div className="subtle-text">{latestEntry.nextHint}</div>
            ) : null}
          </div>
        ) : null}
        <div
          aria-label="工作流"
          className="planet-command-workflows"
          role="tablist"
        >
          {COMMAND_WORKFLOWS.map((workflow) => (
            <button
              aria-controls={`planet-workflow-panel-${workflow.id}`}
              aria-selected={activeWorkflow === workflow.id}
              className={
                activeWorkflow === workflow.id
                  ? "secondary-button planet-command-workflows__tab planet-command-workflows__tab--active"
                  : "secondary-button planet-command-workflows__tab"
              }
              id={`planet-workflow-tab-${workflow.id}`}
              key={workflow.id}
              onClick={() => setActiveWorkflow(workflow.id)}
              role="tab"
              type="button"
            >
              {workflow.label}
            </button>
          ))}
        </div>
        <p className="subtle-text">
          {COMMAND_WORKFLOWS.find((workflow) => workflow.id === activeWorkflow)
            ?.description}
        </p>
      </section>

      <section className="planet-side-section">
        <div className="section-title">最近结果</div>
        {recentEntries.length > 0 ? (
          <ul className="timeline-list timeline-list--dense planet-command-history">
            {recentEntries.map((entry) => (
              <li key={entry.requestId}>
                <div className="timeline-list__row">
                  <strong>
                    {translateCommandType(entry.commandType)} ·{" "}
                    {entry.status === "pending"
                      ? "待回写"
                      : entry.status === "succeeded"
                        ? "成功"
                        : "失败"}
                  </strong>
                  <span
                    className={`command-history-status command-history-status--${journalTone(entry)}`}
                  >
                    {entry.requestId}
                  </span>
                </div>
                <span>
                  {entry.status === "pending"
                    ? entry.acceptedMessage
                    : entry.authoritativeMessage ?? entry.acceptedMessage}
                </span>
                {entry.nextHint ? (
                  <span className="subtle-text">{entry.nextHint}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="subtle-text">最近还没有 authoritative 命令结果。</p>
        )}
      </section>

      {activeWorkflow === "basic" ? (
        <>
      <section
        aria-labelledby="planet-workflow-tab-basic"
        className="planet-side-section"
        id="planet-workflow-panel-basic"
        role="tabpanel"
      >
        <div className="section-title">扫描</div>
        <div className="compact-form-grid">
          <label className="field">
            <span>{fieldLabel("galaxy_id")}</span>
            <input
              onChange={(event) => setScanGalaxyId(event.target.value)}
              value={scanGalaxyId}
            />
          </label>
          <button
            className="secondary-button"
            disabled={busyAction !== ""}
            onClick={() => {
              void runCommand("scan_galaxy", () =>
                client.cmdScanGalaxy(scanGalaxyId),
              );
            }}
            type="button"
          >
            扫描银河
          </button>

          <label className="field">
            <span>{fieldLabel("system_id")}</span>
            <input
              onChange={(event) => setScanSystemId(event.target.value)}
              value={scanSystemId}
            />
          </label>
          <button
            className="secondary-button"
            disabled={busyAction !== ""}
            onClick={() => {
              void runCommand("scan_system", () =>
                client.cmdScanSystem(scanSystemId),
              );
            }}
            type="button"
          >
            扫描星系
          </button>

          <label className="field">
            <span>{fieldLabel("planet_id")}</span>
            <input readOnly value={planet.planet_id} />
          </label>
          <button
            className="secondary-button"
            disabled={busyAction !== ""}
            onClick={() => {
              void runCommand("scan_planet", () =>
                client.cmdScanPlanet(planet.planet_id),
              );
            }}
            type="button"
          >
            扫描当前行星
          </button>
        </div>
      </section>

      <section className="planet-side-section">
        <div className="section-title">建造</div>
        <div className="build-workflow-header">
          <button
            className="secondary-button"
            onClick={() => setShowAdvancedBuild((value) => !value)}
            type="button"
          >
            {showAdvancedBuild ? "隐藏高级建造" : "显示高级建造"}
          </button>
          <span className="subtle-text">
            默认只暴露已解锁主流程建筑；高级模式才显示未解锁与目录异常项。
          </span>
        </div>
        <div className="build-preflight">
          <div className="section-title section-title--minor">建造前检查</div>
          {buildWorkflow.reachability.executorUnitId ? (
            <div className="build-preflight__summary">
              <span>
                执行体 {buildWorkflow.reachability.executorUnitId}
              </span>
              <span>
                distance / operateRange = {buildWorkflow.reachability.distance ?? "-"} /{" "}
                {buildWorkflow.reachability.operateRange ?? "-"}
              </span>
            </div>
          ) : (
            <p className="subtle-text">当前没有可用执行体，无法做距离预检。</p>
          )}
          {buildWorkflow.tileAssessment ? (
            <div className="build-preflight__summary">
              <span>
                目标地形 {formatTerrainLabel(buildWorkflow.tileAssessment.terrain)}
              </span>
              <span>
                {buildWorkflow.tileAssessment.buildable
                  ? "当前地块可直接建造"
                  : "当前地块不可直接建造"}
              </span>
            </div>
          ) : null}
          {buildWorkflow.tileAssessment?.blockedTiles.map((tile) => (
            <div className="subtle-text" key={`${tile.reason}:${tile.x}:${tile.y}`}>
              {describeBlockedTile(tile)}
            </div>
          ))}
          {buildWorkflow.preflightHints.map((hint) => (
            <div
              className={`command-inline-hint command-inline-hint--${hint.tone}`}
              key={hint.title}
            >
              <strong>{hint.title}</strong>
              <div className="subtle-text">{renderHintDetail(hint.detail)}</div>
              {hint.suggestedAction === "move_executor" ? (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setActiveWorkflow("basic");
                    if (buildWorkflow.reachability.executorUnitId) {
                      setMoveUnitId(buildWorkflow.reachability.executorUnitId);
                    }
                    const landing =
                      buildWorkflow.approachPlan?.firstWaypoint
                      ?? buildWorkflow.approachPlan?.landingPosition;
                    setMoveX(landing?.x ?? buildX);
                    setMoveY(landing?.y ?? buildY);
                  }}
                  type="button"
                >
                  切到移动工作流
                </button>
              ) : null}
            </div>
          ))}
          {buildWorkflow.approachPlan?.landingPosition ? (
            <div className="command-inline-hint command-inline-hint--warning">
              <strong>
                建议落点 {formatPosition(buildWorkflow.approachPlan.landingPosition)}
              </strong>
              <div className="subtle-text">
                目标还差 {buildWorkflow.approachPlan.distanceGap ?? 0} 格操作距离；
                推荐移动路线{" "}
                {formatWaypointChain(buildWorkflow.approachPlan.waypoints)}
              </div>
            </div>
          ) : null}
          {buildWorkflow.postBuildHints.map((hint) => (
            <div
              className={`command-inline-hint command-inline-hint--${hint.tone}`}
              key={`${hint.title}:${hint.detail}`}
            >
              <strong>{hint.title}</strong>
              <div className="subtle-text">{renderHintDetail(hint.detail)}</div>
            </div>
          ))}
        </div>
        <div className="compact-form-grid">
          <label className="field">
            <span>{fieldLabel("x")}</span>
            <input
              onChange={(event) => setBuildX(Number(event.target.value) || 0)}
              type="number"
              value={buildX}
            />
          </label>
          <label className="field">
            <span>{fieldLabel("y")}</span>
            <input
              onChange={(event) => setBuildY(Number(event.target.value) || 0)}
              type="number"
              value={buildY}
            />
          </label>
          <label className="field field--span-2">
            <span>{fieldLabel("building_type")}</span>
            <select
              onChange={(event) => setBuildingType(event.target.value)}
              value={buildingType}
            >
              {visibleBuildOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {getBuildOptionLabel(entry)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{fieldLabel("direction")}</span>
            <select
              onChange={(event) =>
                setBuildDirection(event.target.value as typeof buildDirection)
              }
              value={buildDirection}
            >
              <option value="auto">{translateDirection("auto")}</option>
              <option value="north">{translateDirection("north")}</option>
              <option value="east">{translateDirection("east")}</option>
              <option value="south">{translateDirection("south")}</option>
              <option value="west">{translateDirection("west")}</option>
            </select>
          </label>
          <label className="field">
            <span>{fieldLabel("recipe_id")}</span>
            <select
              onChange={(event) => setRecipeId(event.target.value)}
              value={recipeId}
            >
              <option value="">无</option>
              {recipesForBuilding.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.name} · {recipe.id}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button field--span-2"
            disabled={busyAction !== "" || !buildingType}
            onClick={() => {
              void runCommand("build", () =>
                client.cmdBuild({ x: buildX, y: buildY, z: 0 }, buildingType, {
                  direction: buildDirection,
                  ...(recipeId ? { recipeId } : {}),
                }),
                {
                  focus: {
                    buildingType,
                    position: { x: buildX, y: buildY, z: 0 },
                  },
                },
              );
            }}
            type="button"
          >
            发送建造命令
          </button>
        </div>
      </section>

      <section className="planet-side-section">
        <div className="section-title">移动</div>
        <div className="build-preflight">
          <div className="section-title section-title--minor">移动前检查</div>
          {moveWorkflow.unitPosition ? (
            <div className="build-preflight__summary">
              <span>单位 {moveWorkflow.unitId}</span>
              <span>
                distance / moveRange = {moveWorkflow.distance ?? "-"} /{" "}
                {moveWorkflow.moveRange ?? "-"}
              </span>
            </div>
          ) : (
            <p className="subtle-text">先选择单位，地图选点会直接回填目标坐标。</p>
          )}
          {moveWorkflow.unitPosition && moveWorkflow.inRange ? (
            <div className="subtle-text">当前目标一步可达，可直接提交移动命令。</div>
          ) : null}
          {moveWorkflow.firstWaypoint ? (
            <div className="command-inline-hint command-inline-hint--warning">
              <strong>建议先走第一跳 {formatPosition(moveWorkflow.firstWaypoint)}</strong>
              <div className="subtle-text">
                目标还差 {moveWorkflow.distanceGap ?? 0} 格移动距离；推荐路线{" "}
                {formatWaypointChain(moveWorkflow.waypoints)}
              </div>
              <button
                className="secondary-button"
                onClick={() => {
                  setMoveX(moveWorkflow.firstWaypoint?.x ?? moveX);
                  setMoveY(moveWorkflow.firstWaypoint?.y ?? moveY);
                }}
                type="button"
              >
                填入第一跳
              </button>
            </div>
          ) : null}
        </div>
        <div className="compact-form-grid">
          <label className="field field--span-2">
            <span>{fieldLabel("unit_id")}</span>
            <select
              onChange={(event) => setMoveUnitId(event.target.value)}
              value={moveUnitId}
            >
              <option value="">选择单位</option>
              {ownUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.id} · {translateUnitType(unit.type)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{fieldLabel("x")}</span>
            <input
              onChange={(event) => setMoveX(Number(event.target.value) || 0)}
              type="number"
              value={moveX}
            />
          </label>
          <label className="field">
            <span>{fieldLabel("y")}</span>
            <input
              onChange={(event) => setMoveY(Number(event.target.value) || 0)}
              type="number"
              value={moveY}
            />
          </label>
          <button
            className="secondary-button field--span-2"
            disabled={busyAction !== "" || !moveUnitId}
            onClick={() => {
              void runCommand("move", () =>
                client.cmdMove(moveUnitId, { x: moveX, y: moveY, z: 0 }),
                {
                  focus: {
                    entityId: moveUnitId,
                    position: { x: moveX, y: moveY, z: 0 },
                  },
                },
              );
            }}
            type="button"
          >
            移动单位
          </button>
        </div>
      </section>

      <section className="planet-side-section">
        <div className="section-title">拆除</div>
        <div className="compact-form-grid">
          <label className="field field--span-2">
            <span>{fieldLabel("building_id")}</span>
            <select
              onChange={(event) => setDemolishId(event.target.value)}
              value={demolishId}
            >
              <option value="">选择建筑</option>
              {ownBuildings.map((building) => (
                <option key={building.id} value={building.id}>
                  {building.id} · {building.type}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button field--span-2"
            disabled={busyAction !== "" || !demolishId}
            onClick={() => {
              void runCommand("demolish", () => client.cmdDemolish(demolishId), {
                focus: {
                  entityId: demolishId,
                },
              });
            }}
            type="button"
          >
            拆除建筑
          </button>
        </div>
      </section>
        </>
      ) : null}

      {activeWorkflow === "logistics" ? (
        <>
      <section
        aria-labelledby="planet-workflow-tab-logistics"
        className="planet-side-section"
        id="planet-workflow-panel-logistics"
        role="tabpanel"
      >
        <div className="section-title">物流站配置</div>
        <div className="compact-form-grid">
          <label className="field field--span-2">
            <span>{fieldLabel("logistics_station")}</span>
            <select
              onChange={(event) =>
                setStationConfigBuildingId(event.target.value)
              }
              value={stationConfigBuildingId}
            >
              <option value="">选择物流站</option>
              {ownLogisticsStations.map((station) => (
                <option key={station.building_id} value={station.building_id}>
                  {station.building_id} ·{" "}
                  {getBuildingDisplayName(catalog, station.building_type)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{fieldLabel("drone_capacity")}</span>
            <input
              onChange={(event) => setDroneCapacity(event.target.value)}
              type="number"
              value={droneCapacity}
            />
          </label>
          <label className="field">
            <span>{fieldLabel("input_priority")}</span>
            <input
              onChange={(event) => setInputPriority(event.target.value)}
              type="number"
              value={inputPriority}
            />
          </label>
          <label className="field">
            <span>{fieldLabel("output_priority")}</span>
            <input
              onChange={(event) => setOutputPriority(event.target.value)}
              type="number"
              value={outputPriority}
            />
          </label>
          {stationConfigSupportsInterstellar ? (
            <>
              <label className="field">
                <span>{fieldLabel("interstellar_enabled")}</span>
                <input
                  checked={interstellarEnabled}
                  onChange={(event) =>
                    setInterstellarEnabled(event.target.checked)
                  }
                  type="checkbox"
                />
              </label>
              <label className="field">
                <span>{fieldLabel("warp_enabled")}</span>
                <input
                  checked={warpEnabled}
                  onChange={(event) => setWarpEnabled(event.target.checked)}
                  type="checkbox"
                />
              </label>
              <label className="field">
                <span>{fieldLabel("ship_slots")}</span>
                <input
                  onChange={(event) => setShipSlots(event.target.value)}
                  type="number"
                  value={shipSlots}
                />
              </label>
            </>
          ) : null}
          <button
            className="secondary-button field--span-2"
            disabled={busyAction !== "" || !stationConfigBuildingId}
            onClick={() => {
              const nextDroneCapacity = toOptionalInt(droneCapacity);
              const nextInputPriority = toOptionalInt(inputPriority);
              const nextOutputPriority = toOptionalInt(outputPriority);
              const nextShipSlots = toOptionalInt(shipSlots);
              void runCommand("configure_logistics_station", () =>
                client.cmdConfigureLogisticsStation(stationConfigBuildingId, {
                  ...(nextDroneCapacity !== undefined
                    ? { droneCapacity: nextDroneCapacity }
                    : {}),
                  ...(nextInputPriority !== undefined
                    ? { inputPriority: nextInputPriority }
                    : {}),
                  ...(nextOutputPriority !== undefined
                    ? { outputPriority: nextOutputPriority }
                    : {}),
                  ...(stationConfigSupportsInterstellar
                    ? {
                        interstellar: {
                          enabled: interstellarEnabled,
                          warpEnabled,
                          ...(nextShipSlots !== undefined
                            ? { shipSlots: nextShipSlots }
                            : {}),
                        },
                      }
                    : {}),
                }),
              );
            }}
            type="button"
          >
            提交物流站配置
          </button>
          {ownLogisticsStations.length === 0 ? (
            <p className="subtle-text field--span-2">当前玩家还没有物流站。</p>
          ) : null}
        </div>
      </section>

      <section className="planet-side-section">
        <div className="section-title">物流槽位配置</div>
        <div className="compact-form-grid">
          <label className="field field--span-2">
            <span>{fieldLabel("logistics_station")}</span>
            <select
              onChange={(event) => setSlotConfigBuildingId(event.target.value)}
              value={slotConfigBuildingId}
            >
              <option value="">选择物流站</option>
              {ownLogisticsStations.map((station) => (
                <option key={station.building_id} value={station.building_id}>
                  {station.building_id} ·{" "}
                  {getBuildingDisplayName(catalog, station.building_type)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{fieldLabel("scope")}</span>
            <select
              onChange={(event) =>
                setSlotScope(event.target.value as LogisticsScope)
              }
              value={slotScope}
            >
              {slotScopeOptions.map((scope) => (
                <option key={scope} value={scope}>
                  {translateLogisticsScope(scope)}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--span-2">
            <span>{fieldLabel("item_id")}</span>
            <select
              onChange={(event) => setSlotItemId(event.target.value)}
              value={slotItemId}
            >
              <option value="">选择物品</option>
              {logisticsItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {getItemDisplayName(catalog, item.id)} · {item.id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{fieldLabel("mode")}</span>
            <select
              onChange={(event) =>
                setSlotMode(event.target.value as LogisticsMode)
              }
              value={slotMode}
            >
              <option value="none">{translateLogisticsMode("none")}</option>
              <option value="supply">{translateLogisticsMode("supply")}</option>
              <option value="demand">{translateLogisticsMode("demand")}</option>
              <option value="both">{translateLogisticsMode("both")}</option>
            </select>
          </label>
          <label className="field">
            <span>{fieldLabel("local_storage")}</span>
            <input
              onChange={(event) => setSlotLocalStorage(event.target.value)}
              type="number"
              value={slotLocalStorage}
            />
          </label>
          <button
            className="secondary-button field--span-2"
            disabled={
              busyAction !== "" ||
              !slotConfigBuildingId ||
              !slotItemId ||
              slotLocalStorage === ""
            }
            onClick={() => {
              const localStorage = toOptionalInt(slotLocalStorage);
              if (localStorage === undefined) {
                return;
              }
              void runCommand("configure_logistics_slot", () =>
                client.cmdConfigureLogisticsSlot(slotConfigBuildingId, {
                  scope: slotScope,
                  itemId: slotItemId,
                  mode: slotMode,
                  localStorage,
                }),
              );
            }}
            type="button"
          >
            提交物流槽位配置
          </button>
        </div>
      </section>
        </>
      ) : null}

      {activeWorkflow === "research" ? (
        <>
          <section
            aria-labelledby="planet-workflow-tab-research"
            className="planet-side-section"
            id="planet-workflow-panel-research"
            role="tabpanel"
          >
            <div className="section-title">研究工作台</div>

            {researchGroups.current ? (
              <article className="research-panel research-panel--current">
                <div className="research-panel__header">
                  <strong>当前研究</strong>
                  <span>
                    {researchGroups.current.name} · Lv.{researchGroups.current.level}
                  </span>
                </div>
                <div className="research-panel__meta">
                  <span>
                    进度 {playerTechState?.current_research?.progress ?? 0}/
                    {playerTechState?.current_research?.total_cost ?? 0}
                  </span>
                  <span>{currentResearchProgressPercent}%</span>
                </div>
                {researchGroups.current.blockedReasonLabel ? (
                  <div className="research-panel__hint">
                    当前阻塞：{researchGroups.current.blockedReasonLabel}
                  </div>
                ) : null}
                <div className="research-panel__details">
                  <span>
                    前置：
                    {researchGroups.current.prerequisiteLabels.length > 0
                      ? researchGroups.current.prerequisiteLabels.join(" · ")
                      : "无"}
                  </span>
                  <span>
                    所需矩阵：
                    {researchGroups.current.costLabels.length > 0
                      ? researchGroups.current.costLabels.join(" · ")
                      : "无"}
                  </span>
                  <span>
                    解锁：
                    {researchGroups.current.unlockLabels.length > 0
                      ? researchGroups.current.unlockLabels.join(" · ")
                      : "无"}
                  </span>
                </div>
              </article>
            ) : null}

            {starterGuide ? (
              <article className="research-panel research-panel--guide">
                <div className="research-panel__header">
                  <strong>开局推荐路径</strong>
                </div>
                <div className="research-panel__guide-steps">
                  {starterGuide.steps.join(" -> ")}
                </div>
              </article>
            ) : null}

            <div className="research-groups">
              <section
                aria-label="当前可研究"
                className="research-group"
                role="region"
              >
                <div className="research-group__title">当前可研究</div>
                {researchGroups.available.length > 0 ? (
                  <div className="research-tech-list">
                    {researchGroups.available.map((tech) => (
                      <button
                        className={
                          selectedResearch?.id === tech.id
                            ? "research-tech-card research-tech-card--available research-tech-card--selected"
                            : "research-tech-card research-tech-card--available"
                        }
                        key={tech.id}
                        onClick={() => setResearchId(tech.id)}
                        type="button"
                      >
                        <span className="research-tech-card__title">
                          <strong>{tech.name}</strong>
                          <span>Lv.{tech.level}</span>
                        </span>
                        <span className="subtle-text">
                          前置：
                          {tech.prerequisiteLabels.length > 0
                            ? tech.prerequisiteLabels.join(" · ")
                            : "无"}
                        </span>
                        <span className="subtle-text">
                          所需矩阵：
                          {tech.costLabels.length > 0
                            ? tech.costLabels.join(" · ")
                            : "无"}
                        </span>
                        <span className="subtle-text">
                          解锁：
                          {tech.unlockLabels.length > 0
                            ? tech.unlockLabels.join(" · ")
                            : "无"}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="subtle-text">当前没有可研究科技。</p>
                )}
              </section>

              <section
                aria-label="已完成"
                className="research-group"
                role="region"
              >
                <div className="research-group__title">已完成</div>
                {researchGroups.completed.length > 0 ? (
                  <div className="research-tech-list">
                    {researchGroups.completed.map((tech) => (
                      <div
                        className="research-tech-card research-tech-card--completed"
                        key={tech.id}
                      >
                        <span className="research-tech-card__title">
                          <strong>{tech.name}</strong>
                          <span>Lv.{tech.level}</span>
                        </span>
                        <span className="subtle-text">
                          解锁：
                          {tech.unlockLabels.length > 0
                            ? tech.unlockLabels.join(" · ")
                            : "无"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="subtle-text">当前还没有完成任何公开科技。</p>
                )}
              </section>

              <section
                aria-label="尚未满足前置"
                className="research-group"
                role="region"
              >
                <div className="research-group__title">尚未满足前置</div>
                {researchGroups.locked.length > 0 ? (
                  <div className="research-tech-list">
                    {researchGroups.locked.map((tech) => (
                      <div
                        className="research-tech-card research-tech-card--locked"
                        key={tech.id}
                      >
                        <span className="research-tech-card__title">
                          <strong>{tech.name}</strong>
                          <span>Lv.{tech.level}</span>
                        </span>
                        <span className="subtle-text">
                          缺少前置：
                          {tech.missingPrerequisiteLabels.join(" · ")}
                        </span>
                        <span className="subtle-text">
                          所需矩阵：
                          {tech.costLabels.length > 0
                            ? tech.costLabels.join(" · ")
                            : "无"}
                        </span>
                        <span className="subtle-text">
                          解锁：
                          {tech.unlockLabels.length > 0
                            ? tech.unlockLabels.join(" · ")
                            : "无"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="subtle-text">当前没有被前置锁住的公开科技。</p>
                )}
              </section>
            </div>
          </section>

          <section className="planet-side-section">
            <div className="section-title">研究执行区</div>
            <p className="subtle-text">
              {selectedResearch
                ? `已选目标 ${selectedResearch.name}，可直接提交开始研究。`
                : "当前没有可直接启动的科技，可继续推进前置或等待当前研究完成。"}
            </p>
            {selectedResearch ? (
              <div className="research-execute">
                <div className="research-execute__details">
                  <span>前置：{selectedResearch.prerequisiteLabels.join(" · ") || "无"}</span>
                  <span>所需矩阵：{selectedResearch.costLabels.join(" · ") || "无"}</span>
                  <span>解锁：{selectedResearch.unlockLabels.join(" · ") || "无"}</span>
                </div>
                <button
                  className="secondary-button"
                  disabled={busyAction !== "" || !selectedResearch}
                  onClick={() => {
                    void runCommand(
                      "start_research",
                      () => client.cmdStartResearch(selectedResearch.id),
                      {
                        focus: {
                          techId: selectedResearch.id,
                        },
                      },
                    );
                  }}
                  type="button"
                >
                  开始研究
                </button>
              </div>
            ) : null}
          </section>

          <section className="planet-side-section">
            <div className="section-title">研究与装料</div>
            <p className="subtle-text">
              {researchGroups.current
                ? `当前研究 ${researchGroups.current.name}，如果卡在缺矩阵，优先给研究站装入所需矩阵。`
                : selectedResearch
                  ? `当前未在研究，可先启动 ${selectedResearch.name}，也可以先给研究站或中后期建筑装料。`
                  : "可直接给研究站、发射建筑或其他建筑装料。"}
            </p>
            <div className="compact-form-grid">
              <label className="field field--span-2">
                <span>{fieldLabel("building_id")}</span>
                <select
                  onChange={(event) => setTransferBuildingId(event.target.value)}
                  value={transferBuildingId}
                >
                  <option value="">选择建筑</option>
                  {transferTargets.map((building) => (
                    <option key={building.id} value={building.id}>
                      {building.id} · {getBuildingDisplayName(catalog, building.type)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field field--span-2">
                <span>装料物品</span>
                <select
                  onChange={(event) => setTransferItemId(event.target.value)}
                  value={transferItemId}
                >
                  <option value="">选择物品</option>
                  {logisticsItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {getItemDisplayName(catalog, item.id)} · {item.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{fieldLabel("quantity")}</span>
                <input
                  onChange={(event) => setTransferQuantity(event.target.value)}
                  type="number"
                  value={transferQuantity}
                />
              </label>
              <div className="field field--span-2">
                <span>{translateUi("field.inventory")}</span>
                <div className="subtle-text">
                  {formatItemInventorySummary(
                    catalog,
                    selectedTransferBuilding?.storage?.inventory,
                  )}
                </div>
              </div>
              <button
                className="secondary-button field--span-2"
                disabled={
                  busyAction !== "" ||
                  !transferBuildingId ||
                  !transferItemId ||
                  !toOptionalInt(transferQuantity)
                }
                onClick={() => {
                  const quantity = toOptionalInt(transferQuantity);
                  if (!quantity) {
                    return;
                  }
                  void runCommand(
                    "transfer_item",
                    () =>
                      client.cmdTransferItem(
                        transferBuildingId,
                        transferItemId,
                        quantity,
                      ),
                    {
                      focus: {
                        entityId: transferBuildingId,
                        itemId: transferItemId,
                        buildingType: selectedTransferBuilding?.type,
                        techId:
                          selectedTransferBuilding
                            && isResearchBuildingType(selectedTransferBuilding.type)
                            ? currentResearchId || selectedResearch?.id || undefined
                            : undefined,
                      },
                    },
                  );
                }}
                type="button"
              >
                装入建筑
              </button>
            </div>
          </section>
        </>
      ) : null}

      {activeWorkflow === "cross_planet" ? (
        <section
          aria-labelledby="planet-workflow-tab-cross_planet"
          className="planet-side-section"
          id="planet-workflow-panel-cross_planet"
          role="tabpanel"
        >
        <div className="section-title">跨星球</div>
        <div className="compact-form-grid">
          <label className="field field--span-2">
            <span>{fieldLabel("planet_id")}</span>
            <select
              onChange={(event) => setSwitchPlanetId(event.target.value)}
              value={switchPlanetId}
            >
              <option value="">选择当前星系中的星球</option>
              {switchablePlanets.map((targetPlanet) => (
                <option key={targetPlanet.planet_id} value={targetPlanet.planet_id}>
                  {targetPlanet.name ?? targetPlanet.planet_id} ·{" "}
                  {targetPlanet.planet_id}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--span-2">
            <span>手动输入目标星球</span>
            <input
              onChange={(event) => setSwitchPlanetManualId(event.target.value)}
              placeholder="planet-1-2"
              value={switchPlanetManualId}
            />
          </label>
          <button
            className="secondary-button field--span-2"
            disabled={
              busyAction !== "" &&
              busyAction !== "switch_active_planet"
            }
            onClick={() => {
              const nextPlanetId =
                switchPlanetManualId.trim() || switchPlanetId || planet.planet_id;
              void runCommand(
                "switch_active_planet",
                () => client.cmdSwitchActivePlanet(nextPlanetId),
                {
                  planetId: nextPlanetId,
                  focus: {
                    planetId: nextPlanetId,
                  },
                },
              );
            }}
            type="button"
          >
            切换 active planet
          </button>
        </div>
        </section>
      ) : null}

      {activeWorkflow === "dyson" ? (
        <>
      <section
        aria-labelledby="planet-workflow-tab-dyson"
        className="planet-side-section"
        id="planet-workflow-panel-dyson"
        role="tabpanel"
      >
        <div className="section-title">戴森建造</div>
        <div className="compact-form-grid">
          <label className="field">
            <span>命令</span>
            <select
              onChange={(event) =>
                setDysonBuildType(
                  event.target.value as
                    | "build_dyson_node"
                    | "build_dyson_frame"
                    | "build_dyson_shell",
                )
              }
              value={dysonBuildType}
            >
              <option value="build_dyson_node">建造节点</option>
              <option value="build_dyson_frame">建造框架</option>
              <option value="build_dyson_shell">建造壳层</option>
            </select>
          </label>
          <label className="field">
            <span>{fieldLabel("system_id")}</span>
            <input
              onChange={(event) => setDysonSystemId(event.target.value)}
              value={dysonSystemId}
            />
          </label>
          <label className="field">
            <span>Layer</span>
            <select
              onChange={(event) => setDysonLayerIndex(event.target.value)}
              value={dysonLayerIndex}
            >
              {(dysonLayers.length > 0
                ? dysonLayers
                : [{ layer_index: 0, orbit_radius: 1.2, energy_output: 0 }]).map(
                (layer) => (
                  <option
                    key={layer.layer_index}
                    value={String(layer.layer_index)}
                  >
                    layer {layer.layer_index}
                  </option>
                ),
              )}
            </select>
          </label>

          {dysonBuildType === "build_dyson_node" ? (
            <>
              <label className="field">
                <span>纬度</span>
                <input
                  onChange={(event) => setDysonLatitude(event.target.value)}
                  type="number"
                  value={dysonLatitude}
                />
              </label>
              <label className="field">
                <span>经度</span>
                <input
                  onChange={(event) => setDysonLongitude(event.target.value)}
                  type="number"
                  value={dysonLongitude}
                />
              </label>
              <label className="field">
                <span>轨道半径</span>
                <input
                  onChange={(event) => setDysonOrbitRadius(event.target.value)}
                  type="number"
                  value={dysonOrbitRadius}
                />
              </label>
            </>
          ) : null}

          {dysonBuildType === "build_dyson_frame" ? (
            <>
              <label className="field field--span-2">
                <span>节点 A</span>
                <select
                  onChange={(event) => setDysonNodeAId(event.target.value)}
                  value={dysonNodeAId}
                >
                  <option value="">选择节点</option>
                  {dysonNodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field field--span-2">
                <span>节点 B</span>
                <select
                  onChange={(event) => setDysonNodeBId(event.target.value)}
                  value={dysonNodeBId}
                >
                  <option value="">选择节点</option>
                  {dysonNodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.id}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          {dysonBuildType === "build_dyson_shell" ? (
            <>
              <label className="field">
                <span>最小纬度</span>
                <input
                  onChange={(event) => setDysonLatitudeMin(event.target.value)}
                  type="number"
                  value={dysonLatitudeMin}
                />
              </label>
              <label className="field">
                <span>最大纬度</span>
                <input
                  onChange={(event) => setDysonLatitudeMax(event.target.value)}
                  type="number"
                  value={dysonLatitudeMax}
                />
              </label>
              <label className="field">
                <span>覆盖率</span>
                <input
                  onChange={(event) => setDysonCoverage(event.target.value)}
                  type="number"
                  value={dysonCoverage}
                />
              </label>
            </>
          ) : null}

          <button
            className="secondary-button field--span-2"
            disabled={busyAction !== "" || !dysonSystemId}
            onClick={() => {
              const layerIndex = toOptionalInt(dysonLayerIndex) ?? 0;
              if (dysonBuildType === "build_dyson_node") {
                void runCommand(
                  "build_dyson_node",
                  () =>
                    client.cmdBuildDysonNode({
                      systemId: dysonSystemId,
                      layerIndex,
                      latitude: Number(dysonLatitude),
                      longitude: Number(dysonLongitude),
                      orbitRadius: Number(dysonOrbitRadius),
                    }),
                  {
                    focus: {
                      systemId: dysonSystemId,
                    },
                  },
                );
                return;
              }
              if (dysonBuildType === "build_dyson_frame") {
                void runCommand(
                  "build_dyson_frame",
                  () =>
                    client.cmdBuildDysonFrame({
                      systemId: dysonSystemId,
                      layerIndex,
                      nodeAId: dysonNodeAId,
                      nodeBId: dysonNodeBId,
                    }),
                  {
                    focus: {
                      systemId: dysonSystemId,
                    },
                  },
                );
                return;
              }
              void runCommand(
                "build_dyson_shell",
                () =>
                  client.cmdBuildDysonShell({
                    systemId: dysonSystemId,
                    layerIndex,
                    latitudeMin: Number(dysonLatitudeMin),
                    latitudeMax: Number(dysonLatitudeMax),
                    coverage: Number(dysonCoverage),
                  }),
                {
                  focus: {
                    systemId: dysonSystemId,
                  },
                },
              );
            }}
            type="button"
          >
            提交戴森建造命令
          </button>
        </div>
      </section>

      <section className="planet-side-section">
        <div className="section-title">戴森发射</div>
        <div className="compact-form-grid">
          <label className="field">
            <span>发射类型</span>
            <select
              onChange={(event) =>
                setLaunchMode(event.target.value as "solar_sail" | "rocket")
              }
              value={launchMode}
            >
              <option value="solar_sail">太阳帆</option>
              <option value="rocket">火箭</option>
            </select>
          </label>
          <label className="field field--span-2">
            <span>{fieldLabel("building_id")}</span>
            <select
              onChange={(event) => setLaunchBuildingId(event.target.value)}
              value={launchBuildingId}
            >
              <option value="">选择发射建筑</option>
              {(launchMode === "solar_sail"
                ? solarSailLaunchers
                : rocketLaunchers
              ).map((building) => (
                <option key={building.id} value={building.id}>
                  {building.id} · {getBuildingDisplayName(catalog, building.type)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>数量</span>
            <input
              onChange={(event) => setLaunchCount(event.target.value)}
              type="number"
              value={launchCount}
            />
          </label>

          {launchMode === "solar_sail" ? (
            <>
              <label className="field">
                <span>轨道半径</span>
                <input
                  onChange={(event) => setLaunchOrbitRadius(event.target.value)}
                  type="number"
                  value={launchOrbitRadius}
                />
              </label>
              <label className="field">
                <span>倾角</span>
                <input
                  onChange={(event) => setLaunchInclination(event.target.value)}
                  type="number"
                  value={launchInclination}
                />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>{fieldLabel("system_id")}</span>
                <input readOnly value={dysonSystemId} />
              </label>
              <label className="field">
                <span>Layer</span>
                <select
                  onChange={(event) => setLaunchLayerIndex(event.target.value)}
                  value={launchLayerIndex}
                >
                  {(dysonLayers.length > 0
                    ? dysonLayers
                    : [
                        {
                          layer_index: 0,
                          orbit_radius: 1.2,
                          energy_output: 0,
                        },
                      ]).map((layer) => (
                    <option
                      key={layer.layer_index}
                      value={String(layer.layer_index)}
                    >
                      layer {layer.layer_index}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <button
            className="secondary-button field--span-2"
            disabled={busyAction !== "" || !launchBuildingId}
            onClick={() => {
              const count = toOptionalInt(launchCount) ?? 1;
              if (launchMode === "solar_sail") {
                void runCommand(
                  "launch_solar_sail",
                  () =>
                    client.cmdLaunchSolarSail(launchBuildingId, {
                      count,
                      orbitRadius: Number(launchOrbitRadius),
                      inclination: Number(launchInclination),
                    }),
                  {
                    focus: {
                      entityId: launchBuildingId,
                      systemId: dysonSystemId,
                    },
                  },
                );
                return;
              }
              void runCommand(
                "launch_rocket",
                () =>
                  client.cmdLaunchRocket(launchBuildingId, dysonSystemId, {
                    count,
                    layerIndex: toOptionalInt(launchLayerIndex) ?? 0,
                  }),
                {
                  focus: {
                    entityId: launchBuildingId,
                    systemId: dysonSystemId,
                  },
                },
              );
            }}
            type="button"
          >
            提交发射命令
          </button>
        </div>
      </section>

      <section className="planet-side-section">
        <div className="section-title">射线接收站</div>
        <div className="compact-form-grid">
          <label className="field field--span-2">
            <span>{fieldLabel("building_id")}</span>
            <select
              onChange={(event) => setRayReceiverBuildingId(event.target.value)}
              value={rayReceiverBuildingId}
            >
              <option value="">选择射线接收站</option>
              {rayReceiverBuildings.map((building) => (
                <option key={building.id} value={building.id}>
                  {building.id} · {getBuildingDisplayName(catalog, building.type)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>模式</span>
            <select
              onChange={(event) =>
                setRayReceiverMode(
                  event.target.value as "power" | "photon" | "hybrid",
                )
              }
              value={rayReceiverMode}
            >
              {rayReceiverModeOptions.map((mode) => (
                <option
                  disabled={mode.disabled}
                  key={mode.value}
                  value={mode.value}
                >
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          {!photonModeUnlocked ? (
            <div className="subtle-text field--span-2">
              缺少科技：{translateTechId("dirac_inversion")}，当前不能切到 photon。
            </div>
          ) : null}
          <button
            className="secondary-button field--span-2"
            disabled={busyAction !== "" || !rayReceiverBuildingId}
            onClick={() => {
              void runCommand(
                "set_ray_receiver_mode",
                () =>
                  client.cmdSetRayReceiverMode(
                    rayReceiverBuildingId,
                    rayReceiverMode,
                  ),
                {
                  focus: {
                    entityId: rayReceiverBuildingId,
                    buildingType: "ray_receiver",
                    receiverMode: rayReceiverMode,
                  },
                },
              );
            }}
            type="button"
          >
            切换射线接收站模式
          </button>
        </div>
      </section>
        </>
      ) : null}
    </div>
  );
}
