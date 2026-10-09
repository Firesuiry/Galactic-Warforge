import { useMemo, useState } from 'react';

import type {
  Building,
  CatalogView,
  WarBlueprintDetailView,
  WarDeploymentHubView,
  WarIndustryView,
  WarProductionOrder,
  WarPublicBlueprintCatalogEntry,
} from '@shared/types';

import { Icon } from '@/common/Icon';
import { Input, Select } from '@/common/controls';
import { formatUnitCost, getBuildingDisplayName } from '@/features/planet-map/model';
import { UnitCard } from '@/features/war/components/UnitCard';
import { WarField } from '@/features/war/components/WarField';
import {
  formatBlueprintState,
  formatOrderStatus,
  formatProductionStage,
} from '@/features/war/format';
import {
  unitCardFromBlueprintDetail,
  unitCardFromPublicBlueprint,
  unitCardFromWorldUnit,
  type UnitCardModel,
} from '@/features/war/unit-card-model';
import type { WarCommandInput, WarQueryScope } from '@/features/war/war-query-keys';
import { useApiClient } from '@/hooks/use-api-client';

/**
 * 生产队列面板（C4 主路径）：替代"建筑+单位类型下拉框"的旧表单。
 * - 生产线：按工厂建筑分组的活动/排队订单（蓝图、数量、进度 tick、重复加成）；
 * - 部署枢纽：ready payloads 可部署数/容量 + 一键部署（deploy_squad/commission_fleet 按域分发）；
 * - 排队生产：蓝图卡片选择（公共蓝图 + 自有定型蓝图），科技未解锁置灰并显示门槛；
 * - 世界单位：worker/soldier/mecha 的 produce 进同一面板（选生产建筑卡片）。
 */

interface ProductionQueuePanelProps {
  scope: WarQueryScope;
  runCommand: (input: WarCommandInput) => void;
  isPending: boolean;
  catalog: CatalogView;
  industry: WarIndustryView;
  blueprints: WarBlueprintDetailView[];
  /** 具备量产功能（runtime.functions.production）的己方建筑（当前行星）。 */
  factoryBuildings: Building[];
  /** 当前行星全部己方建筑（世界单位 produce 的建筑筛选按 catalog.can_produce_units）。 */
  ownBuildings: Building[];
  completedTechIds: string[];
  focusSystemId: string;
  activePlanetId: string;
}

/** 卡片化的候选蓝图：自有蓝图与公共蓝图统一成一份选择模型。 */
interface BlueprintPick {
  id: string;
  name: string;
  domain: string;
  runtimeClass?: string;
  source: 'player' | 'public';
  /** 自有蓝图状态（public 恒 undefined）。 */
  state?: WarBlueprintDetailView['state'];
  techId?: string;
  techName?: string;
  locked: boolean;
  /** 非定型自有蓝图不能量产（服务端校验），卡片同样置灰。 */
  producible: boolean;
  card: UnitCardModel;
}

const FINALIZED_STATES: ReadonlySet<string> = new Set(['prototype', 'field_tested', 'adopted']);

/** 蓝图域 → 部署命令分发（与服务端 warBlueprintRuntimeClass 同规则：ground/air=小队，其余=舰队）。 */
export function isSquadBlueprint(domain: string, runtimeClass?: string) {
  if (runtimeClass) {
    return runtimeClass === 'combat_squad';
  }
  return domain === 'ground' || domain === 'air';
}

export function buildBlueprintPicks(input: {
  blueprints: WarBlueprintDetailView[];
  publicBlueprints: WarPublicBlueprintCatalogEntry[];
  catalog?: CatalogView;
  completedTechIds: ReadonlySet<string>;
}): BlueprintPick[] {
  const playerIds = new Set(input.blueprints.map((blueprint) => blueprint.id));
  const picks: BlueprintPick[] = input.blueprints.map((blueprint) => {
    const publicEntry = input.publicBlueprints.find((entry) => entry.id === blueprint.id)
      ?? input.publicBlueprints.find((entry) => entry.id === blueprint.parent_blueprint_id);
    const card = unitCardFromBlueprintDetail(blueprint, input.catalog, input.completedTechIds);
    return {
      id: blueprint.id,
      name: blueprint.name,
      domain: blueprint.domain,
      runtimeClass: publicEntry?.runtime_class,
      source: 'player' as const,
      state: blueprint.state,
      techId: card.techGate?.techId,
      techName: card.techGate?.techName,
      locked: Boolean(card.techGate && !card.techGate.unlocked),
      producible: FINALIZED_STATES.has(blueprint.state),
      card,
    };
  });
  input.publicBlueprints.forEach((entry) => {
    if (playerIds.has(entry.id)) {
      return;
    }
    const card = unitCardFromPublicBlueprint(entry, input.catalog, input.completedTechIds);
    picks.push({
      id: entry.id,
      name: entry.name,
      domain: entry.domain,
      runtimeClass: entry.runtime_class,
      source: 'public',
      techId: card.techGate?.techId,
      techName: card.techGate?.techName,
      locked: Boolean(card.techGate && !card.techGate.unlocked),
      producible: true,
      card,
    });
  });
  return picks;
}

/** 生产线分组：factory_building_id → 按 queue_index 排序的订单列表。 */
export function groupProductionLines(orders: WarProductionOrder[]) {
  const byFactory = new Map<string, WarProductionOrder[]>();
  orders.forEach((order) => {
    const group = byFactory.get(order.factory_building_id) ?? [];
    group.push(order);
    byFactory.set(order.factory_building_id, group);
  });
  return [...byFactory.entries()]
    .map(([factoryId, group]) => ({
      factoryId,
      orders: [...group].sort(
        (left, right) => (left.queue_index ?? 0) - (right.queue_index ?? 0),
      ),
    }))
    .sort((left, right) => left.factoryId.localeCompare(right.factoryId));
}

/** 订单进度：stage_remaining/total_ticks 可算时返回 [0,1]，否则 null。 */
export function orderProgress(order: WarProductionOrder): number | null {
  if (order.stage_total_ticks === undefined || order.stage_total_ticks <= 0) {
    return null;
  }
  const remaining = order.stage_remaining_ticks ?? order.stage_total_ticks;
  return Math.min(1, Math.max(0, 1 - remaining / order.stage_total_ticks));
}

export function ProductionQueuePanel({
  scope,
  runCommand,
  isPending,
  catalog,
  industry,
  blueprints,
  factoryBuildings,
  ownBuildings,
  completedTechIds,
  focusSystemId,
  activePlanetId,
}: ProductionQueuePanelProps) {
  const client = useApiClient();
  const [selectedBlueprintId, setSelectedBlueprintId] = useState('');
  const [count, setCount] = useState(1);
  const [factoryId, setFactoryId] = useState('');
  const [hubId, setHubId] = useState('');
  const [selectedWorldUnitId, setSelectedWorldUnitId] = useState('');
  const [producerId, setProducerId] = useState('');

  const completedTechIdSet = useMemo(() => new Set(completedTechIds), [completedTechIds]);
  const publicBlueprints = useMemo(
    () => catalog.warfare?.public_blueprints ?? [],
    [catalog],
  );
  const picks = useMemo(
    () => buildBlueprintPicks({
      blueprints,
      publicBlueprints,
      catalog,
      completedTechIds: completedTechIdSet,
    }),
    [blueprints, publicBlueprints, catalog, completedTechIdSet],
  );
  const selectedPick = picks.find((pick) => pick.id === selectedBlueprintId);

  const lines = useMemo(
    () => groupProductionLines(industry.production_orders ?? []),
    [industry.production_orders],
  );
  const hubs = industry.deployment_hubs ?? [];

  const blueprintNameById = useMemo(() => {
    const map = new Map<string, string>();
    blueprints.forEach((blueprint) => map.set(blueprint.id, blueprint.name));
    publicBlueprints.forEach((entry) => map.set(entry.id, entry.name));
    return map;
  }, [blueprints, publicBlueprints]);

  const blueprintDomainById = useMemo(() => {
    const map = new Map<string, { domain: string; runtimeClass?: string }>();
    blueprints.forEach((blueprint) => {
      const publicEntry = publicBlueprints.find((entry) => entry.id === blueprint.id)
        ?? publicBlueprints.find((entry) => entry.id === blueprint.parent_blueprint_id);
      map.set(blueprint.id, { domain: blueprint.domain, runtimeClass: publicEntry?.runtime_class });
    });
    publicBlueprints.forEach((entry) => {
      if (!map.has(entry.id)) {
        map.set(entry.id, { domain: entry.domain, runtimeClass: entry.runtime_class });
      }
    });
    return map;
  }, [blueprints, publicBlueprints]);

  const buildingLabelById = useMemo(() => {
    const map = new Map<string, string>();
    ownBuildings.forEach((building) => {
      map.set(building.id, `${getBuildingDisplayName(catalog, building.type)} (${building.id})`);
    });
    return map;
  }, [ownBuildings]);

  const factory = factoryBuildings.find((item) => item.id === factoryId) ?? factoryBuildings[0];
  const hub = hubs.find((item) => item.building_id === hubId) ?? hubs[0];

  // 世界单位生产建筑：catalog.can_produce_units 且在当前行星为己方
  const producerBuildings = useMemo(() => {
    const producibleTypes = new Set(
      (catalog.buildings ?? [])
        .filter((entry) => entry.can_produce_units)
        .map((entry) => entry.id),
    );
    return ownBuildings.filter((building) => producibleTypes.has(building.type));
  }, [catalog.buildings, ownBuildings]);
  const producer = producerBuildings.find((item) => item.id === producerId) ?? producerBuildings[0];

  const worldUnits = useMemo(
    () => (catalog.world_units ?? []).filter((entry) => entry.public),
    [catalog.world_units],
  );
  const selectedWorldUnit = worldUnits.find((entry) => entry.id === selectedWorldUnitId);

  function handleQueue() {
    if (!selectedPick || !factory?.id || !hub?.building_id) {
      return;
    }
    runCommand({
      section: 'industry',
      invalidateKeys: [
        ['war-industry', scope.serverUrl, scope.playerId],
        ['war-fleets', scope.serverUrl, scope.playerId],
      ],
      execute: () => client.cmdQueueMilitaryProduction(
        factory.id,
        hub.building_id,
        selectedPick.id,
        { count: Math.max(1, Math.floor(Number(count) || 1)) },
      ),
    });
  }

  function handleDeployPayload(targetHub: WarDeploymentHubView, blueprintId: string) {
    const meta = blueprintDomainById.get(blueprintId);
    const domain = meta?.domain ?? 'ground';
    if (isSquadBlueprint(domain, meta?.runtimeClass)) {
      runCommand({
        section: 'industry',
        invalidateKeys: [['war-industry', scope.serverUrl, scope.playerId]],
        execute: () => client.cmdDeploySquad(targetHub.building_id, blueprintId, {
          count: 1,
          planetId: targetHub.planet_id ?? activePlanetId,
        }),
      });
      return;
    }
    if (!focusSystemId) {
      return;
    }
    runCommand({
      section: 'industry',
      invalidateKeys: [
        ['war-industry', scope.serverUrl, scope.playerId],
        ['war-fleets', scope.serverUrl, scope.playerId],
        ['system-runtime', scope.serverUrl, scope.playerId, focusSystemId],
      ],
      execute: () => client.cmdCommissionFleet(targetHub.building_id, blueprintId, focusSystemId, { count: 1 }),
    });
  }

  function handleProduce() {
    if (!selectedWorldUnit || !producer?.id) {
      return;
    }
    runCommand({
      section: 'industry',
      invalidateKeys: [
        ['planet', scope.serverUrl, scope.playerId, activePlanetId],
        ['planet-scene', scope.serverUrl, scope.playerId, activePlanetId],
        ['summary', scope.serverUrl, scope.playerId],
      ],
      execute: () => client.cmdProduce(producer.id, selectedWorldUnit.id),
    });
  }

  return (
    <div className="production-queue" data-testid="production-queue-panel">
      {/* 生产线：按工厂分组的活动/排队订单 */}
      <section className="war-card">
        <h3>生产线</h3>
        {lines.length === 0 ? (
          <p className="subtle-text">暂无生产线订单：在下方选蓝图卡片下达量产。</p>
        ) : (
          <div className="production-queue__lines">
            {lines.map((line) => (
              <article className="production-line" key={line.factoryId} data-testid="production-line">
                <header className="production-line__head">
                  <Icon iconKey="factory" size={16} />
                  <strong>{buildingLabelById.get(line.factoryId) ?? line.factoryId}</strong>
                  <span className="badge">{line.orders.length} 单</span>
                </header>
                <ul className="production-line__orders">
                  {line.orders.map((order) => {
                    const progress = orderProgress(order);
                    return (
                      <li key={order.id} className="production-order" data-testid="production-order">
                        <div className="production-order__row">
                          <strong>{blueprintNameById.get(order.blueprint_id) ?? order.blueprint_id}</strong>
                          <span className="badge">{formatOrderStatus(order.status)}</span>
                          <span className="badge">{formatProductionStage(order.stage)}</span>
                          {order.repeat_bonus_percent ? (
                            <span className="badge badge--ok">重复加成 {order.repeat_bonus_percent}%</span>
                          ) : null}
                        </div>
                        <div className="production-order__row production-order__meta">
                          <span>
                            {order.completed_count}/{order.count} 台
                          </span>
                          {order.stage_remaining_ticks !== undefined ? (
                            <span>剩余 {order.stage_remaining_ticks} tick</span>
                          ) : null}
                          {order.deployment_hub_id ? <span>→ {order.deployment_hub_id}</span> : null}
                        </div>
                        {progress !== null ? (
                          <div
                            aria-label={`进度 ${Math.round(progress * 100)}%`}
                            className="production-order__progress"
                            role="progressbar"
                            aria-valuemax={100}
                            aria-valuemin={0}
                            aria-valuenow={Math.round(progress * 100)}
                          >
                            <div style={{ width: `${progress * 100}%` }} />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 部署枢纽：ready payloads + 一键部署 */}
      <section className="war-card">
        <h3>部署枢纽</h3>
        {hubs.length === 0 ? (
          <p className="subtle-text">暂无部署枢纽：在行星建造部署枢纽后，量产成品会进入枢纽待部署。</p>
        ) : (
          <div className="production-queue__hubs">
            {hubs.map((entry) => {
              const payloads = Object.entries(entry.ready_payloads ?? {});
              return (
                <article className="deployment-hub" key={entry.building_id} data-testid="deployment-hub">
                  <header className="deployment-hub__head">
                    <Icon iconKey="supply_depot" size={16} />
                    <strong>{getBuildingDisplayName(catalog, entry.building_type)} ({entry.building_id})</strong>
                  </header>
                  <p className="subtle-text">
                    容量 {entry.capacity ?? 0} · 行星 {entry.planet_id ?? '-'}
                  </p>
                  {payloads.length === 0 ? (
                    <p className="subtle-text">暂无待部署成品。</p>
                  ) : (
                    <ul className="deployment-hub__payloads">
                      {payloads.map(([blueprintId, readyCount]) => {
                        const meta = blueprintDomainById.get(blueprintId);
                        const squad = isSquadBlueprint(meta?.domain ?? 'ground', meta?.runtimeClass);
                        return (
                          <li key={blueprintId}>
                            <span>
                              {blueprintNameById.get(blueprintId) ?? blueprintId}
                              {' · '}可部署 {readyCount}
                            </span>
                            <button
                              className="secondary-button war-button"
                              type="button"
                              disabled={isPending || (!squad && !focusSystemId)}
                              title={squad ? 'deploy_squad：落地为战斗小队' : 'commission_fleet：编成舰队'}
                              onClick={() => handleDeployPayload(entry, blueprintId)}
                            >
                              {squad ? '部署小队' : '编成舰队'}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 排队生产：蓝图卡片选择 */}
      <section className="war-card">
        <h3>排队量产</h3>
        {picks.length === 0 ? (
          <p className="subtle-text">暂无可用蓝图：到「蓝图」页签创建/定型，或等待公共蓝图目录。</p>
        ) : (
          <div className="blueprint-pick-grid" role="listbox" aria-label="量产蓝图">
            {picks.map((pick) => {
              const disabled = pick.locked || !pick.producible;
              const selected = pick.id === selectedPick?.id;
              return (
                <button
                  aria-selected={selected}
                  className={`blueprint-pick${selected ? ' blueprint-pick--selected' : ''}${disabled ? ' blueprint-pick--disabled' : ''}`}
                  disabled={disabled}
                  key={pick.id}
                  onClick={() => setSelectedBlueprintId(pick.id)}
                  role="option"
                  type="button"
                >
                  <span className="blueprint-pick__name">{pick.name}</span>
                  <span className="blueprint-pick__meta">
                    <span className="war-chip">{pick.domain}</span>
                    {pick.source === 'player' && pick.state ? (
                      <span className="war-chip">{formatBlueprintState(pick.state)}</span>
                    ) : (
                      <span className="war-chip">公共蓝图</span>
                    )}
                  </span>
                  {pick.locked ? (
                    <span className="blueprint-pick__lock">需要科技：{pick.techName ?? pick.techId}</span>
                  ) : null}
                  {!pick.locked && !pick.producible ? (
                    <span className="blueprint-pick__lock">蓝图未定型（先到蓝图页签定型）</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        {selectedPick ? <UnitCard card={selectedPick.card} /> : null}

        <div className="war-slot-row">
          <WarField label="数量">
            <Input
              type="number"
              min={1}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </WarField>
          <WarField label="量产工厂">
            <Select
              value={factory?.id ?? ''}
              onChange={(event) => setFactoryId(event.target.value)}
              disabled={factoryBuildings.length === 0}
            >
              {factoryBuildings.length === 0 ? (
                <option value="">当前行星暂无生产建筑</option>
              ) : factoryBuildings.map((building) => (
                <option key={building.id} value={building.id}>
                  {getBuildingDisplayName(catalog, building.type)} ({building.id})
                </option>
              ))}
            </Select>
          </WarField>
          <WarField label="目标枢纽">
            <Select
              value={hub?.building_id ?? ''}
              onChange={(event) => setHubId(event.target.value)}
              disabled={hubs.length === 0}
            >
              {hubs.length === 0 ? (
                <option value="">暂无部署枢纽</option>
              ) : hubs.map((entry) => (
                <option key={entry.building_id} value={entry.building_id}>
                  {getBuildingDisplayName(catalog, entry.building_type)} ({entry.building_id})
                </option>
              ))}
            </Select>
          </WarField>
          <button
            className="secondary-button war-button"
            type="button"
            disabled={isPending || !selectedPick || !factory || !hub}
            onClick={handleQueue}
          >
            下达量产
          </button>
        </div>
      </section>

      {/* 世界单位生产（produce）：与军工同一面板 */}
      <section className="war-card">
        <h3>世界单位生产</h3>
        {worldUnits.length === 0 || producerBuildings.length === 0 ? (
          <p className="subtle-text">
            {worldUnits.length === 0 ? '目录暂无世界单位。' : '当前行星暂无单位生产建筑（如指挥中心和工厂）。'}
          </p>
        ) : (
          <>
            <div className="blueprint-pick-grid" role="listbox" aria-label="世界单位">
              {worldUnits.map((entry) => {
                const card = unitCardFromWorldUnit(entry, catalog, completedTechIdSet);
                const locked = Boolean(card.techGate && !card.techGate.unlocked);
                const selected = entry.id === selectedWorldUnit?.id;
                return (
                  <button
                    aria-selected={selected}
                    className={`blueprint-pick${selected ? ' blueprint-pick--selected' : ''}${locked ? ' blueprint-pick--disabled' : ''}`}
                    disabled={locked}
                    key={entry.id}
                    onClick={() => setSelectedWorldUnitId(entry.id)}
                    role="option"
                    type="button"
                  >
                    <span className="blueprint-pick__name">{entry.name}</span>
                    <span className="blueprint-pick__meta">
                      <span className="war-chip">{entry.domain}</span>
                    </span>
                    {locked ? (
                      <span className="blueprint-pick__lock">需要科技：{card.techGate?.techName ?? card.techGate?.techId}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {selectedWorldUnit ? (
              <>
                <UnitCard card={unitCardFromWorldUnit(selectedWorldUnit, catalog, completedTechIdSet)} />
                <p data-testid="world-unit-cost">造价：{formatUnitCost(catalog, selectedWorldUnit) || '无'}</p>
              </>
            ) : null}
            <div className="war-slot-row">
              <WarField label="生产建筑">
                <Select
                  value={producer?.id ?? ''}
                  onChange={(event) => setProducerId(event.target.value)}
                >
                  {producerBuildings.map((building) => (
                    <option key={building.id} value={building.id}>
                      {getBuildingDisplayName(catalog, building.type)} ({building.id})
                    </option>
                  ))}
                </Select>
              </WarField>
              <button
                className="secondary-button war-button"
                type="button"
                disabled={isPending || !selectedWorldUnit || !producer}
                onClick={handleProduce}
              >
                生产单位
              </button>
            </div>
            <p className="subtle-text">世界单位产出即刻结算（消耗矿产/能量，数值以服务端为准）。</p>
          </>
        )}
      </section>
    </div>
  );
}
