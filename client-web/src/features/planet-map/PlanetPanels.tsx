import type { GameSummary } from "@shared/game";

import { UnitProductionControls } from "./UnitProductionControls";
import { DEBUG_PANEL_HOTKEY_LABEL, buildAdvanceRequest, defaultAdvanceForm, describeAdvanceResult, isAdminPlayer, type AdvanceFormState } from "./fast-forward";
import { useEffect, useMemo, useRef, useState } from "react";

import { useShallow } from "zustand/react/shallow";

import { DEFAULT_SSE_SILENT_EVENT_TYPES } from "@shared/config";
import type {
  AlertEntry,
  Building,
  ItemInventory,
  CatalogView,
  CombatSquad,
  FogMapView,
  GameEventDetail,
  PlanetNetworksView,
  PlanetResource,
  PlanetRuntimeView,
  PlayerStatsSnapshot,
  StateSummary,
  Unit,
  WarBlueprintDetailView,
  WarTaskForceView,
} from "@shared/types";

import {
  buildSelectionExport,
  buildViewLinkSearchParams,
  buildViewportExport,
  canReceiveTransferItems,
  constructionTaskLabel,
  describeAlert,
  describeConstructionWait,
  findLogisticsStation,
  findSelectionEntity,
  formatItemInventorySummary,
  formatPosition,
  getBuildingDisplayName,
  getFogState,
  getItemDisplayName,
  getRecipeDisplayName,
  getResourceList,
  getTerrainTile,
  getTechDisplayName,
  initialBuildingLoadSelection,
  listTransferItemOptions,
  estimateTransferAcceptance,
  isLogisticsStationBuildingType,
  listLogisticsStationSettings,
  PLANET_LAYER_LABELS,
  resolveHomeTile,
  resolveSelectionFromAlert,
  resolveSelectionFromEvent,
  selectionEntityId,
  selectionLabel,
  summarizeEvent,
  toTilePoint,
  type PlanetLayerVisibility,
  type PlanetRenderView,
  type SelectedEntity,
} from "@/features/planet-map/model";
import { describeLogisticsDetail, isSorterBuilding } from "@/features/planet-map/logistics-direction";
import { beltElevation } from "@/features/planet-map/logistics-tier";
import { beltBufferSummary } from "@/features/planet-map/planet-logistics-flow";
import { getItemColorValue } from "@/features/planet-map/item-colors";
import { HAUL_MODE_LABELS, describeHaul, isTransportRobot, transportHaulMode, transportHaulTask } from "@/features/planet-map/transport-haul";
import {
  PLANET_COMMAND_RECOVERY_EVENT_TYPES,
  usePlanetCommandStore,
} from "@/features/planet-commands/store";
import { submitPlanetCommand } from "@/features/planet-commands/executor";
import { useApiClient } from "@/hooks/use-api-client";
import { resolvePlanetCommandHint } from "@/features/planet-commands/error-hints";
import { isResearchStationAlertNoise, isResearchStationBuildingType } from "@/features/production-alerts";
import { listBuildingRecipes } from "@/features/planet-map/build-workflow";
import type { CommandWorkflowId } from "@/features/planet-map/PlanetCommandPanel";
import { normalizeCompletedTechIds } from "@/features/planet-map/research-workflow";
import {
  translateBuildingState,
  translateEventType,
  translateLogisticsMode,
  translatePowerCoverageReason,
  translateUi,
  translateUnitType,
} from "@/i18n/translate";
import { usePlanetViewStore } from "@/features/planet-map/store";
import { useSessionSnapshot } from "@/hooks/use-session";
import { MechaControls } from "./MechaControls";
import { selectMechaById, selectMyMecha } from "@/features/mecha/model";
import { isInIsolatedNetwork } from "./power-status";
import { LogisticsStationControls } from "./LogisticsStationControls";
import { DistributorControls } from "./DistributorControls";
import { TrafficMonitorControls } from "./TrafficMonitorControls";
import { SorterControls } from "./SorterControls";
import { SplitterControls } from "./SplitterControls";
import { ProcessingStatus } from "./ProcessingStatus";
import type { PlanetMapCapture } from "@/features/planet-map/planet-map-capture";
import { unitIsMoving, unitMoveDestination } from '@/features/planet-map/model';
import { findSquadTaskForceId } from '@/features/planet-map/squad-commands';
import { UnitCard } from '@/features/war/components/UnitCard';
import { unitCardFromRuntimeUnit, unitCardFromSquad } from '@/features/war/unit-card-model';

function formatTimestamp(timestamp: number | null) {
  if (!timestamp) {
    return "尚未同步";
  }
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
}

function downloadData(filename: string, content: string, contentType: string) {
  const link = document.createElement("a");
  link.href = `data:${contentType};charset=utf-8,${encodeURIComponent(content)}`;
  link.download = filename;
  link.click();
}

/**
 * V3 juice：检测列表中"新增"项的 id 集合。
 * 首次填充作为基线（不闪烁，避免初始挂载时整列告警一起闪）；之后新增的 id 进入返回集合。
 * 用于告警/事件新条目入场闪烁动效。
 */
function useNewItemIds<T>(items: readonly T[], getId: (item: T) => string): Set<string> {
  const baselineRef = useRef<Set<string> | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  // 用稳定的 id 签名作为依赖，避免 items 引用变化但内容不变时重复跑 effect。
  const signature = items.map(getId).join("\0");

  useEffect(() => {
    const current = new Set(items.map(getId));
    const baseline = baselineRef.current;
    if (baseline === null) {
      baselineRef.current = current;
      return;
    }
    const added: string[] = [];
    for (const id of current) {
      if (!baseline.has(id)) added.push(id);
    }
    baselineRef.current = current;
    if (added.length > 0) setNewIds(new Set(added));
    // signature 是稳定依赖；items/getId 在闭包内取最新值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return newIds;
}

/** 库存总量达到容量的该比例即提示"存储将满"。 */
const STORAGE_NEAR_FULL_RATIO = 0.9;

function translateJobType(jobType: string) {
  return jobType === "upgrade" ? "升级" : jobType === "demolish" ? "拆除" : jobType;
}

/**
 * 选中建筑的"库存与任务"区：结构化展示本地存储（物品/数量/容量）、
 * 输入/输出缓存、生产配方与剩余 tick、当前任务；积压将满时给出警示。
 * 另附「取出」表单：把建筑库存/输出缓存里的物品转回玩家背包（不依赖分拣器）。
 */
function BuildingStorageSection({
  building,
  catalog,
  planetId,
  canControl,
  completedTechIds,
  onOpenWorkflow,
  playerInventory,
  onCommandSettled,
}: {
  building: Building;
  catalog?: CatalogView;
  planetId?: string;
  canControl: boolean;
  /** 已完成科技（生产建筑配方下拉按 CanUseRecipeTech 过滤）。 */
  completedTechIds?: ReadonlySet<string>;
  /** 玩家背包（「装入」表单只从背包扣，候选物品与数量上限都看它）。 */
  playerInventory?: ItemInventory;
  /** 命令结算后回调（刷新 summary，装入/取出后背包数量立刻更新）。 */
  onCommandSettled?: () => void;
  /**
   * 打开工作台的某个命令工作流（试玩 1014 层 12 入口太深：装料/量产要点开抽屉→工作台→
   * 「研究与装料」子页签）。建筑详情里给一条直达快捷入口，落地页仍是同一个表单。
   */
  onOpenWorkflow?: (workflow: CommandWorkflowId) => void;
}) {
  const client = useApiClient();
  const [withdrawItemId, setWithdrawItemId] = useState("");
  const [withdrawQuantity, setWithdrawQuantity] = useState("1");
  const [withdrawPending, setWithdrawPending] = useState(false);
  /**
   * 装入（transfer_item，direction=to_building）——试玩 1016 U4：过去只在
   * 抽屉 → 工作台 →「研究与装料」里，与就地的「取出」不对称。
   * 这里复用同一套口径（候选物品 = 背包有 ∩ 建筑会收，事前可收量估算），
   * 目标建筑固定为当前选中的这座；工作台那条入口照旧可用。
   */
  // 默认物品/数量：首次挂载按当前建筑 + 背包算一次；之后只在「切换建筑 / 候选失效」时重算。
  const [loadItemId, setLoadItemId] = useState(
    () => initialBuildingLoadSelection(catalog, building, playerInventory).itemId,
  );
  const [loadQuantity, setLoadQuantity] = useState(
    () => initialBuildingLoadSelection(catalog, building, playerInventory).quantity,
  );
  const [loadPending, setLoadPending] = useState(false);
  const [loadResult, setLoadResult] = useState<{ ok: boolean; message: string } | null>(null);
  // 配方切换（set_recipe）：下拉选中即直接下发（试玩 1015 §6-5：旧实现必须再点
  // 「应用配方」，只选下拉时反馈区还停在上一条命令，看不出没生效）。
  const [recipePending, setRecipePending] = useState(false);
  /** 本次配方命令的结果（成功/被拒的原话），直接显示在表单里。 */
  const [recipeResult, setRecipeResult] = useState<{ ok: boolean; message: string } | null>(null);
  /** 最近一次下发的选择：用于「退出研究模式」提示与下拉回显。 */
  const [recipeSelection, setRecipeSelection] = useState<string | null>(null);

  const inventory = building.storage?.inventory;
  const inventorySummary = formatItemInventorySummary(catalog, inventory);
  const totalStored = Object.values(inventory ?? {}).reduce(
    (sum, amount) => sum + amount,
    0,
  );
  const capacity =
    building.storage?.capacity ?? building.runtime?.functions?.storage?.capacity;
  const nearFull =
    capacity !== undefined &&
    capacity > 0 &&
    totalStored >= capacity * STORAGE_NEAR_FULL_RATIO;
  const collect = building.runtime?.functions?.collect;
  const production = building.production;
  const job = building.job;

  // 可取出的物品：本地库存 + 输出缓存（去重，保持首次出现顺序）。
  const withdrawableItemIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const source of [inventory, building.storage?.output_buffer]) {
      for (const [itemId, quantity] of Object.entries(source ?? {})) {
        if (quantity <= 0 || seen.has(itemId)) continue;
        seen.add(itemId);
        ids.push(itemId);
      }
    }
    return ids;
  }, [inventory, building.storage?.output_buffer]);

  const withdrawQuantityValue = Number.parseInt(withdrawQuantity, 10);
  const withdrawQuantityValid =
    Number.isInteger(withdrawQuantityValue) && withdrawQuantityValue > 0;
  const withdrawDisabled =
    withdrawPending || !canControl || !withdrawItemId || !withdrawQuantityValid;

  // 装入：建筑必须有存储才收料（与工作台 transferTargets 同一判定）。
  const canReceiveLoad = canReceiveTransferItems(building);
  const loadItemOptions = useMemo(
    () => (canReceiveLoad ? listTransferItemOptions(catalog, building, playerInventory) : []),
    [canReceiveLoad, catalog, building, playerInventory],
  );
  // 默认物品/数量只在「切换建筑」或候选失效时重置（玩家选过的不覆盖，同工作台 bug-1013-5 口径）。
  const loadContext = `${building.id}:${building.production?.recipe_id ?? ""}`;
  const loadContextRef = useRef("");
  useEffect(() => {
    const stillAvailable =
      loadItemId !== "" && loadItemOptions.some((item) => item.id === loadItemId);
    if (loadContextRef.current !== loadContext || !stillAvailable) {
      loadContextRef.current = loadContext;
      const initial = initialBuildingLoadSelection(catalog, building, playerInventory);
      // 首次挂载就按初始值渲染，避免 effect 里再 setState 一次（多一帧空表单 + 测试 act 警告）。
      setLoadItemId((current) => (current === initial.itemId ? current : initial.itemId));
      setLoadQuantity((current) => (current === initial.quantity ? current : initial.quantity));
    }
  }, [loadContext, loadItemId, loadItemOptions, catalog, building, playerInventory]);
  const loadItemOwned = loadItemId ? (playerInventory?.[loadItemId] ?? 0) : 0;
  // 数量输入只认纯数字（试玩 1017 K4b）：`type="number"` 允许 "1.5" / "1e3"，
  // 过去 parseInt 会把它们悄悄截成 1，玩家以为装了 1000 个其实只装了 1 个。
  const loadQuantityValid = /^\d+$/.test(loadQuantity) && Number.parseInt(loadQuantity, 10) > 0;
  const loadQuantityValue = /^\d+$/.test(loadQuantity) ? Number.parseInt(loadQuantity, 10) : Number.NaN;
  const loadQuantityOverOwned =
    loadQuantity !== "" && loadQuantityValid && loadQuantityValue > loadItemOwned;
  // 数量为空 = 服务端按「背包全部」装入（与工作台一致），但背包里必须有这件物品。
  const loadDisabled =
    loadPending || !canControl || !planetId || !loadItemId || !canReceiveLoad
    || (loadQuantity !== "" && (!loadQuantityValid || loadQuantityOverOwned))
    || (loadQuantity === "" && loadItemOwned <= 0);
  // 切换物品时数量按新物品的持有量重算（试玩 1017 K4b）：旧数量原样留着的话，
  // 换到一件只有 2 个的物品会静默禁用按钮，玩家看不出为什么。
  const changeLoadItem = (nextItemId: string) => {
    setLoadItemId(nextItemId);
    const owned = nextItemId ? (playerInventory?.[nextItemId] ?? 0) : 0;
    setLoadQuantity(owned > 0 ? String(Math.min(10, owned)) : "");
    setLoadResult(null);
  };
  // 装入后背包刷新（部分装入 / 外部消耗）：持有量下降时把超出的数量夹回持有量。
  // 只在持有量**变化**时夹，不覆盖玩家手输的超量（超量仍禁用按钮并给出原因）。
  const previousLoadOwnedRef = useRef(loadItemOwned);
  useEffect(() => {
    const previous = previousLoadOwnedRef.current;
    previousLoadOwnedRef.current = loadItemOwned;
    if (previous === loadItemOwned || !/^\d+$/.test(loadQuantity)) {
      return;
    }
    if (Number.parseInt(loadQuantity, 10) > loadItemOwned) {
      // 夹回剩余持有量；背包清空时留空（按钮禁用并提示没有可装入的物品）。
      setLoadQuantity(loadItemOwned > 0 ? String(loadItemOwned) : "");
    }
  }, [loadItemOwned, loadQuantity]);
  const loadAcceptance = useMemo(
    () => (canReceiveLoad && loadItemId
      ? estimateTransferAcceptance(building, loadItemId, loadQuantityValue || loadItemOwned, loadItemOwned)
      : null),
    [canReceiveLoad, building, loadItemId, loadQuantityValue, loadItemOwned],
  );

  // 配方下拉：只列该建筑类型支持且科技已解锁的配方（含「无配方」= 研究模式/空闲）。
  const recipeOptions = useMemo(
    () => listBuildingRecipes(catalog, building.type, completedTechIds ?? []),
    [catalog, building.type, completedTechIds],
  );
  /**
   * 当前生效的配方：以权威 production.recipe_id 为准（回写前先显示玩家刚选的值，
   * 避免下拉「跳回去」）。
   */
  const currentRecipeId = building.production?.recipe_id ?? recipeSelection ?? "";
  /**
   * 研究站（matrix_lab / self_evolution_lab）从「无配方」切到生产配方 = 退出研究模式：
   * 服务端 isResearchLab 只认「Research 模块 + 空配方」的建筑，设了配方就不再算研究站，
   * 正在研究的科技会因缺少运行中的研究站而暂停（试玩 1013 bug-1013-4，当时界面零提示）。
   */
  const leavingResearchMode =
    (building.production?.recipe_id ?? "") === ""
    && (recipeSelection ?? "") !== ""
    && isResearchStationBuildingType(building.type);
  // 只在真正进入生产周期的建筑上给配方入口（纯采集建筑没有配方）。
  const supportsRecipe = Boolean(building.runtime?.functions?.production) && recipeOptions.length > 0;
  /** 该建筑能生产的单位类型（与 UnitProductionControls 的 `u.producer === building.type` 同口径）。 */
  const unitProducible = (catalog?.world_units ?? []).some(
    (unit) => unit.producer === building.type,
  );

  /**
   * 下拉选择即下发（不再需要「应用配方」）：选中值先回显，命令结果写进表单反馈区。
   * 同一选择重复选（值没变）不下发，避免误触重复命令。
   */
  async function switchRecipe(nextRecipeId: string) {
    if (recipePending || !canControl || !planetId) {
      return;
    }
    if (nextRecipeId === (building.production?.recipe_id ?? "")) {
      setRecipeSelection(null);
      return;
    }
    setRecipeSelection(nextRecipeId);
    setRecipeResult(null);
    setRecipePending(true);
    try {
      const response = await submitPlanetCommand({
        commandType: "set_recipe",
        planetId,
        focus: { entityId: building.id },
        execute: () => client.cmdSetRecipe(building.id, nextRecipeId || undefined, planetId),
        fetchAuthoritativeSnapshot: () =>
          client.fetchEventSnapshot({
            event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
            limit: 50,
          }),
      });
      const target = nextRecipeId ? getRecipeDisplayName(catalog, nextRecipeId) : "无配方";
      const resultMessage = response?.results
        ?.map((result) => result.message?.trim())
        .filter(Boolean)
        .join(" / ");
      if (!response) {
        setRecipeResult({ ok: false, message: `切换配方提交失败：未能联系服务器，请重试（目标「${target}」）` });
      } else if (response.accepted) {
        // 优先回显服务端回执原话（它就是本次命令的结果），没有才用本地文案。
        setRecipeResult({ ok: true, message: resultMessage || `已切换为「${target}」` });
      } else {
        setRecipeResult({ ok: false, message: `切换配方被拒：${resultMessage || "服务器未说明原因"}` });
      }
    } finally {
      setRecipePending(false);
    }
  }

  /**
   * 装入（试玩 1016 U4）：与「取出」同一表单区，方向相反。数量留空 = 背包全部
   * （服务端 execTransferItem 的口径），回执原话写回表单里。
   */
  async function submitLoad() {
    if (loadDisabled) {
      return;
    }
    setLoadPending(true);
    setLoadResult(null);
    try {
      const response = await submitPlanetCommand({
        commandType: "transfer_item",
        planetId,
        focus: { entityId: building.id, itemId: loadItemId },
        execute: () =>
          client.cmdTransferItem(
            building.id,
            loadItemId,
            loadQuantityValue || loadItemOwned,
            planetId,
            "to_building",
          ),
        fetchAuthoritativeSnapshot: () =>
          client.fetchEventSnapshot({
            event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
            limit: 50,
          }),
      });
      const resultMessage = response?.results
        ?.map((result) => result.message?.trim())
        .filter(Boolean)
        .join(" / ");
      if (!response) {
        setLoadResult({ ok: false, message: "装入提交失败：未能联系服务器，请重试" });
      } else if (response.accepted) {
        setLoadResult({ ok: true, message: resultMessage || "已装入" });
      } else {
        setLoadResult({ ok: false, message: `装入被拒：${resultMessage || "服务器未说明原因"}` });
      }
    } finally {
      setLoadPending(false);
      onCommandSettled?.();
    }
  }

  async function submitWithdraw() {
    if (withdrawDisabled || !planetId) {
      return;
    }
    setWithdrawPending(true);
    try {
      await submitPlanetCommand({
        commandType: "transfer_item",
        planetId,
        focus: { entityId: building.id, itemId: withdrawItemId },
        execute: () =>
          client.cmdTransferItem(
            building.id,
            withdrawItemId,
            withdrawQuantityValue,
            planetId,
            "to_player",
          ),
        fetchAuthoritativeSnapshot: () =>
          client.fetchEventSnapshot({
            event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
            limit: 50,
          }),
      });
    } finally {
      setWithdrawPending(false);
    }
  }

  return (
    <section className="planet-side-section">
      <div className="section-title">库存与任务</div>
      <dl className="planet-kv-list">
        <div>
          <dt>本地存储</dt>
          <dd>
            {inventorySummary}
            {capacity !== undefined ? `（${totalStored}/${capacity}）` : ""}
          </dd>
        </div>
        {nearFull ? (
          <div className="planet-kv-list__warning">
            <dt>存储警示</dt>
            <dd>存储将满，请及时转运或扩容</dd>
          </div>
        ) : null}
        {building.storage?.input_buffer ? (
          <div>
            <dt>输入缓存</dt>
            <dd>{formatItemInventorySummary(catalog, building.storage.input_buffer)}</dd>
          </div>
        ) : null}
        {building.storage?.output_buffer ? (
          <div>
            <dt>输出缓存</dt>
            <dd>{formatItemInventorySummary(catalog, building.storage.output_buffer)}</dd>
          </div>
        ) : null}
        {collect ? (
          <div>
            <dt>产出速率</dt>
            <dd>{collect.yield_per_tick}/tick</dd>
          </div>
        ) : null}
        {/* 采集建筑只采一种矿（第 16 轮契约 §5.1）：详情里直接写明是哪一种，
            覆盖框里混进来的别的矿脉一格都不采。 */}
        {collect && building.mining_item ? (
          <div>
            <dt>开采矿种</dt>
            <dd>{getItemDisplayName(catalog, building.mining_item)}</dd>
          </div>
        ) : null}
        <div>
          <dt>生产配方</dt>
          <dd>
            {production?.recipe_id
              ? `${getRecipeDisplayName(catalog, production.recipe_id)}${
                  production.remaining_ticks !== undefined
                    ? `（剩余 ${(production.remaining_ticks - (production.progress_fraction ?? 0)).toFixed(2)} 标准生产 tick）`
                    : ""
                }`
              : building.fractionation ? "氢循环分馏（自动）" : building.spray_coater ? "物料喷涂（自动）" : "未配置"}
          </dd>
        </div>
        <div>
          <dt>当前任务</dt>
          <dd>
            {job
              ? `${translateJobType(job.type)}（剩余 ${job.remaining_ticks} tick）`
              : "无"}
          </dd>
        </div>
      </dl>
      {/*
        试玩 1014 层 12：「装入建筑」「切换配方」「量产」都藏在抽屉 → 工作台 → 子页签里，
        选中建筑后要翻三层才够得着。这里给一条直达入口，落地页是同一个表单/工作流。
      */}
      {canControl && onOpenWorkflow ? (
        <div className="planet-storage-shortcuts">
          <button
            className="secondary-button"
            onClick={() => onOpenWorkflow("research")}
            title="打开工作台「研究与装料」，把背包里的物品装入建筑"
            type="button"
          >
            装入建筑
          </button>
          {supportsRecipe ? (
            <button
              className="secondary-button"
              onClick={() => onOpenWorkflow("research")}
              title="打开工作台切换本建筑的配方（也可用下方「切换配方」）"
              type="button"
            >
              切换配方
            </button>
          ) : null}
          {unitProducible ? (
            <button
              className="secondary-button"
              onClick={() => onOpenWorkflow("combat")}
              title="打开工作台「战斗与制造」，为本建筑下量产队列"
              type="button"
            >
              量产单位
            </button>
          ) : null}
        </div>
      ) : null}
      {supportsRecipe ? (
        <form
          aria-label="切换配方表单"
          className="planet-recipe-form"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="field">
            <span>切换配方</span>
            <select
              aria-label="切换配方"
              disabled={!canControl || recipePending}
              onChange={(event) => void switchRecipe(event.target.value)}
              title="选中即生效（无需再点确认）；切换会清空当前生产进度，库存保留"
              value={currentRecipeId}
            >
              <option value="">无配方（研究模式 / 空闲）</option>
              {recipeOptions.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {getRecipeDisplayName(catalog, recipe.id)}
                </option>
              ))}
            </select>
          </label>
          {/*
            试玩 1015 §6-5：下拉选择即下发，反馈区直接写本次命令结果——
            旧实现要再点「应用配方」，只选下拉时反馈区还停在上一条命令，看不出没生效。
          */}
          <p
            className={`subtle-text planet-recipe-form__result${recipeResult && !recipeResult.ok ? " planet-recipe-form__result--error" : ""}`}
            data-testid="recipe-result"
            role="status"
          >
            {recipePending
              ? "切换中…"
              : recipeResult
                ? recipeResult.message
                : "选中即生效"}
          </p>
          {leavingResearchMode ? (
            <p className="subtle-text planet-recipe-form__research-warning" role="status">
              切换后此研究站不再参与研究：服务端只把「无配方」的研究站算作研究站，
              研究中的科技会因缺少运行中的研究站而暂停。想继续研究请把配方切回「无配方」。
            </p>
          ) : null}
        </form>
      ) : null}
      {withdrawableItemIds.length > 0 ? (
        <form
          aria-label="取出物品表单"
          className="planet-withdraw-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitWithdraw();
          }}
        >
          <label className="field">
            <span>取出物品</span>
            <select
              aria-label="取出物品"
              disabled={!canControl}
              onChange={(event) => setWithdrawItemId(event.target.value)}
              value={withdrawItemId}
            >
              <option value="">选择物品</option>
              {withdrawableItemIds.map((itemId) => (
                <option key={itemId} value={itemId}>
                  {getItemDisplayName(catalog, itemId)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>数量</span>
            <input
              aria-label="取出数量"
              disabled={!canControl}
              min={1}
              onChange={(event) => setWithdrawQuantity(event.target.value)}
              type="number"
              value={withdrawQuantity}
            />
          </label>
          <button
            className="secondary-button"
            disabled={withdrawDisabled}
            type="submit"
          >
            {withdrawPending ? "取出中…" : "取出"}
          </button>
        </form>
      ) : null}
      {/*
        试玩 1016 U4：装入过去只在抽屉 → 工作台 →「研究与装料」里，与就地的「取出」
        不对称。这里在取出表单正下方给同构的「装入」表单（同一条 transfer_item，
        direction=to_building，目标建筑固定为当前选中的这座）；工作台那条入口照旧可用。
        没有存储的建筑（风机/太阳能板等）不渲染表单，只写一句原因。
      */}
      {canControl && canReceiveLoad ? (
        <form
          aria-label="装入物品表单"
          className="planet-withdraw-form planet-load-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitLoad();
          }}
        >
          <label className="field">
            <span>装入物品</span>
            <select
              aria-label="装入物品"
              disabled={loadItemOptions.length === 0}
              onChange={(event) => changeLoadItem(event.target.value)}
              value={loadItemId}
            >
              <option value="">{loadItemOptions.length === 0 ? "背包里没有可装入的物品" : "选择物品"}</option>
              {loadItemOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {getItemDisplayName(catalog, item.id)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>数量</span>
            <input
              aria-label="装入数量"
              disabled={loadItemOptions.length === 0}
              min={1}
              inputMode="numeric"
              onChange={(event) => setLoadQuantity(event.target.value)}
              placeholder="留空 = 全部"
              type="text"
              value={loadQuantity}
            />
          </label>
          <button
            className="secondary-button"
            disabled={loadDisabled}
            type="submit"
          >
            {loadPending ? "装入中…" : "装入"}
          </button>
          {/* 数量被拒的原因写清楚（试玩 1017 K4b）：过去只是静默禁用，玩家不知道是数字格式还是数量超了。 */}
          {loadItemId && (loadQuantityOverOwned || (loadQuantity !== "" && !loadQuantityValid)) ? (
            <p className="subtle-text planet-load-form__hint is-short" role="status">
              {loadQuantityOverOwned
                ? `数量超过背包里的 ${loadItemOwned} 个`
                : "数量要填正整数（留空 = 全部装入）"}
            </p>
          ) : null}
          {loadItemId ? (
            <p className="subtle-text planet-load-form__hint">
              背包 {getItemDisplayName(catalog, loadItemId)} {loadItemOwned} 个
              {loadAcceptance?.blocked
                ? ` · 目标建筑现在收不下：${loadAcceptance.reason}`
                : loadAcceptance
                  ? ` · 目标建筑还能收约 ${loadAcceptance.accepted} 个`
                  : ""}
            </p>
          ) : (
            <p className="subtle-text planet-load-form__hint" role="status">
              {isResearchStationBuildingType(building.type) && !building.production?.recipe_id
                ? "该研究站处于研究模式，只接受矩阵（研究耗材）；背包里现在没有矩阵。"
                : "背包里没有这座建筑能接收的物品（按配方输入/准入规则过滤）。"}
            </p>
          )}
          {loadResult ? (
            <p
              className={`subtle-text planet-load-form__result${loadResult.ok ? "" : " planet-load-form__result--error"}`}
              role="status"
            >
              {loadResult.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

interface PlanetLayerPanelProps {
  networks?: PlanetNetworksView;
  planet: PlanetRenderView;
  runtime?: PlanetRuntimeView;
}
export function PlanetLayerPanel({
  networks,
  planet,
  runtime,
}: PlanetLayerPanelProps) {
  const {
    hoveredTile,
    layers,
    requestFocus,
    selected,
    toggleLayer,
  } = usePlanetViewStore(
    useShallow((state) => ({
      hoveredTile: state.hoveredTile,
      layers: state.layers,
      requestFocus: state.requestFocus,
      selected: state.selected,
      toggleLayer: state.toggleLayer,
    })),
  );
  const session = useSessionSnapshot();

  const handleHome = () => {
    const home = usePlanetViewStore.getState().homeTile ?? resolveHomeTile(planet, session.playerId);
    if (home) {
      requestFocus(home);
    }
  };

  const resources = useMemo(() => getResourceList(planet), [planet]);
  const buildingCount =
    "building_count" in planet ? planet.building_count : undefined;
  const unitCount = "unit_count" in planet ? planet.unit_count : undefined;
  const resourceCount =
    "resource_count" in planet ? planet.resource_count : undefined;

  return (
    <div className="planet-panel-stack">
      <section className="planet-side-section">
        <div className="section-title">图层与视角</div>
        <div className="toggle-grid">
          {/* `layers.terrain` 在 3D 里不是独立图层（地形与测绘面纱在同一张贴图上），
              勾掉它只会让开关与画面不一致——不渲染。 */}
          {Object.entries(layers)
            .filter(([key]) => key !== "terrain")
            .map(([key, enabled]) => (
            <label className="toggle-pill" key={key}>
              <input
                checked={enabled}
                onChange={() => toggleLayer(key as keyof typeof layers)}
                type="checkbox"
              />
              <span>
                {PLANET_LAYER_LABELS[key as keyof typeof PLANET_LAYER_LABELS]}
              </span>
            </label>
          ))}
        </div>
        <div className="zoom-actions">
          {/* 2D 视图退役后这里只保留「回到基地」：缩放由 3D 相机（滚轮/±按钮）负责。 */}
          <button
            className="secondary-button zoom-button"
            onClick={handleHome}
            type="button"
          >
            回到基地
          </button>
        </div>
      </section>

      <section className="planet-side-section">
        <div className="section-title">场景摘要</div>
        <dl className="planet-kv-list">
          <div>
            <dt>地图大小</dt>
            <dd>
              {planet.map_width} x {planet.map_height}
            </dd>
          </div>
          <div>
            <dt>建筑</dt>
            <dd>
              {buildingCount ?? Object.keys(planet.buildings ?? {}).length}
            </dd>
          </div>
          <div>
            <dt>单位</dt>
            <dd>{unitCount ?? Object.keys(planet.units ?? {}).length}</dd>
          </div>
          <div>
            <dt>资源点</dt>
            <dd>{resourceCount ?? resources.length}</dd>
          </div>
          <div>
            <dt>Hover</dt>
            <dd>{hoveredTile ? `${hoveredTile.x}, ${hoveredTile.y}` : "-"}</dd>
          </div>
          <div>
            <dt>选中</dt>
            <dd>{selectionLabel(selected)}</dd>
          </div>
          <div>
            <dt>物流</dt>
            <dd>
              {(runtime?.logistics_drones?.length ?? 0) +
                (runtime?.logistics_ships?.length ?? 0)}
            </dd>
          </div>
          <div>
            <dt>施工</dt>
            <dd>{runtime?.construction_tasks?.length ?? 0}</dd>
          </div>
          <div>
            <dt>网络</dt>
            <dd>
              {(networks?.power_networks?.length ?? 0) +
                (networks?.pipeline_nodes?.length ?? 0)}
            </dd>
          </div>
          <div>
            <dt>威胁</dt>
            <dd>{runtime?.threat_level ?? 0}</dd>
          </div>
        </dl>
      </section>

      <details className="planet-disclosure">
        <summary className="planet-disclosure__summary">
          <span className="section-title">图例</span>
        </summary>
        <div className="planet-disclosure__body legend-list">
          <span>
            <i className="legend-swatch legend-swatch--terrain" />
            可建造地形
          </span>
          <span>
            <i className="legend-swatch legend-swatch--water" />
            水域
          </span>
          <span>
            <i className="legend-swatch legend-swatch--lava" />
            岩浆
          </span>
          <span>
            <i className="legend-swatch legend-swatch--building" />
            建筑
          </span>
          <span>
            <i className="legend-swatch legend-swatch--unit" />
            单位
          </span>
          <span>
            <i className="legend-swatch legend-swatch--resource" />
            资源点
          </span>
          <span>
            <i className="legend-swatch legend-swatch--logistics" />
            物流轨迹
          </span>
          <span>
            <i className="legend-swatch legend-swatch--power" />
            电网
          </span>
          <span>
            <i className="legend-swatch legend-swatch--pipeline" />
            管网
          </span>
          <span>
            <i className="legend-swatch legend-swatch--construction" />
            施工任务
          </span>
          <span>
            <i className="legend-swatch legend-swatch--threat" />
            敌情
          </span>
          <span>
            <i className="legend-swatch legend-swatch--fog" />
            未探索区域
          </span>
        </div>
      </details>

      <details className="planet-disclosure">
        <summary className="planet-disclosure__summary">
          <span className="section-title">读模型状态</span>
        </summary>
        <div className="planet-disclosure__body">
          <dl className="planet-kv-list">
            <div>
              <dt>runtime</dt>
              <dd>{runtime?.available ? translateUi("online") : translateUi("inactive")}</dd>
            </div>
            <div>
              <dt>networks</dt>
              <dd>{networks?.available ? translateUi("online") : translateUi("inactive")}</dd>
            </div>
            <div>
              <dt>电力链路</dt>
              <dd>{networks?.power_links?.length ?? 0}</dd>
            </div>
            <div>
              <dt>管网段</dt>
              <dd>{networks?.pipeline_segments?.length ?? 0}</dd>
            </div>
          </dl>
        </div>
      </details>
    </div>
  );
}

interface PlanetEntityPanelProps {
  catalog?: CatalogView;
  fog?: FogMapView | PlanetRenderView;
  networks?: PlanetNetworksView;
  planet: PlanetRenderView;
  runtime?: PlanetRuntimeView;
  stats?: PlayerStatsSnapshot;
  summary?: StateSummary;
  /** C4：玩家蓝图（小队卡片的名称/域解析；缺省退回公共蓝图目录）。 */
  blueprints?: WarBlueprintDetailView[];
  /** C4：任务群列表（小队卡片的所属任务群展示）。 */
  taskForces?: WarTaskForceView[];
  /** 服务端实际 tick 速率（/games/current 的 max_tick_rate）：机甲剩余时间换算用。 */
  tickRate?: number;
  /**
   * 跨场景窗口累积的己方单位（id → Unit，见 own-entity-cache）。
   * `/scene` 只返回相机窗口内的实体：镜头移开后被选中的机甲会掉出 planet.units，
   * 机甲面板/手搓表单不能因此整段卸载——只要仍被选中就保持可用（试玩 1014 问题 2）。
   */
  knownOwnUnits?: ReadonlyMap<string, Unit>;
  /** 建筑详情的快捷入口：打开工作台对应命令工作流（装入建筑/切换配方/量产）。 */
  onOpenWorkflow?: (workflow: CommandWorkflowId) => void;
  /** 命令结算后回调（装入/取出后刷新 summary，背包数量立刻更新）。 */
  onCommandSettled?: () => void;
}

export function PlanetEntityPanel({
  catalog,
  fog,
  networks,
  planet,
  runtime,
  stats,
  summary,
  blueprints,
  taskForces,
  knownOwnUnits,
  tickRate,
  onOpenWorkflow,
  onCommandSettled,
}: PlanetEntityPanelProps) {
  const session = useSessionSnapshot();
  const myMecha = selectMyMecha(summary, session.playerId);
  const { selected } = usePlanetViewStore(
    useShallow((state) => ({
      selected: state.selected,
    })),
  );

  // 选中单位掉出相机窗口时回退到累积缓存：面板/手搓表单继续按「仍被选中」渲染（试玩 1014 问题 2）。
  const selectedUnit = selected?.kind === "unit" ? planet.units?.[selected.id] ?? knownOwnUnits?.get(selected.id) : undefined;
  const entity = selectedUnit ?? findSelectionEntity(planet, selected, runtime);
  const currentResearchId =
    Object.values(summary?.players ?? {}).find(
      (player) => player.tech?.current_research,
    )?.tech?.current_research?.tech_id ?? "";
  // 己方已完成科技（生产建筑的配方下拉按 CanUseRecipeTech 过滤）。
  const completedTechIds = useMemo(
    () => new Set(normalizeCompletedTechIds(summary?.players?.[session.playerId]?.tech)),
    [summary, session.playerId],
  );

  if (!selected) {
    return (
      <div className="planet-panel-stack">
        <section className="planet-side-section">
          <div className="section-title">实体详情</div>
          <p className="subtle-text">
            点击地图中的建筑、单位或资源点后，这里会显示稳定的结构化详情。
          </p>
        </section>
        <section className="planet-side-section">
          <div className="section-title">玩家摘要</div>
          <dl className="planet-kv-list">
            <div>
              <dt>当前 tick</dt>
              <dd>{planet.tick}</dd>
            </div>
            <div>
              <dt>活跃行星</dt>
              <dd>{summary?.active_planet_id ?? planet.planet_id}</dd>
            </div>
            <div>
              <dt>电力</dt>
              <dd>
                {stats
                  ? `${stats.energy_stats.generation} / ${stats.energy_stats.consumption}`
                  : "-"}
              </dd>
            </div>
            <div>
              <dt>物流吞吐</dt>
              <dd>{stats?.logistics_stats.throughput ?? "-"}</dd>
            </div>
            <div>
              <dt>当前研究</dt>
              <dd>
                {currentResearchId
                  ? getTechDisplayName(catalog, currentResearchId)
                  : "无"}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    );
  }

  if (selected.kind === "tile") {
    const tile = toTilePoint(selected.position);
    const fogState = getFogState(fog, tile.x, tile.y);
    const constructionTasks = (runtime?.construction_tasks ?? []).filter(
      (task) => task.position.x === tile.x && task.position.y === tile.y,
    );
    const pipelineNode = (networks?.pipeline_nodes ?? []).find(
      (node) => node.position.x === tile.x && node.position.y === tile.y,
    );
    return (
      <div className="planet-panel-stack">
        <section className="planet-side-section">
          <div className="section-title">地块详情</div>
          <dl className="planet-kv-list">
            <div>
              <dt>坐标</dt>
              <dd>{formatPosition(selected.position)}</dd>
            </div>
            <div>
              <dt>地形</dt>
              <dd>{getTerrainTile(planet, tile.x, tile.y)}</dd>
            </div>
            <div>
              <dt>可见</dt>
              <dd>{fogState.visible ? "是" : "否"}</dd>
            </div>
            <div>
              <dt>已探索</dt>
              <dd>{fogState.explored ? "是" : "否"}</dd>
            </div>
            <div>
              <dt>施工任务</dt>
              <dd>
                {constructionTasks.length === 0
                  ? "-"
                  : constructionTasks.map((task) => {
                    const wait = describeConstructionWait(task.wait_reason, catalog);
                    return `${constructionTaskLabel(task, catalog)}（${task.state}${wait ? ` · 排队中：${wait}` : ''}）`;
                  }).join("、")}
              </dd>
            </div>
            {constructionTasks.some((task) => task.player_id === session.playerId) ? (
              <div>
                <dt>提示</dt>
                <dd className="planet-kv-list__warning">此格已有你的施工任务，正在排队/施工中，无需重复下单。</dd>
              </div>
            ) : null}
            <div>
              <dt>管网节点</dt>
              <dd>{pipelineNode?.id ?? "-"}</dd>
            </div>
          </dl>
        </section>
      </div>
    );
  }

  if (selected.kind === "building" && entity) {
    const building = entity as Building;
    const buildingName = getBuildingDisplayName(catalog, building.type);
    const stateReasonHint = resolvePlanetCommandHint({
      reason: building.runtime.state_reason,
    });
    const powerCoverage = networks?.power_coverage?.find(
      (coverage) => coverage.building_id === building.id,
    );
    const logisticsStation = findLogisticsStation(runtime, building.id);
    const showLogisticsDetails =
      isLogisticsStationBuildingType(building.type) &&
      Boolean(logisticsStation);
    const planetarySettings = listLogisticsStationSettings(
      catalog,
      logisticsStation?.state?.settings,
    );
    const interstellarSettings = listLogisticsStationSettings(
      catalog,
      logisticsStation?.state?.interstellar_settings,
    );
    return (
      <div className="planet-panel-stack">
        <section className="planet-side-section">
          <div className="section-title">建筑详情</div>
          <dl className="planet-kv-list">
            <div>
              <dt>编号</dt>
              <dd>{building.id}</dd>
            </div>
            <div>
              <dt>类型</dt>
              <dd>{buildingName}</dd>
            </div>
            <div>
              <dt>类型编号</dt>
              <dd>{building.type}</dd>
            </div>
            <div>
              <dt>所属</dt>
              <dd>{building.owner_id}</dd>
            </div>
            <div>
              <dt>坐标</dt>
              <dd>{formatPosition(building.position)}</dd>
            </div>
            {building.conveyor ? (
              <div>
                <dt>高度</dt>
                <dd data-testid="planet-building-elevation">{beltElevation(building)} 层{beltElevation(building) === 0 ? '（地面）' : '（高架）'}</dd>
              </div>
            ) : null}
            {building.conveyor || isSorterBuilding(building) ? (
              <div>
                <dt>流向</dt>
                <dd>{describeLogisticsDetail(building, Object.values(planet.buildings ?? {}), planet.surface?.face_size ?? 1, catalog)}</dd>
              </div>
            ) : null}
            {building.conveyor ? (
              <div>
                <dt>带上物品</dt>
                <dd>{beltBufferSummary(building.conveyor.buffer, (itemId) => getItemDisplayName(catalog, itemId))}</dd>
              </div>
            ) : null}
            {building.conveyor?.buffer?.length ? (
              <div>
                <dt>货物色块</dt>
                <dd className="planet-kv-list__swatches">
                  {building.conveyor.buffer.filter((stack) => stack.quantity > 0).map((stack, index) => (
                    <span
                      key={`${stack.item_id}-${index}`}
                      className="planet-kv-list__swatch"
                      style={{ background: getItemColorValue(stack.item_id, catalog?.items?.find((item) => item.id === stack.item_id)?.color) }}
                      title={`${getItemDisplayName(catalog, stack.item_id)} ×${stack.quantity}`}
                    />
                  ))}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>状态</dt>
              <dd>{translateBuildingState(building.runtime.state)}</dd>
            </div>
            <div>
              <dt>停机原因</dt>
              <dd>{stateReasonHint?.title ?? "-"}</dd>
            </div>
            <div>
              <dt>建议下一步</dt>
              <dd>{stateReasonHint?.nextHint ?? "-"}</dd>
            </div>
            {isInIsolatedNetwork(networks, session.playerId, building.id) ? (
              <div>
                <dt>电网</dt>
                <dd className="planet-kv-list__warning">
                  未接入主电网（孤立电网）：这座建筑自成一个电网，不会给基地供电。
                  建议在 4 格内补一座电塔把它并进主网。
                </dd>
              </div>
            ) : null}
            <div>
              <dt>血量</dt>
              <dd>
                {building.hp} / {building.max_hp}
              </dd>
            </div>
            <div>
              <dt>等级</dt>
              <dd>{building.level}</dd>
            </div>
            <div>
              <dt>视野</dt>
              <dd>{building.vision_range}</dd>
            </div>
          </dl>
        </section>

        {building.type === "traffic_monitor" ? <TrafficMonitorControls key={building.id} building={building} buildings={Object.values(planet.buildings ?? {})} faceSize={planet.surface?.face_size ?? 1} planetId={planet.planet_id} canControl={building.owner_id === session.playerId} /> : null}
        <UnitProductionControls key={building.id+"-production"} building={building} catalog={catalog} planetId={planet.planet_id} canControl={building.owner_id===session.playerId}/>
        {building.sorter ? <SorterControls key={building.id} building={building} buildings={Object.values(planet.buildings ?? {})} catalog={catalog} faceSize={planet.surface?.face_size ?? 1} sceneBounds={'bounds' in planet ? planet.bounds : undefined} planetId={planet.planet_id} canControl={building.owner_id === session.playerId} /> : null}
        {building.type === "splitter" ? <SplitterControls key={building.id} building={building} catalog={catalog} planetId={planet.planet_id} canControl={building.owner_id === session.playerId} /> : null}
        <ProcessingStatus building={building} />
        <BuildingStorageSection
          building={building}
          canControl={building.owner_id === session.playerId}
          catalog={catalog}
          completedTechIds={completedTechIds}
          onCommandSettled={onCommandSettled}
          onOpenWorkflow={onOpenWorkflow}
          planetId={planet.planet_id}
          playerInventory={myMecha?.inventory}
        />
        {Object.values(planet.buildings ?? {}).filter(candidate => candidate.distributor?.host_building_id === building.id || candidate.id === building.distributor?.host_building_id).map(candidate => (
          <button key={candidate.id} className="secondary-button" onClick={() => usePlanetViewStore.getState().setSelected({ kind: 'building', id: candidate.id, position: candidate.position })}>
            {candidate.distributor ? '查看仓顶配送器' : '查看绑定仓库'}
          </button>
        ))}


        <section className="planet-side-section">
          <div className="section-title">网络与运行态</div>
          <dl className="planet-kv-list">
            <div>
              <dt>供电</dt>
              <dd>
                {powerCoverage
                  ? powerCoverage.connected
                    ? "已接入"
                    : `未接入:${translatePowerCoverageReason(powerCoverage.reason)}`
                  : "-"}
              </dd>
            </div>
            <div>
              <dt>电力分配</dt>
              <dd>
                {powerCoverage
                  ? `${powerCoverage.allocated ?? 0}/${powerCoverage.demand ?? 0}`
                  : "-"}
              </dd>
            </div>
            <div>
              <dt>物流无人机</dt>
              <dd>{logisticsStation?.drone_ids?.length ?? 0}</dd>
            </div>
            <div>
              <dt>物流货船</dt>
              <dd>{logisticsStation?.ship_ids?.length ?? 0}</dd>
            </div>
          </dl>
        </section>

        {logisticsStation?.state && building.type !== "orbital_collector" ? <LogisticsStationControls key={building.id} building={building} state={logisticsStation.state} runtime={runtime} catalog={catalog} planetId={planet.planet_id} canControl={building.owner_id === session.playerId} inventory={myMecha?.inventory} /> : null}
        {building.type === "logistics_distributor" && building.distributor ? <DistributorControls key={building.id} building={building} host={Object.values(planet.buildings ?? {}).find(candidate => candidate.id === building.distributor?.host_building_id)} runtime={runtime} catalog={catalog} planetId={planet.planet_id} canControl={building.owner_id === session.playerId} inventory={myMecha?.inventory} /> : null}

        {showLogisticsDetails ? (
          <>
            <section className="planet-side-section">
              <div className="section-title">物流站基础</div>
              <dl className="planet-kv-list">
                <div>
                  <dt>站点类型</dt>
                  <dd>
                    {getBuildingDisplayName(
                      catalog,
                      logisticsStation?.building_type ?? building.type,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>无人机数</dt>
                  <dd>{logisticsStation?.drone_ids?.length ?? 0}</dd>
                </div>
                <div>
                  <dt>货船数</dt>
                  <dd>{logisticsStation?.ship_ids?.length ?? 0}</dd>
                </div>
                <div>
                  <dt>无人机槽位上限</dt>
                  <dd>{logisticsStation?.state?.drone_capacity ?? "-"}</dd>
                </div>
              </dl>
            </section>

            <section className="planet-side-section">
              <div className="section-title">优先级</div>
              <dl className="planet-kv-list">
                <div>
                  <dt>输入优先级</dt>
                  <dd>{logisticsStation?.state?.priority.input ?? "-"}</dd>
                </div>
                <div>
                  <dt>输出优先级</dt>
                  <dd>{logisticsStation?.state?.priority.output ?? "-"}</dd>
                </div>
              </dl>
            </section>

            {building.type === "interstellar_logistics_station" ? (
              <section className="planet-side-section">
                <div className="section-title">星际配置</div>
                <dl className="planet-kv-list">
                  <div>
                    <dt>启用星际运输</dt>
                    <dd>
                      {logisticsStation?.state?.interstellar.enabled
                        ? "是"
                        : "否"}
                    </dd>
                  </div>
                  <div>
                    <dt>启用曲速</dt>
                    <dd>
                      {logisticsStation?.state?.interstellar.warp_enabled
                        ? "是"
                        : "否"}
                    </dd>
                  </div>
                  <div>
                    <dt>货船槽位</dt>
                    <dd>
                      {logisticsStation?.state?.interstellar.ship_slots ?? "-"}
                    </dd>
                  </div>
                </dl>
              </section>
            ) : null}

            <section className="planet-side-section">
              <div className="section-title">行星槽位</div>
              {planetarySettings.length > 0 ? (
                <ul className="timeline-list timeline-list--dense">
                  {planetarySettings.map((setting) => (
                    <li key={`planetary-${setting.item_id}`}>
                      <strong>{setting.item_name}</strong>
                      <span>
                        {setting.item_id} · {translateLogisticsMode(setting.mode)} · 本地库存{" "}
                        {setting.local_storage}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="subtle-text">暂无槽位</p>
              )}
            </section>

            {building.type === "interstellar_logistics_station" ? (
              <section className="planet-side-section">
                <div className="section-title">星际槽位</div>
                {interstellarSettings.length > 0 ? (
                  <ul className="timeline-list timeline-list--dense">
                    {interstellarSettings.map((setting) => (
                      <li key={`interstellar-${setting.item_id}`}>
                        <strong>{setting.item_name}</strong>
                        <span>
                          {setting.item_id} · {translateLogisticsMode(setting.mode)} · 本地库存{" "}
                          {setting.local_storage}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="subtle-text">暂无槽位</p>
                )}
              </section>
            ) : null}

            <section className="planet-side-section">
              <div className="section-title">库存与缓存摘要</div>
              <dl className="planet-kv-list">
                <div>
                  <dt>{translateUi("field.inventory")}</dt>
                  <dd>
                    {formatItemInventorySummary(
                      catalog,
                      logisticsStation?.state?.inventory,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{translateUi("field.input_cache")}</dt>
                  <dd>
                    {formatItemInventorySummary(
                      catalog,
                      logisticsStation?.state?.cache?.supply,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{translateUi("field.demand_cache")}</dt>
                  <dd>
                    {formatItemInventorySummary(
                      catalog,
                      logisticsStation?.state?.cache?.demand,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{translateUi("field.local_cache")}</dt>
                  <dd>
                    {formatItemInventorySummary(
                      catalog,
                      logisticsStation?.state?.cache?.local,
                    )}
                  </dd>
                </div>
                {building.type === "interstellar_logistics_station" ? (
                  <>
                    <div>
                      <dt>星际供给缓存</dt>
                      <dd>
                        {formatItemInventorySummary(
                          catalog,
                          logisticsStation?.state?.interstellar_cache?.supply,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>星际需求缓存</dt>
                      <dd>
                        {formatItemInventorySummary(
                          catalog,
                          logisticsStation?.state?.interstellar_cache?.demand,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>星际本地缓存</dt>
                      <dd>
                        {formatItemInventorySummary(
                          catalog,
                          logisticsStation?.state?.interstellar_cache?.local,
                        )}
                      </dd>
                    </div>
                  </>
                ) : null}
              </dl>
            </section>
          </>
        ) : null}
      </div>
    );
  }

  if (selected.kind === "squad") {
    const squad = entity as CombatSquad | null;
    if (!squad) {
      return (
        <div className="planet-panel-stack">
          <section className="planet-side-section">
            <div className="section-title">小队详情</div>
            <p className="subtle-text">小队已不可见或已被摧毁，请重新选择。</p>
          </section>
        </div>
      );
    }
    const members = (squad.member_ids ?? []).flatMap((id) => (planet.units?.[id] ? [planet.units[id]] : []));
    const taskForceId = findSquadTaskForceId(taskForces ?? [], squad.id);
    const taskForce = (taskForces ?? []).find((item) => item.id === taskForceId);
    return (
      <div className="planet-panel-stack">
        <section className="planet-side-section">
          <div className="section-title">小队卡片</div>
          <UnitCard card={unitCardFromSquad(squad, members, catalog)} />
        </section>
        <section className="planet-side-section">
          <div className="section-title">编队归属</div>
          <dl className="planet-kv-list">
            <div>
              <dt>所属任务群</dt>
              <dd>{taskForce ? `${taskForce.name || taskForce.id} (${taskForce.id})` : "未编组"}</dd>
            </div>
            <div>
              <dt>坐标</dt>
              <dd>{formatPosition(squad.position)}</dd>
            </div>
          </dl>
          {taskForce ? (
            <p className="subtle-text">右键点地图可把所属任务群部署到目标点。</p>
          ) : (
            <p className="subtle-text">未编入任务群的小队无法接受部署：到战争页「战区」面板编组。</p>
          )}
        </section>
      </div>
    );
  }

  if (selected.kind === "unit" && entity) {
    const unit = entity as Unit;
    // 单位已不在相机窗口（用累积缓存渲染）：坐标是最后一次见到的位置，给一行说明避免误读。
    const offWindow = !planet.units?.[unit.id];
    return (
      <div className="planet-panel-stack">
        {offWindow ? (
          <section className="planet-side-section">
            <p className="subtle-text">单位不在当前镜头窗口：下面显示的是最后一次见到的状态，面板保持可用。</p>
          </section>
        ) : null}
        <MechaControls
          catalog={catalog}
          mecha={selectMechaById(summary, session.playerId, unit.id)}
          planetId={planet.planet_id}
          player={summary?.players?.[session.playerId]}
          tickRate={tickRate}
          unit={unit}
        />
        <section className="planet-side-section">
          <div className="section-title">单位详情</div>
          <UnitCard card={unitCardFromRuntimeUnit(unit, translateUnitType(unit.type), catalog)} />
          <dl className="planet-kv-list">
            <div>
              <dt>编号</dt>
              <dd>{unit.id}</dd>
            </div>
            <div>
              <dt>类型</dt>
              <dd>{translateUnitType(unit.type)}</dd>
            </div>
            <div>
              <dt>所属</dt>
              <dd>{unit.owner_id}</dd>
            </div>
            <div>
              <dt>坐标</dt>
              <dd>{formatPosition(unit.position)}</dd>
            </div>
            <div>
              <dt>血量</dt>
              <dd>
                {unit.hp} / {unit.max_hp}
              </dd>
            </div>
            <div>
              <dt>攻击 / 防御</dt>
              <dd>
                {unit.attack} / {unit.defense}
              </dd>
            </div>
            <div>
              <dt>移动状态</dt>
              <dd>{unitIsMoving(unit) ? "移动中" : unit.stance === 'hold' ? "坚守" : "待命"}</dd>
            </div>
            {/* 运输机器人（§2.1）：模式、当前任务两端、阶段、载货与已送达累计。 */}
            {isTransportRobot(unit) ? (
              <>
                <div>
                  <dt>运输模式</dt>
                  <dd>{HAUL_MODE_LABELS[transportHaulMode(unit) ?? 'auto']}（{describeHaul(
                    unit,
                    (itemId) => getItemDisplayName(catalog, itemId),
                    (buildingId) => {
                      const building = planet.buildings?.[buildingId];
                      return building ? getBuildingDisplayName(catalog, building.type) : undefined;
                    },
                  ) ?? '自动待命'}）</dd>
                </div>
                <div>
                  <dt>起点 / 终点</dt>
                  <dd>
                    {(() => {
                      const task = transportHaulTask(unit);
                      if (!task) return '-';
                      const from = planet.buildings?.[task.from_building_id];
                      const to = planet.buildings?.[task.to_building_id];
                      const label = (buildingId: string, building: typeof from) => building
                        ? `${getBuildingDisplayName(catalog, building.type)} (${buildingId})`
                        : `${buildingId}（已不存在）`;
                      // 自动模式车上带货改派时没有取货端，显示「车上」。
                      const fromLabel = task.from_building_id ? label(task.from_building_id, from) : '车上（改派）';
                      return `${fromLabel} → ${label(task.to_building_id, to)}`;
                    })()}
                  </dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>目标</dt>
              <dd>
                {unit.attack_target || formatPosition(unitMoveDestination(unit)) || "-"}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    );
  }

  if (selected.kind === "resource" && entity) {
    const resource = entity as PlanetResource;
    return (
      <div className="planet-panel-stack">
        <section className="planet-side-section">
          <div className="section-title">资源点详情</div>
          <dl className="planet-kv-list">
            <div>
              <dt>编号</dt>
              <dd>{resource.id}</dd>
            </div>
            <div>
              <dt>种类</dt>
              <dd>{getItemDisplayName(catalog, resource.kind)}</dd>
            </div>
            <div>
              <dt>行为</dt>
              <dd>{resource.behavior}</dd>
            </div>
            <div>
              <dt>坐标</dt>
              <dd>{formatPosition(resource.position)}</dd>
            </div>
            <div>
              <dt>剩余量</dt>
              <dd>{resource.remaining ?? "-"}</dd>
            </div>
            <div>
              <dt>当前产率</dt>
              <dd>{resource.current_yield ?? "-"}</dd>
            </div>
            <div>
              <dt>稀有资源</dt>
              <dd>{resource.is_rare ? "是" : "否"}</dd>
            </div>
          </dl>
        </section>
      </div>
    );
  }

  return (
    <div className="planet-panel-stack">
      <section className="planet-side-section">
        <div className="section-title">实体详情</div>
        <p className="subtle-text">选中对象已不可见或已被移除，请重新选择。</p>
      </section>
    </div>
  );
}

interface PlanetActivityPanelProps {
  alerts: AlertEntry[];
  events: GameEventDetail[];
  planet: PlanetRenderView;
}

export function PlanetActivityPanel({
  alerts,
  events,
  planet,
}: PlanetActivityPanelProps) {
  const activityMode = usePlanetCommandStore((state) => state.activityMode);
  const setActivityMode = usePlanetCommandStore((state) => state.setActivityMode);
  const { requestFocus, setSelected } = usePlanetViewStore(
    useShallow((state) => ({
      requestFocus: state.requestFocus,
      setSelected: state.setSelected,
    })),
  );

  const filteredEvents = useMemo(
    () => {
      if (activityMode === "key_feedback") {
        return events.filter(
          (event) =>
            event.event_type !== "production_alert"
            && !DEFAULT_SSE_SILENT_EVENT_TYPES.has(event.event_type),
        );
      }
      if (activityMode === "all") {
        return events;
      }
      if (activityMode === "command_only") {
        return events.filter((event) => event.event_type === "command_result");
      }
      if (activityMode === "alerts_only") {
        return events.filter((event) => event.event_type === "production_alert");
      }
      return events.filter(
        (event) => !DEFAULT_SSE_SILENT_EVENT_TYPES.has(event.event_type),
      );
    },
    [activityMode, events],
  );

  // 研究站（无配方 matrix_lab 等）的吞吐类告警是噪音，统一过滤（见 production-alerts）
  const visibleAlerts = useMemo(
    () => alerts.filter((alert) => !isResearchStationAlertNoise(alert)),
    [alerts],
  );

  // 同一建筑的同类告警合并为一条（带计数）：服务端每 3000 tick 重复提醒一次，
  // 不合并会刷屏（试玩报告：采矿机满仓后同一建筑刷 5 条）。
  const groupedAlerts = useMemo(() => {
    const byKey = new Map<string, { alert: AlertEntry; count: number; lastTick: number }>();
    for (const alert of visibleAlerts) {
      const key = `${alert.building_id}::${alert.alert_type}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
        existing.lastTick = Math.max(existing.lastTick, alert.tick);
        // 展示用最新一条（tick 更大者）
        if (alert.tick >= existing.alert.tick) existing.alert = alert;
        continue;
      }
      byKey.set(key, { alert, count: 1, lastTick: alert.tick });
    }
    return [...byKey.values()];
  }, [visibleAlerts]);

  // V3：新增告警条目入场闪烁（首次填充不闪）
  const freshAlertIds = useNewItemIds(visibleAlerts, (alert) => alert.alert_id);

  function focusSelection(
    selection: ReturnType<typeof resolveSelectionFromEvent>,
  ) {
    if (!selection) {
      return;
    }
    setSelected(selection);
    requestFocus(toTilePoint(selection.position));
  }

  return (
    <div className="split-panel planet-activity-grid">
      <section className="panel split-panel__section">
        <div className="planet-activity-header">
          <div className="section-title">事件时间线</div>
          <label className="planet-filter">
            <span>{translateUi("field.event_filter")}</span>
            <select
              onChange={(event) =>
                setActivityMode(
                  event.target.value as
                    | "key_feedback"
                    | "all"
                    | "command_only"
                    | "alerts_only",
                )
              }
              value={activityMode}
            >
              <option value="key_feedback">关键反馈</option>
              <option value="all">全部事件</option>
              <option value="command_only">仅命令</option>
              <option value="alerts_only">仅告警</option>
            </select>
          </label>
        </div>
        <ul className="timeline-list timeline-list--dense">
          {filteredEvents.length === 0 ? <li>暂无事件</li> : null}
          {filteredEvents.map((event) => (
            <li key={event.event_id}>
              <div className="timeline-list__row">
                <strong>
                  [t{event.tick}] {translateEventType(event.event_type)}
                </strong>
                <button
                  className="secondary-button timeline-action"
                  onClick={() =>
                    focusSelection(resolveSelectionFromEvent(planet, event))
                  }
                  type="button"
                >
                  定位
                </button>
              </div>
              <span>{summarizeEvent(event)}</span>
              <details>
                <summary>payload</summary>
                <pre className="json-preview">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel split-panel__section">
        <div className="section-title">告警面板</div>
        <ul className="timeline-list timeline-list--dense">
          {groupedAlerts.length === 0 ? <li>暂无告警</li> : null}
          {groupedAlerts.map(({ alert, count }) => {
            const presentation = describeAlert(planet, alert);
            const isFresh = freshAlertIds.has(alert.alert_id);
            return (
              <li
                className={isFresh ? "alert-flash" : undefined}
                key={`${alert.building_id}::${alert.alert_type}`}
              >
                <div className="timeline-list__row">
                  <strong>
                    [t{alert.tick}] {presentation.issueLabel.replace("问题：", "")}
                    {count > 1 ? ` ×${count}` : ""}
                  </strong>
                  <button
                    className="secondary-button timeline-action"
                    onClick={() =>
                      focusSelection(resolveSelectionFromAlert(planet, alert))
                    }
                    type="button"
                  >
                    定位
                  </button>
                </div>
                <span>{presentation.buildingLabel}</span>
                <span>{presentation.issueLabel}</span>
                {count > 1 ? <span className="subtle-text">同类告警合并 ×{count}</span> : null}
                <span>{presentation.recommendationLabel}</span>
                <details>
                  <summary>运行指标</summary>
                  <div className="subtle-text">{presentation.metricsLabel}</div>
                </details>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/**
 * 3D 相机视口快照：调试面板的分享链接/视口 JSON 在 3D 下按
 * 「中心格 + zoom + tilt」导出，不再用 2D 的 tileSize/offset 视口矩形。
 * 类型定义在 `planet-map-capture.ts`（与 capture.getViewport 同处）。
 */
import type { PlanetThreeViewportSnapshot } from "./planet-map-capture";

interface PlanetDebugPanelProps {
  catalog?: CatalogView;
  /** 行星地图截图捕获句柄（Pixi extract / 3D 画布）；尚未就绪时为 null。 */
  capture: PlanetMapCapture | null;
  currentTick: number;
  /** 本局概要（GET /games/current）：判断 admin 身份与多人门禁提示。 */
  game?: GameSummary;
  networks?: PlanetNetworksView;
  onPullEvents: () => Promise<void>;
  onRefreshFog: () => Promise<unknown>;
  onRefreshPlanet: () => Promise<unknown>;
  planet: PlanetRenderView;
  runtime?: PlanetRuntimeView;
}

/**
 * 3D 视口导出（R20-A ④）：分享链接与视口 JSON 的 3D 口径，抽成纯函数便于单测。
 * 2D 的 offset/tileSize 视口矩形在 3D 下不适用——相机状态是「中心格 + 高度(zoom) + 俯仰」。
 */
export function buildThreeShareUrl(options: {
  href: string;
  selected: SelectedEntity | null;
  layers: PlanetLayerVisibility;
  viewport: PlanetThreeViewportSnapshot;
}): string {
  const params = buildViewLinkSearchParams(
    options.selected,
    options.layers,
    {
      minX: options.viewport.center?.x ?? 0,
      minY: options.viewport.center?.y ?? 0,
      maxX: options.viewport.center?.x ?? 0,
      maxY: options.viewport.center?.y ?? 0,
      centerX: options.viewport.center?.x ?? 0,
      centerY: options.viewport.center?.y ?? 0,
    },
    options.viewport.altitude,
  );
  params.set("view", "3d");
  params.set("tilt", String(Number(options.viewport.tilt.toFixed(3))));
  const url = new URL(options.href);
  url.search = params.toString();
  return url.toString();
}

/**
 * 3D 视口快照按需读取（R20-A ⑥）：调试面板打开/点「复制链接」时调用 `capture.getViewport()`，
 * 不在挂载时上报一次。capture 未就绪时返回 null。
 */
export function readThreeViewport(capture: PlanetMapCapture | null | undefined): PlanetThreeViewportSnapshot | null {
  if (!capture?.getViewport) return null;
  try {
    return capture.getViewport();
  } catch {
    return null;
  }
}

/** 分享链接的 3D 深链参数（单测用：生成的链接再解析回来要得到同一中心格与 tilt）。 */
export interface ThreeViewLinkParams {
  center: { x: number; y: number } | null;
  zoom: number;
  tilt: number;
}

/** 从分享链接解析 3D 相机参数（与 buildThreeShareUrl 互逆）。 */
export function parseThreeViewLink(href: string): ThreeViewLinkParams {
  const params = new URL(href).searchParams;
  const x = Number(params.get("x"));
  const y = Number(params.get("y"));
  const zoom = Number(params.get("zoom"));
  const tilt = Number(params.get("tilt"));
  return {
    center: Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null,
    zoom: Number.isFinite(zoom) ? zoom : 0,
    tilt: Number.isFinite(tilt) ? tilt : 0,
  };
}

export function PlanetDebugPanel({
  catalog,
  capture,
  currentTick,
  game,
  networks,
  onPullEvents,
  onRefreshFog,
  onRefreshPlanet,
  planet,
  runtime,
}: PlanetDebugPanelProps) {
  // 3D 视口快照**不**在渲染期读取：只在面板打开/点「复制链接」/导出 JSON 时现拉
  // （R20-A ⑥，旧实现挂载时上报一次，scene 没就绪时快照永远不可用）。
  const readViewportNow = () => readThreeViewport(capture);
  const {
    debugOpen,
    hoveredTile,
    lastEventId,
    lastFullSyncAt,
    layers,
    requestFocus,
    selected,
    sseStatus,
  } = usePlanetViewStore(
    useShallow((state) => ({
      debugOpen: state.debugOpen,
      hoveredTile: state.hoveredTile,
      lastEventId: state.lastEventId,
      lastFullSyncAt: state.lastFullSyncAt,
      layers: state.layers,
      requestFocus: state.requestFocus,
      selected: state.selected,
      sseStatus: state.sseStatus,
    })),
  );
  const [shareMessage, setShareMessage] = useState("");
  const client = useApiClient();
  const session = useSessionSnapshot();
  // 狂飙模式表单：默认「按 tick 数推进 500 tick」+ 三个停止条件全开。
  const [advanceForm, setAdvanceForm] = useState<AdvanceFormState>(defaultAdvanceForm);
  const [advanceBusy, setAdvanceBusy] = useState(false);
  const [advanceError, setAdvanceError] = useState("");
  const [advanceResult, setAdvanceResult] = useState("");
  const adminAllowed = isAdminPlayer(game, session.playerId);

  function patchAdvanceForm(patch: Partial<AdvanceFormState>) {
    setAdvanceForm((form) => ({ ...form, ...patch }));
  }

  async function startAdvance() {
    const built = buildAdvanceRequest(advanceForm, currentTick);
    if ("error" in built) {
      setAdvanceError(built.error);
      return;
    }
    setAdvanceBusy(true);
    setAdvanceError("");
    setAdvanceResult("");
    try {
      const result = await client.sendAdvance(built.request);
      setAdvanceResult(describeAdvanceResult(result));
      // 快进结束时服务端也发 fast_forward_finished（SSE 侧统一做全量刷新），
      // 这里直接调用能覆盖 SSE 未连接/降采样窗口的场合。
      await onRefreshPlanet();
    } catch (error) {
      setAdvanceError(error instanceof Error ? error.message : String(error));
    } finally {
      setAdvanceBusy(false);
    }
  }

  async function cancelAdvance() {
    setAdvanceBusy(true);
    setAdvanceError("");
    try {
      const result = await client.cancelAdvance();
      if (!result.cancelled) {
        setAdvanceResult("当前没有进行中的快进");
      }
    } catch (error) {
      setAdvanceError(error instanceof Error ? error.message : String(error));
    } finally {
      setAdvanceBusy(false);
    }
  }

  function exportScreenshot() {
    // Pixi 舞台（底图 + 实体 + 交互叠加）经 extract 整体抓成 canvas，直接导出 PNG。
    const shot = capture?.captureScreenshot();
    if (!shot) {
      return;
    }
    const link = document.createElement("a");
    link.href = shot.toDataURL("image/png");
    link.download = `${planet.planet_id}-tick-${currentTick}.png`;
    link.click();
  }

  function exportSelectionJson() {
    const payload = buildSelectionExport(planet, selected);
    downloadData(
      `${planet.planet_id}-selection.json`,
      JSON.stringify(payload, null, 2),
      "application/json",
    );
  }

  function buildShareUrl() {
    if (typeof window === "undefined") {
      return "";
    }
    // 3D（R20-A ④⑥）：视口 = 中心格 + zoom（相机高度）+ tilt，2D 的 offset/tileSize 不适用。
    // 点「复制链接」时**现拉** scene.getCameraState()，拿到的是此刻的相机，不是挂载时的。
    const viewport = readViewportNow();
    if (viewport) {
      return buildThreeShareUrl({ href: window.location.href, selected, layers, viewport });
    }
    // 3D 但场景还没就绪（没有相机状态）：链接里只带 view=3d 与图层/选中，
    // 不带相机位置（否则链接会回到错误的位置）。
    const params = buildViewLinkSearchParams(selected, layers, {
      minX: 0, minY: 0, maxX: 0, maxY: 0, centerX: 0, centerY: 0,
      wrapX: false, wrapY: false, mapWidth: planet.map_width, mapHeight: planet.map_height,
    }, 0);
    params.set("view", "3d");
    const url = new URL(window.location.href);
    url.search = params.toString();
    return url.toString();
  }

  async function copyShareLink() {
    const url = buildShareUrl();
    if (!url || typeof navigator === "undefined" || !navigator.clipboard) {
      setShareMessage("当前环境不支持剪贴板");
      return;
    }
    await navigator.clipboard.writeText(url);
    setShareMessage("视角链接已复制");
  }

  function exportViewportJson() {
    // 3D（R20-A ⑥）：导出时**现拉**相机状态，并按 scene 当前场景窗口（store.sceneWindow）
    // 裁剪可见集合；拿不到场景窗口时不裁剪，JSON 里标 `bounds: null`。
    const viewport = readViewportNow();
    const sceneWindow = usePlanetViewStore.getState().sceneWindow;
    const bounds = sceneWindow
      ? {
        minX: sceneWindow.x,
        minY: sceneWindow.y,
        maxX: sceneWindow.x + sceneWindow.width - 1,
        maxY: sceneWindow.y + sceneWindow.height - 1,
        centerX: sceneWindow.x + sceneWindow.width / 2,
        centerY: sceneWindow.y + sceneWindow.height / 2,
        wrapX: false,
        wrapY: false,
        mapWidth: planet.map_width,
        mapHeight: planet.map_height,
      }
      : null;
    const payload = buildViewportExport({
      planet,
      runtime,
      networks,
      catalog,
      selection: selected,
      layers,
      tileSize: 1,
      viewportWidth: viewport?.width || capture?.clientWidth || 1,
      viewportHeight: viewport?.height || capture?.clientHeight || 1,
      shareUrl: buildShareUrl(),
      bounds,
    });
    const withCamera = {
      ...payload,
      viewport: {
        ...payload.viewport,
        mode: "3d" as const,
        bounds,
        center: viewport?.center ?? null,
        zoom: viewport?.altitude ?? 0,
        tilt: viewport?.tilt ?? 0,
        width: viewport?.width ?? capture?.clientWidth ?? 0,
        height: viewport?.height ?? capture?.clientHeight ?? 0,
      },
    };
    downloadData(
      `${planet.planet_id}-viewport.json`,
      JSON.stringify(withCamera, null, 2),
      "application/json",
    );
  }

  return (
    <div
      className={debugOpen ? "debug-panel debug-panel--open" : "debug-panel"}
    >
      {/* 展开/收起入口在左下工具条的调试图标里（§3.2 复核）：过去这里单独挂一个
          「展开调试」文字按钮，浮在顶部中右侧的地图上非常突兀。
          收起态整个面板不渲染，不给地图留空壳。 */}
      {debugOpen ? (
        <div className="debug-panel__body">
          <div className="section-title">
            调试面板
            <small className="debug-panel__hint">（{DEBUG_PANEL_HOTKEY_LABEL} 显示/隐藏）</small>
          </div>

          <div className="debug-panel__section">
            <div className="section-title">狂飙模式 / 快进</div>
            {adminAllowed ? (
              <div className="debug-panel__advance">
                {/* 280px 窄面板：单选项一行（文字不换行）排在输入框上方。
                    过去 radio 与输入框同行，中文标签被挤成竖排三行。 */}
                <div className="debug-panel__advance-modes" role="radiogroup">
                  <label className="debug-panel__advance-mode">
                    <input
                      checked={advanceForm.mode === "ticks"}
                      name="advance-mode"
                      onChange={() => patchAdvanceForm({ mode: "ticks" })}
                      type="radio"
                    />
                    <span>推进 tick 数</span>
                  </label>
                  <label className="debug-panel__advance-mode">
                    <input
                      checked={advanceForm.mode === "to_tick"}
                      name="advance-mode"
                      onChange={() => patchAdvanceForm({ mode: "to_tick" })}
                      type="radio"
                    />
                    <span>推进到 tick</span>
                  </label>
                </div>
                <input
                  aria-label={advanceForm.mode === "ticks" ? "快进 tick 数" : "快进目标 tick"}
                  className="debug-panel__advance-input"
                  inputMode="numeric"
                  onChange={(event) =>
                    advanceForm.mode === "ticks"
                      ? patchAdvanceForm({ ticks: event.target.value })
                      : patchAdvanceForm({ toTick: event.target.value })
                  }
                  type="text"
                  value={advanceForm.mode === "ticks" ? advanceForm.ticks : advanceForm.toTick}
                />
                <div className="debug-panel__advance-stops">
                  <label className="debug-panel__advance-stop">
                    <input
                      checked={advanceForm.stopOn.underAttack}
                      onChange={(event) =>
                        patchAdvanceForm({
                          stopOn: { ...advanceForm.stopOn, underAttack: event.target.checked },
                        })
                      }
                      type="checkbox"
                    />
                    <span>受袭即停</span>
                  </label>
                  <label className="debug-panel__advance-stop">
                    <input
                      checked={advanceForm.stopOn.criticalAlert}
                      onChange={(event) =>
                        patchAdvanceForm({
                          stopOn: { ...advanceForm.stopOn, criticalAlert: event.target.checked },
                        })
                      }
                      type="checkbox"
                    />
                    <span title="快进期间新出现的缺电 / 缺料停工告警">关键警报即停</span>
                  </label>
                  <label className="debug-panel__advance-stop">
                    <input
                      checked={advanceForm.stopOn.gameOver}
                      onChange={(event) =>
                        patchAdvanceForm({
                          stopOn: { ...advanceForm.stopOn, gameOver: event.target.checked },
                        })
                      }
                      type="checkbox"
                    />
                    <span>对局结束即停</span>
                  </label>
                </div>
                <div className="debug-panel__advance-row">
                  <button
                    className="secondary-button"
                    disabled={advanceBusy}
                    onClick={() => {
                      void startAdvance();
                    }}
                    type="button"
                  >
                    {advanceBusy ? "快进中…" : "开始快进"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      void cancelAdvance();
                    }}
                    type="button"
                  >
                    取消快进
                  </button>
                </div>
              </div>
            ) : (
              <p className="subtle-text">
                快进需要 admin 身份（当前账号不是 admin）。多人对局里也只有 admin 可以快进。
              </p>
            )}
            {advanceError ? <p className="error-text">{advanceError}</p> : null}
            {advanceResult ? <p className="subtle-text">{advanceResult}</p> : null}
          </div>
          <dl className="planet-kv-list">
            <div>
              <dt>当前 tick</dt>
              <dd>{currentTick}</dd>
            </div>
            <div>
              <dt>SSE</dt>
              <dd>{sseStatus}</dd>
            </div>
            <div>
              <dt>最后事件</dt>
              <dd>{lastEventId || "-"}</dd>
            </div>
            <div>
              <dt>最近全量同步</dt>
              <dd>{formatTimestamp(lastFullSyncAt)}</dd>
            </div>
            {/* 相机是「中心格 + 高度 + 俯仰」（R20-A ⑥）。 */}
            <div>
              <dt>相机</dt>
              <dd>
                {(() => {
                  const view = readThreeViewport(capture);
                  return view?.center ? `${view.center.x}, ${view.center.y}` : "-";
                })()}
              </dd>
            </div>
            <div>
              <dt>缩放 / 俯仰</dt>
              <dd>
                {(() => {
                  const view = readThreeViewport(capture);
                  if (!view) return "-";
                  return `${view.altitude > 0 ? view.altitude.toFixed(1) : "-"} / ${view.tilt.toFixed(2)}`;
                })()}
              </dd>
            </div>
            <div>
              <dt>Hover</dt>
              <dd>
                {hoveredTile ? `${hoveredTile.x}, ${hoveredTile.y}` : "-"}
              </dd>
            </div>
            <div>
              <dt>选中编号</dt>
              <dd>{selectionEntityId(selected) || "-"}</dd>
            </div>
          </dl>

          <div className="debug-panel__actions">
            <button
              className="secondary-button"
              onClick={() => {
                void onRefreshPlanet();
              }}
              type="button"
            >
              重拉行星
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                void onRefreshFog();
              }}
              type="button"
            >
              重拉场景
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                void onPullEvents();
              }}
              type="button"
            >
              补拉事件
            </button>
            <button
              className="secondary-button"
              onClick={exportScreenshot}
              type="button"
            >
              导出 PNG
            </button>
            <button
              className="secondary-button"
              onClick={exportSelectionJson}
              type="button"
            >
              导出 JSON
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                void copyShareLink();
              }}
              type="button"
            >
              复制视角链接
            </button>
            <button
              className="secondary-button"
              onClick={exportViewportJson}
              type="button"
            >
              导出视角 JSON
            </button>
            {selected ? (
              <button
                className="secondary-button"
                onClick={() => requestFocus(toTilePoint(selected.position))}
                type="button"
              >
                聚焦选中
              </button>
            ) : null}
          </div>
          {shareMessage ? <p className="subtle-text">{shareMessage}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
