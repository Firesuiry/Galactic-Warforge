import { useEffect, useRef, useState } from 'react';

import type { WarTaskForceStance } from '@shared/types';
import { useQuery } from '@tanstack/react-query';

import { MapDrawer } from '@/common/MapDrawer';
import { BlueprintVariantForm } from '@/features/war/components/forms/BlueprintVariantForm';
import { FleetActionForm } from '@/features/war/components/forms/FleetActionForm';
import { ProductionQueueForm } from '@/features/war/components/forms/ProductionQueueForm';
import { RefitForm } from '@/features/war/components/forms/RefitForm';
import { TaskForceForm } from '@/features/war/components/forms/TaskForceForm';
import { TheaterForm } from '@/features/war/components/forms/TheaterForm';
import { BattlefieldMap } from '@/features/war/battlefield/BattlefieldMap';
import { useWarRealtime } from '@/features/war/hooks/use-war-realtime';
import type { WarCommandHint } from '@/features/war/error-hints';
import {
  formatBlockadeStatus,
  formatBlueprintBaseLabel,
  formatBlueprintState,
  formatLandingStage,
  formatMetric,
  formatOrderStatus,
  formatPercent,
  formatProductionStage,
  formatSupplyCondition,
  formatTaskForceStance,
  formatValidationIssue,
  getBlueprintSlotComponents,
  inferBlueprintRole,
} from '@/features/war/format';
import { useWarCommand } from '@/features/war/use-war-command';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';

type FeedbackSection = 'blueprint' | 'industry' | 'theater' | 'reports';

const TASK_FORCE_STANCES: WarTaskForceStance[] = [
  'hold',
  'patrol',
  'escort',
  'intercept',
  'harass',
  'siege',
  'bombard',
  'retreat_on_losses',
];

const WAR_FALLBACK_SUMMARY_MS = 15_000;
const WAR_FALLBACK_RUNTIME_MS = 10_000;

/**
 * 抽屉分组 Tab：蓝图/军工/战区/战报。
 * id 与命令反馈 section 一一对应，新回执到达时抽屉自动滑出并落到对应分组。
 */
const WAR_DRAWER_TABS: Array<{ id: FeedbackSection; glyph: string; label: string }> = [
  { id: 'blueprint', glyph: '🧬', label: '蓝图' },
  { id: 'industry', glyph: '🏭', label: '军工' },
  { id: 'theater', glyph: '🎯', label: '战区' },
  { id: 'reports', glyph: '📜', label: '战报' },
];

function firstQueryError(errors: unknown[]) {
  return errors.find(Boolean);
}

const WAR_DOMAINS = ['ground', 'air', 'orbital', 'space'] as const;
type WarDomain = (typeof WAR_DOMAINS)[number];

function isSpaceDomain(domain: string) {
  return domain === 'space' || domain === 'orbital';
}

function defaultBaseId(input: {
  domain: string;
  catalog?: {
    base_frames?: Array<{ id: string; supported_domains?: string[] }>;
    base_hulls?: Array<{ id: string; supported_domains?: string[] }>;
  };
}) {
  const bases = isSpaceDomain(input.domain)
    ? input.catalog?.base_hulls
    : input.catalog?.base_frames;
  return bases?.find((entry) => (
    !entry.supported_domains
    || entry.supported_domains.length === 0
    || entry.supported_domains.includes(input.domain)
  ))?.id ?? '';
}

function resolveSystemId(input: {
  planetSystemId?: string;
  taskForceSystemId?: string;
  theaterSystemId?: string;
}) {
  return input.planetSystemId
    || input.taskForceSystemId
    || input.theaterSystemId
    || '';
}

export function WarPage() {
  const client = useApiClient();
  const session = useSessionSnapshot();

  const [selectedBlueprintId, setSelectedBlueprintId] = useState('');
  const [selectedDeployBlueprintId, setSelectedDeployBlueprintId] = useState('');
  const [selectedDeploymentHubId, setSelectedDeploymentHubId] = useState('');
  const [selectedTaskForceId, setSelectedTaskForceId] = useState('');
  const [selectedPlanetId, setSelectedPlanetId] = useState('');
  const [selectedStance, setSelectedStance] = useState<WarTaskForceStance>('hold');
  const [slotSelections, setSlotSelections] = useState<Record<string, string>>({});
  const [createBlueprintId, setCreateBlueprintId] = useState('');
  const [createBlueprintName, setCreateBlueprintName] = useState('');
  const [createDomain, setCreateDomain] = useState<WarDomain>('space');
  const [createBaseId, setCreateBaseId] = useState('');
  // 右侧工作台抽屉：默认收起为边缘把手；选中战场标记/新命令回执时自动滑出
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FeedbackSection>('blueprint');

  const summaryQuery = useQuery({
    queryKey: ['summary', session.serverUrl, session.playerId],
    queryFn: () => client.fetchSummary(),
    refetchInterval: WAR_FALLBACK_SUMMARY_MS,
    refetchIntervalInBackground: true,
  });

  const catalogQuery = useQuery({
    queryKey: ['catalog', session.serverUrl, session.playerId],
    queryFn: () => client.fetchCatalog(),
  });

  const blueprintsQuery = useQuery({
    queryKey: ['war-blueprints', session.serverUrl, session.playerId],
    queryFn: () => client.fetchWarfareBlueprints(),
  });

  const industryQuery = useQuery({
    queryKey: ['war-industry', session.serverUrl, session.playerId],
    queryFn: () => client.fetchWarIndustry(),
  });

  const taskForcesQuery = useQuery({
    queryKey: ['war-task-forces', session.serverUrl, session.playerId],
    queryFn: () => client.fetchWarTaskForces(),
  });

  const theatersQuery = useQuery({
    queryKey: ['war-theaters', session.serverUrl, session.playerId],
    queryFn: () => client.fetchWarTheaters(),
  });

  const activePlanetId = summaryQuery.data?.active_planet_id ?? '';

  const planetQuery = useQuery({
    queryKey: ['planet', session.serverUrl, session.playerId, activePlanetId],
    queryFn: () => client.fetchPlanet(activePlanetId),
    enabled: Boolean(activePlanetId),
  });

  const focusSystemId = resolveSystemId({
    planetSystemId: planetQuery.data?.system_id,
    taskForceSystemId: taskForcesQuery.data?.task_forces?.[0]?.deployment?.system_id,
    theaterSystemId: theatersQuery.data?.theaters?.[0]?.zones?.[0]?.system_id,
  });

  const systemQuery = useQuery({
    queryKey: ['system', session.serverUrl, session.playerId, focusSystemId],
    queryFn: () => client.fetchSystem(focusSystemId),
    enabled: Boolean(focusSystemId),
  });

  const runtimeQuery = useQuery({
    queryKey: ['system-runtime', session.serverUrl, session.playerId, focusSystemId],
    queryFn: () => client.fetchSystemRuntime(focusSystemId),
    enabled: Boolean(focusSystemId),
    refetchInterval: WAR_FALLBACK_RUNTIME_MS,
    refetchIntervalInBackground: true,
  });

  const fleetsQuery = useQuery({
    queryKey: ['war-fleets', session.serverUrl, session.playerId],
    queryFn: () => client.fetchFleets(),
  });

  const planetSceneQuery = useQuery({
    queryKey: ['war-planet-scene', session.serverUrl, session.playerId, activePlanetId],
    queryFn: () => client.fetchPlanetScene(activePlanetId, {
      x: 0,
      y: 0,
      width: 48,
      height: 48,
    }),
    enabled: Boolean(activePlanetId),
  });

  const { runCommand, notify, feedbacks, isPending } = useWarCommand();

  useWarRealtime({
    client,
    serverUrl: session.serverUrl,
    playerId: session.playerId,
    playerKey: session.playerKey,
    focusSystemId,
  });

  const catalog = catalogQuery.data?.warfare;
  const blueprints = blueprintsQuery.data?.blueprints ?? [];
  const industry = industryQuery.data;
  const taskForces = taskForcesQuery.data?.task_forces ?? [];
  const theaters = theatersQuery.data?.theaters ?? [];
  const system = systemQuery.data;
  const runtime = runtimeQuery.data;
  const fleets = fleetsQuery.data ?? [];
  const deploymentHubs = industry?.deployment_hubs ?? [];
  const supplyNodes = industry?.supply_nodes ?? [];
  const currentPlanets = system?.planets ?? [];
  const contacts = runtime?.contacts ?? [];
  const battleReports = runtime?.battle_reports ?? [];
  const blockades = runtime?.planet_blockades ?? [];
  const landingOperations = runtime?.landing_operations ?? [];
  const factoryBuildings = (Object.values(planetSceneQuery.data?.buildings ?? {})
    .filter((building) => building.owner_id === session.playerId
      && building.runtime?.functions?.production));
  const scope = { serverUrl: session.serverUrl, playerId: session.playerId };
  const selectedBlueprint = blueprints.find((item) => item.id === selectedBlueprintId) ?? blueprints[0];
  const selectedDeployBlueprint = blueprints.find((item) => item.id === selectedDeployBlueprintId);
  const selectedTaskForce = taskForces.find((item) => item.id === selectedTaskForceId) ?? taskForces[0];
  const selectedDeploymentHub = deploymentHubs.find((item) => item.building_id === selectedDeploymentHubId) ?? deploymentHubs[0];
  const blueprintSlots = getBlueprintSlotComponents(catalog, selectedBlueprint);
  const isLoading = summaryQuery.isLoading
    || catalogQuery.isLoading
    || blueprintsQuery.isLoading
    || industryQuery.isLoading
    || taskForcesQuery.isLoading
    || theatersQuery.isLoading
    || (Boolean(activePlanetId) && planetQuery.isLoading)
    || (Boolean(focusSystemId) && systemQuery.isLoading)
    || (Boolean(focusSystemId) && runtimeQuery.isLoading);

  const error = firstQueryError([
    summaryQuery.error,
    catalogQuery.error,
    blueprintsQuery.error,
    industryQuery.error,
    taskForcesQuery.error,
    theatersQuery.error,
    planetQuery.error,
    systemQuery.error,
    runtimeQuery.error,
  ]);

  useEffect(() => {
    if (!selectedBlueprintId && blueprints[0]) {
      setSelectedBlueprintId(blueprints[0].id);
    }
  }, [blueprints, selectedBlueprintId]);

  useEffect(() => {
    const next = blueprints.find((item) => item.id === selectedDeployBlueprintId)
      ?? blueprints.find((item) => item.state === 'adopted')
      ?? blueprints.find((item) => item.state === 'prototype')
      ?? blueprints[0];
    if (next && next.id !== selectedDeployBlueprintId) {
      setSelectedDeployBlueprintId(next.id);
    }
  }, [blueprints, selectedDeployBlueprintId]);

  useEffect(() => {
    if (!selectedDeploymentHubId && deploymentHubs[0]) {
      setSelectedDeploymentHubId(deploymentHubs[0].building_id);
    }
  }, [deploymentHubs, selectedDeploymentHubId]);

  useEffect(() => {
    if (!selectedTaskForceId && taskForces[0]) {
      setSelectedTaskForceId(taskForces[0].id);
    }
  }, [taskForces, selectedTaskForceId]);

  useEffect(() => {
    if (selectedTaskForce?.stance) {
      setSelectedStance(selectedTaskForce.stance);
    }
  }, [selectedTaskForce?.id, selectedTaskForce?.stance]);

  useEffect(() => {
    if (!selectedPlanetId) {
      setSelectedPlanetId(activePlanetId || currentPlanets[0]?.planet_id || '');
      return;
    }
    const exists = currentPlanets.some((planet) => planet.planet_id === selectedPlanetId);
    if (!exists) {
      setSelectedPlanetId(activePlanetId || currentPlanets[0]?.planet_id || '');
    }
  }, [activePlanetId, currentPlanets, selectedPlanetId]);

  useEffect(() => {
    if (!catalog) {
      return;
    }
    const nextBaseId = defaultBaseId({ domain: createDomain, catalog });
    if (!createBaseId) {
      setCreateBaseId(nextBaseId);
      return;
    }
    const baseExists = isSpaceDomain(createDomain)
      ? Boolean(catalog.base_hulls?.some((item) => item.id === createBaseId))
      : Boolean(catalog.base_frames?.some((item) => item.id === createBaseId));
    if (!baseExists) {
      setCreateBaseId(nextBaseId);
    }
  }, [catalog, createBaseId, createDomain]);

  useEffect(() => {
    if (!selectedBlueprint) {
      return;
    }
    // 仅在切换蓝图时用 authoritative 组件状态初始化槽位选择；
    // 同一蓝图被 SSE 失效重取时不重置，避免清掉玩家正在进行的槽位选择。
    const nextSelections: Record<string, string> = {};
    blueprintSlots.forEach(({ slot, current }) => {
      nextSelections[slot.id] = current;
    });
    setSlotSelections(nextSelections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBlueprint?.id]);

  // 新命令回执：抽屉自动滑出并落到对应分组（对齐行星页「新回执自动滑出」范式）。
  // pushFeedback 每次只换对应 section 的数组引用，据此定位变化分组。
  const prevFeedbacksRef = useRef(feedbacks);
  useEffect(() => {
    const prev = prevFeedbacksRef.current;
    prevFeedbacksRef.current = feedbacks;
    const changed = WAR_DRAWER_TABS.find(
      (tab) => feedbacks[tab.id] !== prev[tab.id] && (feedbacks[tab.id]?.length ?? 0) > 0,
    );
    if (changed) {
      setActiveTab(changed.id);
      setDrawerOpen(true);
    }
  }, [feedbacks]);

  if (isLoading) {
    return <div className="panel">正在加载战争工作台...</div>;
  }

  if (
    error
    || !summaryQuery.data
    || !catalog
    || !industry
    || !taskForcesQuery.data
    || !theatersQuery.data
    || !planetQuery.data
  ) {
    return (
      <div className="panel error-banner" role="alert">
        {error instanceof Error ? error.message : '战争工作台数据加载失败'}
      </div>
    );
  }

  function setFeedback(section: FeedbackSection, hint: WarCommandHint) {
    notify(section, hint);
  }

  function handleCreateBlueprint() {
    if (!createBlueprintId.trim()) {
      setFeedback('blueprint', { tone: 'error', title: '蓝图 ID 不能为空' });
      return;
    }
    if (!createBaseId) {
      setFeedback('blueprint', { tone: 'error', title: '必须选择一个底盘' });
      return;
    }
    runCommand({
      section: 'blueprint',
      invalidateKeys: [['war-blueprints', session.serverUrl, session.playerId]],
      execute: () => client.cmdBlueprintCreate(createBlueprintId.trim(), createDomain, {
        name: createBlueprintName.trim() || undefined,
        ...(isSpaceDomain(createDomain) ? { baseHullId: createBaseId } : { baseFrameId: createBaseId }),
      }),
    });
  }

  function handleSetBlueprintSlot(slotId: string) {
    const componentId = slotSelections[slotId];
    if (!selectedBlueprint?.id || !componentId) {
      setFeedback('blueprint', { tone: 'error', title: '当前槽位还没有选择组件' });
      return;
    }
    runCommand({
      section: 'blueprint',
      invalidateKeys: [['war-blueprints', session.serverUrl, session.playerId]],
      execute: () => client.cmdBlueprintSetComponent(selectedBlueprint.id, slotId, componentId),
    });
  }

  function handleValidateBlueprint() {
    if (!selectedBlueprint?.id) {
      setFeedback('blueprint', { tone: 'error', title: '当前没有可校验的蓝图' });
      return;
    }
    runCommand({
      section: 'blueprint',
      invalidateKeys: [['war-blueprints', session.serverUrl, session.playerId]],
      execute: () => client.cmdBlueprintValidate(selectedBlueprint.id),
    });
  }

  function handleFinalizeBlueprint() {
    if (!selectedBlueprint?.id) {
      setFeedback('blueprint', { tone: 'error', title: '当前没有可定型的蓝图' });
      return;
    }
    // 状态机：validated→prototype→field_tested→adopted。定型默认推进到 prototype；
    // 即使页面状态因 SSE 刷新滞后仍显示 draft，服务端已是 validated 时 prototype 也可达成。
    const targetState = selectedBlueprint.state === 'field_tested' ? 'adopted' : 'prototype';
    runCommand({
      section: 'blueprint',
      invalidateKeys: [['war-blueprints', session.serverUrl, session.playerId]],
      execute: () => client.cmdBlueprintFinalize(selectedBlueprint.id, { targetState }),
    });
  }

  function handleDeploy() {
    if (!selectedDeployBlueprint?.id || !selectedDeploymentHub?.building_id) {
      setFeedback('industry', { tone: 'error', title: '部署需要先选择蓝图和部署枢纽' });
      return;
    }
    if (isSpaceDomain(selectedDeployBlueprint.domain)) {
      if (!focusSystemId) {
        setFeedback('industry', { tone: 'error', title: '当前缺少星系上下文，无法下达舰队部署' });
        return;
      }
      runCommand({
        section: 'industry',
        invalidateKeys: [
          ['war-industry', session.serverUrl, session.playerId],
          ['system-runtime', session.serverUrl, session.playerId, focusSystemId],
        ],
        execute: () => client.cmdCommissionFleet(
          selectedDeploymentHub.building_id,
          selectedDeployBlueprint.id,
          focusSystemId,
          { count: 1 },
        ),
      });
      return;
    }
    if (!selectedPlanetId) {
      setFeedback('industry', { tone: 'error', title: '当前缺少目标行星，无法部署地面单位' });
      return;
    }
    runCommand({
      section: 'industry',
      invalidateKeys: [
        ['war-industry', session.serverUrl, session.playerId],
      ],
      execute: () => client.cmdDeploySquad(
        selectedDeploymentHub.building_id,
        selectedDeployBlueprint.id,
        { count: 1, planetId: selectedPlanetId },
      ),
    });
  }

  function handleTaskForceStanceUpdate() {
    if (!selectedTaskForce?.id) {
      setFeedback('theater', { tone: 'error', title: '当前没有可调整的任务群' });
      return;
    }
    runCommand({
      section: 'theater',
      invalidateKeys: [['war-task-forces', session.serverUrl, session.playerId]],
      execute: () => client.cmdTaskForceSetStance(selectedTaskForce.id, selectedStance),
    });
  }

  function handleBlockade() {
    if (!selectedTaskForce?.id || !selectedPlanetId) {
      setFeedback('theater', { tone: 'error', title: '封锁需要选择任务群和目标行星' });
      return;
    }
    runCommand({
      section: 'theater',
      invalidateKeys: [
        ['system-runtime', session.serverUrl, session.playerId, focusSystemId],
      ],
      execute: () => client.cmdBlockadePlanet(selectedTaskForce.id, { planetId: selectedPlanetId }),
    });
  }

  function handleLanding() {
    if (!selectedTaskForce?.id || !selectedPlanetId) {
      setFeedback('theater', { tone: 'error', title: '登陆需要选择任务群和目标行星' });
      return;
    }
    runCommand({
      section: 'theater',
      invalidateKeys: [
        ['system-runtime', session.serverUrl, session.playerId, focusSystemId],
      ],
      execute: () => client.cmdLandingStart(selectedTaskForce.id, { planetId: selectedPlanetId }),
    });
  }

  return (
    <div className="page-grid page-grid--map">
      <section className="panel planet-map-shell">
        <BattlefieldMap
          systemName={system?.name || focusSystemId || '未知星系'}
          planets={currentPlanets}
          runtime={runtime}
          fleets={fleets}
          playerId={session.playerId}
          onSelect={(next) => {
            // 选中战场标记自动滑出抽屉（对齐行星页「选中实体自动滑出」）
            if (next) {
              setDrawerOpen(true);
            }
          }}
        />

        {/* 悬浮标题片：页面标题/焦点星系/战况计数 HUD 化（原 page-hero 内容） */}
        <div className="planet-title-chip war-title-chip">
          <div className="planet-title-chip__head">
            <p className="eyebrow">Grand Strategy Warfare</p>
            <h1>战争工作台</h1>
            {/* 战场主视区的节标题；图上 HUD 另带「战场态势 · 星系名」 */}
            <h2 className="war-title-chip__scene">战场态势</h2>
            <p className="subtle-text">
              当前焦点：{system?.name || focusSystemId || '未知星系'} / {currentPlanets.find((planet) => planet.planet_id === selectedPlanetId)?.name || selectedPlanetId || '未知行星'}
            </p>
          </div>
          <div className="planet-title-chip__chips">
            <span className="badge badge--ok">tick {summaryQuery.data.tick}</span>
            <span className="badge">{system?.name || focusSystemId || '未知星系'}</span>
            <span className="badge">{currentPlanets.find((planet) => planet.planet_id === selectedPlanetId)?.name || selectedPlanetId || '未知行星'}</span>
            <span className="badge">{contacts.length} 条接触</span>
            <span className="badge">{battleReports.length} 份战报</span>
            <span className="badge">{blockades.length} 条封锁</span>
          </div>
        </div>

        {/* 右侧工作台抽屉：蓝图/军工/战区/战报四组 Tab，功能与原多面板布局一致 */}
        <MapDrawer
          bodyClassName="war-drawer__body"
          label="工作台"
          onToggle={() => setDrawerOpen((open) => !open)}
          open={drawerOpen}
        >
          <div aria-label="战争工作台面板" className="planet-detail-tabs war-drawer-tabs" role="tablist">
            {WAR_DRAWER_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  aria-controls={`war-drawer-panel-${tab.id}`}
                  aria-selected={isActive}
                  className={isActive
                    ? 'secondary-button planet-detail-tabs__tab planet-detail-tabs__tab--active'
                    : 'secondary-button planet-detail-tabs__tab'}
                  id={`war-drawer-tab-${tab.id}`}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  <span aria-hidden="true" className="planet-detail-tabs__glyph">{tab.glyph}</span>
                  <span className="planet-detail-tabs__text">{tab.label}</span>
                </button>
              );
            })}
          </div>
          <div className="planet-detail-shell__content war-drawer__content">
            {activeTab === 'blueprint' ? (
              <div id="war-drawer-panel-blueprint" role="tabpanel">
                <section className="war-panel">
          <div className="war-panel__header">
            <div>
              <h2>蓝图工作台</h2>
              <p className="subtle-text">底盘、组件、预算与角色预估集中在这里处理。</p>
            </div>
            <div className="war-panel__controls">
              <label className="war-field">
                <span>蓝图选择</span>
                <select
                  value={selectedBlueprint?.id ?? ''}
                  onChange={(event) => setSelectedBlueprintId(event.target.value)}
                >
                  {blueprints.map((blueprint) => (
                    <option key={blueprint.id} value={blueprint.id}>
                      {blueprint.name} ({blueprint.id})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {feedbacks.blueprint?.map((feedback, index) => (
            <div className={`status-banner status-banner--${feedback.tone}`} key={`${feedback.title}-${index}`}>
              <strong>{feedback.title}</strong>
              {feedback.detail ? <span>{feedback.detail}</span> : null}
            </div>
          ))}

          <div className="war-section-grid">
            <article className="war-card">
              <h3>创建蓝图</h3>
              <label className="war-field">
                <span>蓝图 ID</span>
                <input value={createBlueprintId} onChange={(event) => setCreateBlueprintId(event.target.value)} />
              </label>
              <label className="war-field">
                <span>蓝图名称</span>
                <input value={createBlueprintName} onChange={(event) => setCreateBlueprintName(event.target.value)} />
              </label>
              <label className="war-field">
                <span>作战域</span>
                <select value={createDomain} onChange={(event) => setCreateDomain(event.target.value as WarDomain)}>
                  {WAR_DOMAINS.map((domain) => (
                    <option key={domain} value={domain}>{domain}</option>
                  ))}
                </select>
              </label>
              <label className="war-field">
                <span>底盘</span>
                <select value={createBaseId} onChange={(event) => setCreateBaseId(event.target.value)}>
                  {(isSpaceDomain(createDomain) ? catalog.base_hulls : catalog.base_frames)?.map((base) => (
                    <option key={base.id} value={base.id}>
                      {base.name} ({base.id})
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-link war-button" type="button" onClick={handleCreateBlueprint}>
                创建蓝图
              </button>
            </article>

            <article className="war-card">
              <h3>当前蓝图</h3>
              {selectedBlueprint ? (
                <>
                  <dl className="war-kv-list">
                    <div>
                      <dt>名称</dt>
                      <dd>{selectedBlueprint.name}</dd>
                    </div>
                    <div>
                      <dt>状态</dt>
                      <dd>{formatBlueprintState(selectedBlueprint.state)}</dd>
                    </div>
                    <div>
                      <dt>底盘</dt>
                      <dd>{formatBlueprintBaseLabel(catalog, selectedBlueprint)}</dd>
                    </div>
                    <div>
                      <dt>角色预估</dt>
                      <dd>{inferBlueprintRole(catalog, selectedBlueprint)}</dd>
                    </div>
                  </dl>
                  <div className="war-chip-row">
                    <span className="war-chip">输出 {formatMetric(selectedBlueprint.validation.usage?.power_output)}</span>
                    <span className="war-chip">功耗 {formatMetric(selectedBlueprint.validation.usage?.power_draw)}</span>
                    <span className="war-chip">热载 {formatMetric(selectedBlueprint.validation.usage?.heat_load)}</span>
                    <span className="war-chip">体积 {formatMetric(selectedBlueprint.validation.usage?.volume)}</span>
                  </div>
                  <div className="war-action-row">
                    <button className="secondary-button war-button" type="button" onClick={handleValidateBlueprint}>
                      校验蓝图
                    </button>
                    <button className="secondary-button war-button" type="button" onClick={handleFinalizeBlueprint}>
                      定型蓝图
                    </button>
                  </div>
                </>
              ) : (
                <p className="subtle-text">暂无蓝图。</p>
              )}
            </article>
          </div>

          {selectedBlueprint ? (
            <div className="war-section-grid">
              <article className="war-card">
                <h3>组件槽位</h3>
                {blueprintSlots.map(({ slot, candidates }) => (
                  <div className="war-slot-row" key={slot.id}>
                    <label className="war-field war-field--compact">
                      <span>{slot.id}</span>
                      <select
                        aria-label={`槽位 ${slot.id}`}
                        value={slotSelections[slot.id] ?? ''}
                        onChange={(event) => {
                          const value = event.target.value;
                          setSlotSelections((current) => ({
                            ...current,
                            [slot.id]: value,
                          }));
                        }}
                      >
                        <option value="">未配置</option>
                        {candidates.map((component) => (
                          <option key={component.id} value={component.id}>
                            {component.name} ({component.id})
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="secondary-button war-button" type="button" onClick={() => handleSetBlueprintSlot(slot.id)}>
                      保存槽位
                    </button>
                  </div>
                ))}
              </article>

              <article className="war-card">
                <h3>非法原因</h3>
                <ul className="war-list">
                  {selectedBlueprint.validation.issues?.length ? selectedBlueprint.validation.issues.map((issue) => (
                    <li key={`${issue.code}-${issue.slot_id ?? issue.message}`}>
                      <strong>{issue.message}</strong>
                      <span>{formatValidationIssue(issue)}</span>
                    </li>
                  )) : <li>当前蓝图已通过预算校验。</li>}
                </ul>
              </article>
            </div>
          ) : null}

          <BlueprintVariantForm
            scope={scope}
            runCommand={runCommand}
            isPending={isPending}
            catalog={catalog}
            blueprints={blueprints}
          />
                </section>
              </div>
            ) : null}
            {activeTab === 'industry' ? (
              <div id="war-drawer-panel-industry" role="tabpanel">
                <section className="war-panel">
          <div className="war-panel__header">
            <div>
              <h2>军工总览</h2>
              <p className="subtle-text">量产、翻修、部署枢纽和补给节点在一页内对齐。</p>
            </div>
          </div>

          {feedbacks.industry?.map((feedback, index) => (
            <div className={`status-banner status-banner--${feedback.tone}`} key={`${feedback.title}-${index}`}>
              <strong>{feedback.title}</strong>
              {feedback.detail ? <span>{feedback.detail}</span> : null}
            </div>
          ))}

          <div className="war-section-grid">
            <article className="war-card">
              <h3>量产与翻修</h3>
              <ul className="war-list">
                {industry.production_orders.length === 0 ? <li>暂无量产单。</li> : industry.production_orders.map((order) => (
                  <li key={order.id}>
                    <strong>{order.id}</strong> · {order.blueprint_id} · {formatOrderStatus(order.status)} · {formatProductionStage(order.stage)} · {order.completed_count}/{order.count}
                  </li>
                ))}
              </ul>
              <ul className="war-list">
                {industry.refit_orders.length === 0 ? <li>暂无翻修单。</li> : industry.refit_orders.map((order) => (
                  <li key={order.id}>
                    <strong>{order.id}</strong> · {order.source_blueprint_id} → {order.target_blueprint_id} · {formatOrderStatus(order.status)}
                  </li>
                ))}
              </ul>
            </article>

            <article className="war-card">
              <h3>部署尝试</h3>
              <label className="war-field">
                <span>部署蓝图</span>
                <select
                  value={selectedDeployBlueprint?.id ?? ''}
                  onChange={(event) => setSelectedDeployBlueprintId(event.target.value)}
                >
                  {blueprints.map((blueprint) => (
                    <option key={blueprint.id} value={blueprint.id}>
                      {blueprint.name} ({blueprint.id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="war-field">
                <span>部署枢纽</span>
                <select
                  value={selectedDeploymentHub?.building_id ?? ''}
                  onChange={(event) => setSelectedDeploymentHubId(event.target.value)}
                >
                  {deploymentHubs.map((hub) => (
                    <option key={hub.building_id} value={hub.building_id}>
                      {hub.building_type} ({hub.building_id})
                    </option>
                  ))}
                </select>
              </label>
              {selectedDeployBlueprint ? (
                <dl className="war-kv-list">
                  <div>
                    <dt>当前蓝图</dt>
                    <dd>{selectedDeployBlueprint.name}</dd>
                  </div>
                  <div>
                    <dt>部署域</dt>
                    <dd>{selectedDeployBlueprint.domain}</dd>
                  </div>
                </dl>
              ) : null}
              <button className="secondary-button war-button" type="button" onClick={handleDeploy}>
                尝试部署
              </button>
              <ul className="war-list">
                {deploymentHubs.length === 0 ? <li>暂无部署枢纽。</li> : deploymentHubs.map((hub) => (
                  <li key={hub.building_id}>
                    <strong>{hub.building_id}</strong> · 容量 {hub.capacity ?? 0} · 行星 {hub.planet_id ?? '-'}
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <article className="war-card">
            <h3>补给节点</h3>
            <ul className="war-list">
              {supplyNodes.length === 0 ? <li>暂无补给节点。</li> : supplyNodes.map((node) => (
                <li key={node.node_id}>
                  <strong>{node.label || node.node_id}</strong> · fuel {formatMetric(node.inventory.fuel)} · ammo {formatMetric(node.inventory.ammo)} · spare_parts {formatMetric(node.inventory.spare_parts)}
                </li>
              ))}
            </ul>
          </article>

          <div className="war-section-grid">
            <ProductionQueueForm
              scope={scope}
              runCommand={runCommand}
              isPending={isPending}
              buildings={factoryBuildings}
              deploymentHubs={deploymentHubs}
              blueprints={blueprints}
            />
            <RefitForm
              scope={scope}
              runCommand={runCommand}
              isPending={isPending}
              buildings={factoryBuildings}
              fleets={fleets}
              blueprints={blueprints}
            />
          </div>
                </section>
              </div>
            ) : null}
            {activeTab === 'theater' ? (
              <div id="war-drawer-panel-theater" role="tabpanel">
                <section className="war-panel">
          <div className="war-panel__header">
            <div>
              <h2>战区面板</h2>
              <p className="subtle-text">姿态、战区目标、封锁与登陆由同一面板驱动。</p>
            </div>
          </div>

          {feedbacks.theater?.map((feedback, index) => (
            <div className={`status-banner status-banner--${feedback.tone}`} key={`${feedback.title}-${index}`}>
              <strong>{feedback.title}</strong>
              {feedback.detail ? <span>{feedback.detail}</span> : null}
            </div>
          ))}

          <div className="war-section-grid">
            <article className="war-card">
              <h3>任务群控制</h3>
              <label className="war-field">
                <span>任务群</span>
                <select value={selectedTaskForce?.id ?? ''} onChange={(event) => setSelectedTaskForceId(event.target.value)}>
                  {taskForces.map((taskForce) => (
                    <option key={taskForce.id} value={taskForce.id}>
                      {taskForce.name || taskForce.id} ({taskForce.id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="war-field">
                <span>任务群姿态</span>
                <select value={selectedStance} onChange={(event) => setSelectedStance(event.target.value as WarTaskForceStance)}>
                  {TASK_FORCE_STANCES.map((stance) => (
                    <option key={stance} value={stance}>
                      {stance}
                    </option>
                  ))}
                </select>
              </label>
              <label className="war-field">
                <span>目标行星</span>
                <select value={selectedPlanetId} onChange={(event) => setSelectedPlanetId(event.target.value)}>
                  {currentPlanets.map((planet) => (
                    <option key={planet.planet_id} value={planet.planet_id}>
                      {planet.name || planet.planet_id}
                    </option>
                  ))}
                </select>
              </label>
              <div className="war-action-row">
                <button className="secondary-button war-button" type="button" onClick={handleTaskForceStanceUpdate}>
                  更新姿态
                </button>
                <button className="secondary-button war-button" type="button" onClick={handleBlockade}>
                  发起封锁
                </button>
                <button className="secondary-button war-button" type="button" onClick={handleLanding}>
                  发起登陆
                </button>
              </div>
              {selectedTaskForce ? (
                <dl className="war-kv-list">
                  <div>
                    <dt>任务群</dt>
                    <dd>{selectedTaskForce.name || selectedTaskForce.id}</dd>
                  </div>
                  <div>
                    <dt>当前姿态</dt>
                    <dd>{formatTaskForceStance(selectedTaskForce.stance)}</dd>
                  </div>
                  <div>
                    <dt>补给态势</dt>
                    <dd>{formatSupplyCondition(selectedTaskForce.supply_status.condition)}</dd>
                  </div>
                  <div>
                    <dt>短缺</dt>
                    <dd>{selectedTaskForce.supply_status.shortages?.join(', ') || '无'}</dd>
                  </div>
                </dl>
              ) : (
                <p className="subtle-text">暂无任务群。</p>
              )}
            </article>

            <article className="war-card">
              <h3>战区目标</h3>
              <ul className="war-list">
                {theaters.length === 0 ? <li>暂无战区。</li> : theaters.map((theater) => (
                  <li key={theater.id}>
                    <strong>{theater.name || theater.id}</strong>
                    <span>{theater.objective?.description || theater.objective?.objective_type || '未设置目标'}</span>
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <div className="war-section-grid">
            <TaskForceForm
              scope={scope}
              runCommand={runCommand}
              isPending={isPending}
              taskForces={taskForces}
              theaters={theaters}
              fleets={fleets}
              currentPlanets={currentPlanets}
              focusSystemId={focusSystemId}
              selectedPlanetId={selectedPlanetId}
            />
            <TheaterForm
              scope={scope}
              runCommand={runCommand}
              isPending={isPending}
              theaters={theaters}
              currentPlanets={currentPlanets}
              focusSystemId={focusSystemId}
            />
          </div>
                </section>
              </div>
            ) : null}
            {activeTab === 'reports' ? (
              <div id="war-drawer-panel-reports" role="tabpanel">
                <section className="war-panel">
          <div className="war-panel__header">
            <div>
              <h2>战报与情报</h2>
              <p className="subtle-text">接触、补给、战报、封锁和登陆状态统一收口。</p>
            </div>
          </div>

          {feedbacks.reports?.map((feedback, index) => (
            <div className={`status-banner status-banner--${feedback.tone}`} key={`${feedback.title}-${index}`}>
              <strong>{feedback.title}</strong>
              {feedback.detail ? <span>{feedback.detail}</span> : null}
            </div>
          ))}

          <div className="war-section-grid">
            <article className="war-card">
              <h3>最新接触</h3>
              <ul className="war-list">
                {contacts.length === 0 ? <li>暂无接触。</li> : contacts.map((contact) => (
                  <li key={contact.id}>
                    <strong>{contact.classification || contact.contact_kind}</strong>
                    <span>
                      threat {formatMetric(contact.threat_level)}
                      {' · '}
                      lock {formatPercent(contact.lock_quality)}
                    </span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="war-card">
              <h3>最新战报</h3>
              <ul className="war-list">
                {battleReports.length === 0 ? <li>暂无战报。</li> : battleReports.map((report) => (
                  <li key={report.battle_id}>
                    <strong>{report.battle_id}</strong>
                    <span>target loss {formatMetric(report.target_strength_loss)} · jam {formatPercent(report.jamming_penalty)}</span>
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <div className="war-section-grid">
            <article className="war-card">
              <h3>封锁态势</h3>
              <ul className="war-list">
                {blockades.length === 0 ? <li>暂无封锁记录。</li> : blockades.map((blockade) => (
                  <li key={`${blockade.planet_id}-${blockade.task_force_id}`}>
                    <strong>{formatBlockadeStatus(blockade.status)}</strong>
                    <span>{blockade.planet_id} · intensity {formatPercent(blockade.intensity)}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="war-card">
              <h3>登陆行动</h3>
              <ul className="war-list">
                {landingOperations.length === 0 ? <li>暂无登陆行动。</li> : landingOperations.map((operation) => (
                  <li key={operation.id}>
                    <strong>{operation.id}</strong>
                    <span>{formatLandingStage(operation.stage)} · {operation.result}</span>
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <div className="war-section-grid">
            <FleetActionForm
              scope={scope}
              runCommand={runCommand}
              isPending={isPending}
              fleets={fleets}
              currentPlanets={currentPlanets}
              contacts={contacts}
              selectedPlanetId={selectedPlanetId}
              focusSystemId={focusSystemId}
            />
          </div>
                </section>
              </div>
            ) : null}
          </div>
        </MapDrawer>
      </section>
    </div>
  );
}
