import { useMemo, useState } from 'react';

import { useShallow } from 'zustand/react/shallow';

import type {
  AlertEntry,
  Building,
  CatalogView,
  FogMapView,
  GameEventDetail,
  PlanetNetworksView,
  PlanetResource,
  PlanetRuntimeView,
  PlanetView,
  PlayerStatsSnapshot,
  StateSummary,
  Unit,
} from '@shared/types';

import {
  buildSelectionExport,
  buildViewLinkSearchParams,
  buildViewportExport,
  findSelectionEntity,
  formatPosition,
  getBuildingDisplayName,
  getFogState,
  getItemDisplayName,
  getResourceList,
  getTerrainTile,
  getViewportTileBounds,
  PLANET_LAYER_LABELS,
  resolveSelectionFromAlert,
  resolveSelectionFromEvent,
  selectionEntityId,
  selectionLabel,
  summarizeAlert,
  summarizeEvent,
  toTilePoint,
  getTechDisplayName,
} from '@/features/planet-map/model';
import { PLANET_ZOOM_LEVELS, usePlanetViewStore } from '@/features/planet-map/store';

function formatRatio(value: number | undefined) {
  if (value === undefined) {
    return '-';
  }
  return `${Math.round(value * 100)}%`;
}

function formatTimestamp(timestamp: number | null) {
  if (!timestamp) {
    return '尚未同步';
  }
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
}

function downloadData(filename: string, content: string, contentType: string) {
  const link = document.createElement('a');
  link.href = `data:${contentType};charset=utf-8,${encodeURIComponent(content)}`;
  link.download = filename;
  link.click();
}

interface PlanetLayerPanelProps {
  networks?: PlanetNetworksView;
  planet: PlanetView;
  runtime?: PlanetRuntimeView;
}

export function PlanetLayerPanel({ networks, planet, runtime }: PlanetLayerPanelProps) {
  const {
    camera,
    hoveredTile,
    layers,
    resetCamera,
    selected,
    setZoomIndex,
    toggleLayer,
  } = usePlanetViewStore(useShallow((state) => ({
    camera: state.camera,
    hoveredTile: state.hoveredTile,
    layers: state.layers,
    resetCamera: state.resetCamera,
    selected: state.selected,
    setZoomIndex: state.setZoomIndex,
    toggleLayer: state.toggleLayer,
  })));

  const resources = useMemo(() => getResourceList(planet), [planet]);

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
              <span>{PLANET_LAYER_LABELS[key as keyof typeof PLANET_LAYER_LABELS]}</span>
            </label>
          ))}
        </div>
        <div className="zoom-actions">
          {PLANET_ZOOM_LEVELS.map((zoomLevel, index) => (
            <button
              className={index === camera.zoomIndex ? 'secondary-button zoom-button zoom-button--active' : 'secondary-button zoom-button'}
              key={zoomLevel}
              onClick={() => setZoomIndex(index)}
              type="button"
            >
              {zoomLevel}px
            </button>
          ))}
          <button className="secondary-button zoom-button" onClick={resetCamera} type="button">
            重置视角
          </button>
        </div>
      </section>

      <section className="planet-side-section">
        <div className="section-title">场景摘要</div>
        <dl className="planet-kv-list">
          <div>
            <dt>地图大小</dt>
            <dd>{planet.map_width} x {planet.map_height}</dd>
          </div>
          <div>
            <dt>建筑</dt>
            <dd>{Object.keys(planet.buildings ?? {}).length}</dd>
          </div>
          <div>
            <dt>单位</dt>
            <dd>{Object.keys(planet.units ?? {}).length}</dd>
          </div>
          <div>
            <dt>资源点</dt>
            <dd>{resources.length}</dd>
          </div>
          <div>
            <dt>Hover</dt>
            <dd>{hoveredTile ? `${hoveredTile.x}, ${hoveredTile.y}` : '-'}</dd>
          </div>
          <div>
            <dt>选中</dt>
            <dd>{selectionLabel(selected)}</dd>
          </div>
          <div>
            <dt>物流</dt>
            <dd>{(runtime?.logistics_drones?.length ?? 0) + (runtime?.logistics_ships?.length ?? 0)}</dd>
          </div>
          <div>
            <dt>施工</dt>
            <dd>{runtime?.construction_tasks?.length ?? 0}</dd>
          </div>
          <div>
            <dt>网络</dt>
            <dd>{(networks?.power_networks?.length ?? 0) + (networks?.pipeline_nodes?.length ?? 0)}</dd>
          </div>
          <div>
            <dt>威胁</dt>
            <dd>{runtime?.threat_level ?? 0}</dd>
          </div>
        </dl>
      </section>

      <section className="planet-side-section">
        <div className="section-title">图例</div>
        <div className="legend-list">
          <span><i className="legend-swatch legend-swatch--terrain" />可建造地形</span>
          <span><i className="legend-swatch legend-swatch--water" />水域</span>
          <span><i className="legend-swatch legend-swatch--lava" />岩浆</span>
          <span><i className="legend-swatch legend-swatch--building" />建筑</span>
          <span><i className="legend-swatch legend-swatch--unit" />单位</span>
          <span><i className="legend-swatch legend-swatch--resource" />资源点</span>
          <span><i className="legend-swatch legend-swatch--logistics" />物流轨迹</span>
          <span><i className="legend-swatch legend-swatch--power" />电网</span>
          <span><i className="legend-swatch legend-swatch--pipeline" />管网</span>
          <span><i className="legend-swatch legend-swatch--construction" />施工任务</span>
          <span><i className="legend-swatch legend-swatch--threat" />敌情</span>
          <span><i className="legend-swatch legend-swatch--fog" />未探索区域</span>
        </div>
      </section>

      <section className="planet-side-section">
        <div className="section-title">读模型状态</div>
        <dl className="planet-kv-list">
          <div>
            <dt>runtime</dt>
            <dd>{runtime?.available ? 'live' : 'inactive'}</dd>
          </div>
          <div>
            <dt>networks</dt>
            <dd>{networks?.available ? 'live' : 'inactive'}</dd>
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
      </section>
    </div>
  );
}

interface PlanetEntityPanelProps {
  catalog?: CatalogView;
  fog?: FogMapView;
  networks?: PlanetNetworksView;
  planet: PlanetView;
  runtime?: PlanetRuntimeView;
  stats?: PlayerStatsSnapshot;
  summary?: StateSummary;
}

export function PlanetEntityPanel({ catalog, fog, networks, planet, runtime, stats, summary }: PlanetEntityPanelProps) {
  const { selected } = usePlanetViewStore(useShallow((state) => ({
    selected: state.selected,
  })));

  const entity = findSelectionEntity(planet, selected);
  const currentResearchId = Object.values(summary?.players ?? {}).find((player) => player.tech?.current_research)?.tech?.current_research?.tech_id ?? '';

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
              <dd>{stats ? `${stats.energy_stats.generation} / ${stats.energy_stats.consumption}` : '-'}</dd>
            </div>
            <div>
              <dt>物流吞吐</dt>
              <dd>{stats?.logistics_stats.throughput ?? '-'}</dd>
            </div>
            <div>
              <dt>当前研究</dt>
              <dd>{currentResearchId ? getTechDisplayName(catalog, currentResearchId) : '无'}</dd>
            </div>
          </dl>
        </section>
      </div>
    );
  }

  if (selected.kind === 'tile') {
    const tile = toTilePoint(selected.position);
    const fogState = getFogState(fog, tile.x, tile.y);
    const constructionTasks = (runtime?.construction_tasks ?? []).filter((task) => (
      task.position.x === tile.x && task.position.y === tile.y
    ));
    const pipelineNode = (networks?.pipeline_nodes ?? []).find((node) => node.position.x === tile.x && node.position.y === tile.y);
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
              <dd>{fogState.visible ? '是' : '否'}</dd>
            </div>
            <div>
              <dt>已探索</dt>
              <dd>{fogState.explored ? '是' : '否'}</dd>
            </div>
            <div>
              <dt>施工任务</dt>
              <dd>{constructionTasks.map((task) => task.id).join(', ') || '-'}</dd>
            </div>
            <div>
              <dt>管网节点</dt>
              <dd>{pipelineNode?.id ?? '-'}</dd>
            </div>
          </dl>
        </section>
      </div>
    );
  }

  if (selected.kind === 'building' && entity) {
    const building = entity as Building;
    const buildingName = getBuildingDisplayName(catalog, building.type);
    const powerCoverage = networks?.power_coverage?.find((coverage) => coverage.building_id === building.id);
    const logisticsStation = runtime?.logistics_stations?.find((station) => station.building_id === building.id);
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
              <dd>{building.runtime.state}</dd>
            </div>
            <div>
              <dt>停机原因</dt>
              <dd>{building.runtime.state_reason || '-'}</dd>
            </div>
            <div>
              <dt>血量</dt>
              <dd>{building.hp} / {building.max_hp}</dd>
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
          <pre className="json-preview">{JSON.stringify({
            storage: building.storage ?? {},
            production: building.production ?? {},
            job: building.job ?? {},
          }, null, 2)}</pre>
        </section>

        <section className="planet-side-section">
          <div className="section-title">网络与运行态</div>
          <dl className="planet-kv-list">
            <div>
              <dt>供电</dt>
              <dd>{powerCoverage ? (powerCoverage.connected ? '已接入' : `未接入:${powerCoverage.reason || 'unknown'}`) : '-'}</dd>
            </div>
            <div>
              <dt>电力分配</dt>
              <dd>{powerCoverage ? `${powerCoverage.allocated ?? 0}/${powerCoverage.demand ?? 0}` : '-'}</dd>
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
          {logisticsStation?.state ? (
            <pre className="json-preview">{JSON.stringify(logisticsStation.state, null, 2)}</pre>
          ) : null}
        </section>
      </div>
    );
  }

  if (selected.kind === 'unit' && entity) {
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
              <dd>{unit.type}</dd>
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
              <dd>{unit.hp} / {unit.max_hp}</dd>
            </div>
            <div>
              <dt>攻击 / 防御</dt>
              <dd>{unit.attack} / {unit.defense}</dd>
            </div>
            <div>
              <dt>移动状态</dt>
              <dd>{unit.is_moving ? '移动中' : '待命'}</dd>
            </div>
            <div>
              <dt>目标</dt>
              <dd>{unit.attack_target || formatPosition(unit.target_pos) || '-'}</dd>
            </div>
          </dl>
        </section>
      </div>
    );
  }

  if (selected.kind === 'resource' && entity) {
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
              <dd>{resource.remaining ?? '-'}</dd>
            </div>
            <div>
              <dt>当前产率</dt>
              <dd>{resource.current_yield ?? '-'}</dd>
            </div>
            <div>
              <dt>稀有资源</dt>
              <dd>{resource.is_rare ? '是' : '否'}</dd>
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
  planet: PlanetView;
}

export function PlanetActivityPanel({ alerts, events, planet }: PlanetActivityPanelProps) {
  const [eventFilter, setEventFilter] = useState('all');
  const { requestFocus, setSelected } = usePlanetViewStore(useShallow((state) => ({
    requestFocus: state.requestFocus,
    setSelected: state.setSelected,
  })));

  const eventTypes = useMemo(
    () => ['all', ...new Set(events.map((event) => event.event_type))],
    [events],
  );
  const filteredEvents = useMemo(
    () => (eventFilter === 'all' ? events : events.filter((event) => event.event_type === eventFilter)),
    [eventFilter, events],
  );

  function focusSelection(selection: ReturnType<typeof resolveSelectionFromEvent>) {
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
            <span>过滤</span>
            <select onChange={(event) => setEventFilter(event.target.value)} value={eventFilter}>
              {eventTypes.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>
        </div>
        <ul className="timeline-list timeline-list--dense">
          {filteredEvents.length === 0 ? <li>暂无事件</li> : null}
          {filteredEvents.map((event) => (
            <li key={event.event_id}>
              <div className="timeline-list__row">
                <strong>[t{event.tick}] {event.event_type}</strong>
                <button
                  className="secondary-button timeline-action"
                  onClick={() => focusSelection(resolveSelectionFromEvent(planet, event))}
                  type="button"
                >
                  定位
                </button>
              </div>
              <span>{summarizeEvent(event)}</span>
              <details>
                <summary>payload</summary>
                <pre className="json-preview">{JSON.stringify(event.payload, null, 2)}</pre>
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
                <strong>[t{alert.tick}] {alert.alert_type}</strong>
                <button
                  className="secondary-button timeline-action"
                  onClick={() => focusSelection(resolveSelectionFromAlert(planet, alert))}
                  type="button"
                >
                  定位
                </button>
              </div>
              <span>{summarizeAlert(alert)}</span>
              <span className="subtle-text">
                吞吐 {alert.metrics.throughput} · 堆积 {alert.metrics.backlog} · 效率 {formatRatio(alert.metrics.efficiency)}
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
  planet: PlanetView;
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
  } = usePlanetViewStore(useShallow((state) => ({
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
  })));
  const [shareMessage, setShareMessage] = useState('');

  function exportScreenshot() {
    if (!canvas?.toDataURL) {
      return;
    }
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${planet.planet_id}-tick-${currentTick}.png`;
    link.click();
  }

  function exportSelectionJson() {
    const payload = buildSelectionExport(planet, selected);
    downloadData(
      `${planet.planet_id}-selection.json`,
      JSON.stringify(payload, null, 2),
      'application/json',
    );
  }

  function buildShareUrl() {
    if (typeof window === 'undefined') {
      return '';
    }
    const tileSize = PLANET_ZOOM_LEVELS[camera.zoomIndex];
    const viewportWidth = canvas?.clientWidth || (planet.map_width * tileSize);
    const viewportHeight = canvas?.clientHeight || (planet.map_height * tileSize);
    const bounds = getViewportTileBounds(planet, camera, tileSize, viewportWidth, viewportHeight);
    const params = buildViewLinkSearchParams(selected, layers, bounds, tileSize);
    const url = new URL(window.location.href);
    url.search = params.toString();
    return url.toString();
  }

  async function copyShareLink() {
    const url = buildShareUrl();
    if (!url || typeof navigator === 'undefined' || !navigator.clipboard) {
      setShareMessage('当前环境不支持剪贴板');
      return;
    }
    await navigator.clipboard.writeText(url);
    setShareMessage('视角链接已复制');
  }

  function exportViewportJson() {
    const tileSize = PLANET_ZOOM_LEVELS[camera.zoomIndex];
    const viewportWidth = canvas?.clientWidth || (planet.map_width * tileSize);
    const viewportHeight = canvas?.clientHeight || (planet.map_height * tileSize);
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
      'application/json',
    );
  }

  return (
    <div className={debugOpen ? 'debug-panel debug-panel--open' : 'debug-panel'}>
      <button
        className="secondary-button debug-panel__toggle"
        onClick={toggleDebugOpen}
        type="button"
      >
        {debugOpen ? '收起调试' : '展开调试'}
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
              <dd>{lastEventId || '-'}</dd>
            </div>
            <div>
              <dt>最近全量同步</dt>
              <dd>{formatTimestamp(lastFullSyncAt)}</dd>
            </div>
            <div>
              <dt>相机</dt>
              <dd>{Math.round(camera.offsetX)}, {Math.round(camera.offsetY)}</dd>
            </div>
            <div>
              <dt>缩放</dt>
              <dd>{PLANET_ZOOM_LEVELS[camera.zoomIndex]} px</dd>
            </div>
            <div>
              <dt>Hover</dt>
              <dd>{hoveredTile ? `${hoveredTile.x}, ${hoveredTile.y}` : '-'}</dd>
            </div>
            <div>
              <dt>选中 ID</dt>
              <dd>{selectionEntityId(selected) || '-'}</dd>
            </div>
          </dl>

          <div className="debug-panel__actions">
            <button className="secondary-button" onClick={() => { void onRefreshPlanet(); }} type="button">
              重拉行星
            </button>
            <button className="secondary-button" onClick={() => { void onRefreshFog(); }} type="button">
              重拉迷雾
            </button>
            <button className="secondary-button" onClick={() => { void onPullEvents(); }} type="button">
              补拉事件
            </button>
            <button className="secondary-button" onClick={exportScreenshot} type="button">
              导出 PNG
            </button>
            <button className="secondary-button" onClick={exportSelectionJson} type="button">
              导出 JSON
            </button>
            <button className="secondary-button" onClick={() => { void copyShareLink(); }} type="button">
              复制视角链接
            </button>
            <button className="secondary-button" onClick={exportViewportJson} type="button">
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
