import { useMemo, useState } from "react";

import { useShallow } from "zustand/react/shallow";

import { DEFAULT_SSE_SILENT_EVENT_TYPES } from "@shared/config";
import type {
  AlertEntry,
  Building,
  CatalogView,
  FogMapView,
  GameEventDetail,
  PlanetNetworksView,
  PlanetResource,
  PlanetRuntimeView,
  PlayerStatsSnapshot,
  StateSummary,
  Unit,
} from "@shared/types";

import {
  buildSelectionExport,
  buildViewLinkSearchParams,
  buildViewportExport,
  findLogisticsStation,
  findSelectionEntity,
  formatItemInventorySummary,
  formatPosition,
  getBuildingDisplayName,
  getFogState,
  getItemDisplayName,
  getResourceList,
  getTerrainTile,
  getViewportTileBounds,
  getTechDisplayName,
  isLogisticsStationBuildingType,
  listLogisticsStationSettings,
  PLANET_LAYER_LABELS,
  resolveSelectionFromAlert,
  resolveSelectionFromEvent,
  selectionEntityId,
  selectionLabel,
  summarizeAlert,
  summarizeEvent,
  toTilePoint,
  type PlanetRenderView,
} from "@/features/planet-map/model";
import { usePlanetCommandStore } from "@/features/planet-commands/store";
import { resolvePlanetCommandHint } from "@/features/planet-commands/error-hints";
import {
  translateAlertType,
  translateBuildingState,
  translateEventType,
  translateLogisticsMode,
  translatePowerCoverageReason,
  translateUi,
  translateUnitType,
} from "@/i18n/translate";
import {
  getPlanetRenderTileSize,
  getPlanetZoomScale,
  getPlanetZoomStatusLabel,
  PLANET_ZOOM_LEVELS,
  usePlanetViewStore,
} from "@/features/planet-map/store";

function formatRatio(value: number | undefined) {
  if (value === undefined) {
    return "-";
  }
  return `${Math.round(value * 100)}%`;
}

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
    camera,
    hoveredTile,
    layers,
    resetCamera,
    selected,
    setZoomIndex,
    toggleLayer,
  } = usePlanetViewStore(
    useShallow((state) => ({
      camera: state.camera,
      hoveredTile: state.hoveredTile,
      layers: state.layers,
      resetCamera: state.resetCamera,
      selected: state.selected,
      setZoomIndex: state.setZoomIndex,
      toggleLayer: state.toggleLayer,
    })),
  );

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
          {Object.entries(layers).map(([key, enabled]) => (
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
          {PLANET_ZOOM_LEVELS.map((zoomLevel, index) => (
            <button
              className={
                index === camera.zoomIndex
                  ? "secondary-button zoom-button zoom-button--active"
                  : "secondary-button zoom-button"
              }
              key={zoomLevel.label}
              onClick={() => setZoomIndex(index)}
              type="button"
            >
              {zoomLevel.label}
            </button>
          ))}
          <button
            className="secondary-button zoom-button"
            onClick={resetCamera}
            type="button"
          >
            重置视角
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
}

export function PlanetEntityPanel({
  catalog,
  fog,
  networks,
  planet,
  runtime,
  stats,
  summary,
}: PlanetEntityPanelProps) {
  const { selected } = usePlanetViewStore(
    useShallow((state) => ({
      selected: state.selected,
    })),
  );

  const entity = findSelectionEntity(planet, selected);
  const currentResearchId =
    Object.values(summary?.players ?? {}).find(
      (player) => player.tech?.current_research,
    )?.tech?.current_research?.tech_id ?? "";

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
                {constructionTasks.map((task) => task.id).join(", ") || "-"}
              </dd>
            </div>
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
              <dt>ID</dt>
              <dd>{building.id}</dd>
            </div>
            <div>
              <dt>类型</dt>
              <dd>{buildingName}</dd>
            </div>
            <div>
              <dt>类型 ID</dt>
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

        <section className="planet-side-section">
          <div className="section-title">库存与任务</div>
          <pre className="json-preview">
            {JSON.stringify(
              {
                storage: building.storage ?? {},
                production: building.production ?? {},
                job: building.job ?? {},
              },
              null,
              2,
            )}
          </pre>
        </section>

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
                  <dt>无人机容量</dt>
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

  if (selected.kind === "unit" && entity) {
    const unit = entity as Unit;
    return (
      <div className="planet-panel-stack">
        <section className="planet-side-section">
          <div className="section-title">单位详情</div>
          <dl className="planet-kv-list">
            <div>
              <dt>ID</dt>
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
              <dd>{unit.is_moving ? "移动中" : "待命"}</dd>
            </div>
            <div>
              <dt>目标</dt>
              <dd>
                {unit.attack_target || formatPosition(unit.target_pos) || "-"}
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
              <dt>ID</dt>
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
          {alerts.length === 0 ? <li>暂无告警</li> : null}
          {alerts.map((alert) => (
            <li key={alert.alert_id}>
              <div className="timeline-list__row">
                <strong>
                  [t{alert.tick}] {translateAlertType(alert.alert_type)}
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
              <span>{summarizeAlert(alert)}</span>
              <span className="subtle-text">
                吞吐 {alert.metrics.throughput} · 堆积 {alert.metrics.backlog} ·
                效率 {formatRatio(alert.metrics.efficiency)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

interface PlanetDebugPanelProps {
  catalog?: CatalogView;
  canvas: HTMLCanvasElement | null;
  currentTick: number;
  networks?: PlanetNetworksView;
  onPullEvents: () => Promise<void>;
  onRefreshFog: () => Promise<unknown>;
  onRefreshPlanet: () => Promise<unknown>;
  planet: PlanetRenderView;
  runtime?: PlanetRuntimeView;
}

export function PlanetDebugPanel({
  catalog,
  canvas,
  currentTick,
  networks,
  onPullEvents,
  onRefreshFog,
  onRefreshPlanet,
  planet,
  runtime,
}: PlanetDebugPanelProps) {
  const {
    camera,
    debugOpen,
    hoveredTile,
    lastEventId,
    lastFullSyncAt,
    layers,
    requestFocus,
    selected,
    sseStatus,
    toggleDebugOpen,
  } = usePlanetViewStore(
    useShallow((state) => ({
      camera: state.camera,
      debugOpen: state.debugOpen,
      hoveredTile: state.hoveredTile,
      lastEventId: state.lastEventId,
      lastFullSyncAt: state.lastFullSyncAt,
      layers: state.layers,
      requestFocus: state.requestFocus,
      selected: state.selected,
      sseStatus: state.sseStatus,
      toggleDebugOpen: state.toggleDebugOpen,
    })),
  );
  const [shareMessage, setShareMessage] = useState("");

  function exportScreenshot() {
    if (!canvas?.toDataURL) {
      return;
    }
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
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
    const tileSize = getPlanetRenderTileSize(
      camera.zoomIndex,
      canvas?.clientWidth || planet.map_width,
      canvas?.clientHeight || planet.map_height,
      planet.map_width,
      planet.map_height,
    );
    const viewportWidth = canvas?.clientWidth || planet.map_width * tileSize;
    const viewportHeight = canvas?.clientHeight || planet.map_height * tileSize;
    const bounds = getViewportTileBounds(
      planet,
      camera,
      tileSize,
      viewportWidth,
      viewportHeight,
    );
    const params = buildViewLinkSearchParams(
      selected,
      layers,
      bounds,
      getPlanetZoomScale(camera.zoomIndex),
    );
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
    const tileSize = getPlanetRenderTileSize(
      camera.zoomIndex,
      canvas?.clientWidth || planet.map_width,
      canvas?.clientHeight || planet.map_height,
      planet.map_width,
      planet.map_height,
    );
    const viewportWidth = canvas?.clientWidth || planet.map_width * tileSize;
    const viewportHeight = canvas?.clientHeight || planet.map_height * tileSize;
    const payload = buildViewportExport({
      planet,
      runtime,
      networks,
      catalog,
      selection: selected,
      layers,
      camera,
      tileSize,
      viewportWidth,
      viewportHeight,
      shareUrl: buildShareUrl(),
    });
    downloadData(
      `${planet.planet_id}-viewport.json`,
      JSON.stringify(payload, null, 2),
      "application/json",
    );
  }

  return (
    <div
      className={debugOpen ? "debug-panel debug-panel--open" : "debug-panel"}
    >
      <button
        className="secondary-button debug-panel__toggle"
        onClick={toggleDebugOpen}
        type="button"
      >
        {debugOpen ? "收起调试" : "展开调试"}
      </button>

      {debugOpen ? (
        <div className="debug-panel__body">
          <div className="section-title">调试面板</div>
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
            <div>
              <dt>相机</dt>
              <dd>
                {Math.round(camera.offsetX)}, {Math.round(camera.offsetY)}
              </dd>
            </div>
            <div>
              <dt>缩放</dt>
              <dd>
                {getPlanetZoomStatusLabel(
                  camera.zoomIndex,
                  planet.map_width,
                  planet.map_height,
                )}
              </dd>
            </div>
            <div>
              <dt>Hover</dt>
              <dd>
                {hoveredTile ? `${hoveredTile.x}, ${hoveredTile.y}` : "-"}
              </dd>
            </div>
            <div>
              <dt>选中 ID</dt>
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
