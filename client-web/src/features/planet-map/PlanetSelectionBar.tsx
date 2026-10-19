import { AmmunitionBar } from "@/features/war/components/AmmunitionBar";
/**
 * 选中情境条：地图底部的选中对象快捷操作（群星式）。
 * 建筑：升级/拆除；单位：移动/攻击（进入地图点选模式）；地块/资源：只读信息。
 */

import { useState } from 'react';
import { surfaceDistanceWithin } from '@shared/surface';
import type { AlertEntry, Building, CatalogView, CombatSquad, CommandResponse, Position, StateSummary } from '@shared/types';
import { haulUnreachableDetail, isAlertActive } from '@shared/alerts';

import { Icon } from '@/common/Icon';
import { sfx } from '@/engine/audio';
import { submitPlanetCommand } from '@/features/planet-commands/executor';
import {
  PLANET_COMMAND_RECOVERY_EVENT_TYPES,
} from '@/features/planet-commands/store';
import {
  formatItemInventorySummary,
  getBuildingDisplayName,
  getItemDisplayName,
  type PlanetRenderView,
} from '@/features/planet-map/model';
import { summarizeUnitSelection } from '@/features/planet-map/rts-commands';
import { allAutoHaul, describeHaul, hasTransportRobot, isTransportRobot, transportHaulMode, transportHaulTask } from '@/features/planet-map/transport-haul';
import { usePlanetViewStore } from '@/features/planet-map/store';
import { MECHA_MINE_ENERGY_PER_ITEM, MECHA_MINE_RANGE, MECHA_MINE_TICKS_PER_ITEM } from '@/features/planet-map/mecha-costs';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { selectMyMecha } from '@/features/mecha/model';
import { translateBuildingState, translateUnitType } from '@/i18n/translate';

interface PlanetSelectionBarProps {
  catalog?: CatalogView;
  /** "详情"入口：切到侧栏"选中对象"页签展示完整建筑详情。 */
  onShowDetail?: () => void;
  planet: PlanetRenderView;
  /** C4：战斗小队列表（planet_runtime.combat_squads），小队选中面板的实体源。 */
  squads?: CombatSquad[];
  /** /state/summary：采集面板据此找「我的机甲」（operator 等于自己）。 */
  summary?: StateSummary;
  /**
   * 当前仍成立的产线告警：运输机器人选中条据此显示 `haul_unreachable`
   * （「这台机器人到不了目标」），玩家才知道它为什么空转。
   */
  alerts?: readonly AlertEntry[];
}

/** 建筑本地存储摘要，如 "硅矿 12 · 容量 12/20"；无存储数据时返回 null。 */
function formatBuildingStorageSummary(
  catalog: CatalogView | undefined,
  building: Building,
): string | null {
  const inventory = building.storage?.inventory;
  const hasItems = Object.values(inventory ?? {}).some((amount) => amount !== 0);
  const capacity =
    building.storage?.capacity ?? building.runtime?.functions?.storage?.capacity;
  if (!hasItems && capacity === undefined) {
    return null;
  }
  const parts: string[] = [];
  if (hasItems) {
    parts.push(`库存 ${formatItemInventorySummary(catalog, inventory)}`);
  } else {
    parts.push('库存空');
  }
  if (capacity !== undefined) {
    const total = Object.values(inventory ?? {}).reduce((sum, amount) => sum + amount, 0);
    parts.push(`容量 ${total}/${capacity}`);
  }
  return parts.join(' · ');
}

/** 默认采集数量：按机甲能量可采件数，1–10 之间，且不超过矿点剩余。 */
export function defaultMiningQuantity(remaining: number | undefined, energy: number | undefined) {
  const byEnergy = energy === undefined ? 10 : Math.floor(energy / MECHA_MINE_ENERGY_PER_ITEM);
  return Math.max(1, Math.min(10, byEnergy, remaining ?? 10));
}

/** 机甲 6 格内可手动采集的固体矿点（机甲站在矿上时点格会选中机甲，这里给出入口）。 */
export function findNearbyMinableResource(planet: PlanetRenderView, catalog: CatalogView | undefined, position: Position) {
  const solid = new Set((catalog?.items ?? []).filter(item => item.form === 'solid').map(item => item.id));
  let best: { resource: NonNullable<PlanetRenderView['resources']>[number]; distance: number } | undefined;
  for (const resource of planet.resources ?? []) {
    if (resource.behavior !== 'finite' || !solid.has(resource.kind) || (resource.remaining ?? 0) <= 0) continue;
    const distance = surfaceDistanceWithin(position, resource.position, planet.surface.face_size, MECHA_MINE_RANGE);
    if (distance !== undefined && (!best || distance < best.distance)) best = { resource, distance };
  }
  return best?.resource;
}

export function PlanetSelectionBar({ alerts, catalog, onShowDetail, planet, squads, summary }: PlanetSelectionBarProps) {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const selected = usePlanetViewStore((state) => state.selected);
  const selectedUnits = usePlanetViewStore((state) => state.selectedUnits);
  const selectedSquads = usePlanetViewStore((state) => state.selectedSquads);
  const interactionMode = usePlanetViewStore((state) => state.interactionMode);
  const setInteractionMode = usePlanetViewStore((state) => state.setInteractionMode);
  const exitInteractionMode = usePlanetViewStore((state) => state.exitInteractionMode);
  const setSelected = usePlanetViewStore((state) => state.setSelected);
  // 采集数量草稿按资源点隔离：切换目标后回到默认值，不残留上次输入。
  const [quantityDraft, setQuantityDraft] = useState<{ resourceId: string; value: number } | null>(null);
  const [miningPending, setMiningPending] = useState(false);

  function submit(commandType: string, execute: () => Promise<CommandResponse>, focus?: { entityId?: string }) {
    void submitPlanetCommand({
      commandType,
      planetId: planet.planet_id,
      focus,
      execute,
      fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({
        event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES],
        limit: 50,
      }),
    });
  }

  // 小队选中面板（C4）：≥1 个战斗小队时显示编成与部署提示（右键地图直接部署）。
  const activeHaul = interactionMode.kind === 'haul' ? interactionMode : null;
  const aliveSquadSelection = selectedSquads    .map((id) => (squads ?? []).find((squad) => squad.id === id))
    .filter((squad): squad is CombatSquad => Boolean(squad && squad.owner_id === session.playerId && squad.state !== 'destroyed'));
  if (aliveSquadSelection.length > 0) {
    const composition = aliveSquadSelection
      .map((squad) => `${squad.name || squad.id}×${squad.member_ids?.length ?? 0}`)
      .join(' · ');
    return (
      <div className="planet-selection-bar" data-testid="planet-selection-bar">
        <Icon iconKey="soldier" size={20} />
        <div className="planet-selection-bar__info">
          <strong>已选 {aliveSquadSelection.length} 个小队</strong>
          <span className="planet-selection-bar__meta">{composition}</span>
          <span className="planet-selection-bar__meta">右键点地图把所属任务群部署到该点</span>
        </div>
        <div className="planet-selection-bar__actions">
          {aliveSquadSelection.length === 1 && onShowDetail ? (
            <button className="secondary-button" type="button" onClick={onShowDetail}>
              小队卡片
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // 多选面板（C1）：≥2 个单位时显示构成与批量指令入口
  const aliveSelection = selectedUnits.filter((id) => planet.units?.[id]?.owner_id === session.playerId);
  if (aliveSelection.length >= 2) {
    const composition = summarizeUnitSelection(planet, aliveSelection)
      .map((entry) => `${translateUnitType(entry.type)}×${entry.count}`)
      .join(' · ');
    const orderEligible = aliveSelection.filter((id) => !planet.units?.[id]?.mecha);
    // 运输机器人（§4）：多选可一次设同一路线（同一 unit_order haul 带 entity_ids）。
    const robotIds = aliveSelection.filter((id) => isTransportRobot(planet.units?.[id]));
    const orderButtons: { label: string; title: string; action: () => void }[] = [
      { label: '移动', title: '右键点地也可移动', action: () => setInteractionMode({ kind: 'move' }) },
      { label: '攻击', title: '右键点敌也可攻击', action: () => setInteractionMode({ kind: 'attack' }) },
      ...(robotIds.length > 0 ? [
        {
          label: allAutoHaul(robotIds.map((id) => planet.units?.[id])) ? '自动搬运 ✓' : '自动搬运',
          title: '切回全局自动搬运（出厂默认）：自动给本行星缺料的建筑送料',
          action: () => submit('unit_order', () => client.cmdAutoHaul(robotIds), { entityId: robotIds[0] }),
        },
        {
          label: activeHaul ? (activeHaul.fromBuildingId ? '已选起点，点终点' : '点起点建筑') : '设置运输',
          title: '依次点击起点建筑、终点建筑，为选中的运输机器人设同一条路线',
          action: () => {
            if (activeHaul) exitInteractionMode();
            else setInteractionMode({ kind: 'haul' as const });
          },
        },
        {
          label: '停止',
          title: '停止搬运，原地待命（点「自动搬运」可恢复）',
          action: () => submit('unit_order', () => client.cmdUnitOrder(robotIds, 'stop'), { entityId: robotIds[0] }),
        },
      ] : []),
      ...(orderEligible.length > 0 ? [
        { label: '攻击移动', title: 'A · 沿途交战推进', action: () => setInteractionMode({ kind: 'unit_order' as const, order: 'attack_move' as const }) },
        { label: '巡逻', title: 'P · 点击巡逻目标点', action: () => setInteractionMode({ kind: 'unit_order' as const, order: 'patrol' as const }) },
        { label: '守卫', title: 'G · 点击要守卫的目标', action: () => setInteractionMode({ kind: 'unit_order' as const, order: 'guard' as const }) },
        { label: '坚守', title: 'H · 原地坚守', action: () => submit('unit_order', () => client.cmdUnitOrder(orderEligible, 'hold'), { entityId: orderEligible[0] }) },
        { label: '停止', title: 'S · 停止当前命令', action: () => submit('unit_order', () => client.cmdUnitOrder(orderEligible, 'stop'), { entityId: orderEligible[0] }) },
      ] : []),
    ];
    return (
      <div className="planet-selection-bar" data-testid="planet-selection-bar">
        <Icon iconKey="soldier" size={20} />
        <div className="planet-selection-bar__info">
          <strong>已选 {aliveSelection.length} 个单位</strong>
          {aliveSelection.some(id=>planet.units?.[id]?.combat_state==='no_ammunition')?<span role="alert">{aliveSelection.filter(id=>planet.units?.[id]?.combat_state==='no_ammunition').length} 个单位弹药耗尽</span>:null}
          <span className="planet-selection-bar__meta">{composition}</span>
          <span className="planet-selection-bar__hint">右键地面移动 · 右键敌人攻击 · Ctrl+数字编队</span>
        </div>
        <div className="planet-selection-bar__actions">
          {orderButtons.map((button, index) => (
            <button
              className="secondary-button"
              // 运输机器人块与通用指令块都有「停止」，按 label 做 key 会重复。
              key={`${button.label}-${index}`}
              title={button.title}
              type="button"
              onClick={() => {
                sfx.uiClick();
                button.action();
              }}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!selected || selected.kind === 'tile') {
    return null;
  }

  if (selected.kind === 'resource') {
    const resource = planet.resources?.find(entry => entry.id === selected.id);
    if (!resource) return null;
    // 「我的机甲」= summary 里 operator 等于自己的那台（契约 §7.3）：采集命令不再带 entity_id，
    // 服务端按发令者绑定的机甲执行；这里只用来显示能量/作业/距离。
    const myMecha = selectMyMecha(summary, session.playerId);
    const mecha = myMecha ? planet.units?.[myMecha.unit_id] : undefined;
    const mechaElsewhere = myMecha && !mecha ? myMecha.planet_id : undefined;
    const inRange = mecha && surfaceDistanceWithin(mecha.position, resource.position, planet.surface.face_size, MECHA_MINE_RANGE) !== undefined;
    const solid = catalog?.items?.some(item => item.id === resource.kind && item.form === 'solid') && resource.behavior === 'finite';
    const quantity = quantityDraft?.resourceId === resource.id
      ? quantityDraft.value
      : defaultMiningQuantity(resource.remaining, mecha?.mecha?.energy);
    const count = Number.isFinite(quantity) ? Math.max(1, Math.min(999, Math.floor(quantity))) : 1;
    const enough = (resource.remaining ?? 0) >= count;
    return <div className="planet-selection-bar" data-testid="planet-selection-bar">
      <Icon iconKey={resource.kind} size={20} />
      <div className="planet-selection-bar__info">
        <strong>{getItemDisplayName(catalog, resource.kind)}</strong>
        <span className="planet-selection-bar__meta">剩余 {resource.remaining ?? '—'} · ({resource.position.x}, {resource.position.y})</span>
        <span className="planet-selection-bar__meta">{!solid ? '需要采集设施' : !myMecha ? '未绑定机甲：在行星上选中一台机甲 → 接管' : mechaElsewhere ? `你的机甲在 ${mechaElsewhere}，不在本星球` : !mecha ? '本地暂无己方机甲' : !inRange ? `请将机甲移动到矿点 ${MECHA_MINE_RANGE} 格内` : mecha.mecha?.job ? '机甲正在执行任务，请先完成或取消' : !enough ? '矿点剩余数量不足' : `每件 ${MECHA_MINE_TICKS_PER_ITEM} tick · 消耗 ${count * MECHA_MINE_ENERGY_PER_ITEM} 核心能量`}</span>
      </div>
      {solid && mecha ? <form className="planet-selection-bar__actions" onSubmit={async event => {
        event.preventDefault();
        if (!inRange || !enough || mecha.mecha?.job || miningPending) return;
        setMiningPending(true);
        try {
          await submitPlanetCommand({ commandType: 'mine_resource', planetId: planet.planet_id, focus: { entityId: mecha.id },
            execute: () => client.cmdMineResource(resource.id, count, planet.planet_id),
            fetchAuthoritativeSnapshot: () => client.fetchEventSnapshot({ event_types: [...PLANET_COMMAND_RECOVERY_EVENT_TYPES], limit: 50 }),
          });
        } finally { setMiningPending(false); }
      }}>
        <label>采集数量<input aria-label="采集数量" type="number" min={1} max={Math.min(999, resource.remaining ?? 1)} step={1} value={quantity} onChange={event => setQuantityDraft({ resourceId: resource.id, value: Number(event.target.value) })} /></label>
        <button className="secondary-button" disabled={!inRange || !enough || Boolean(mecha.mecha?.job) || miningPending} type="submit">手动采集</button>
        <button className="secondary-button" type="button" onClick={() => { setSelected({ kind: 'unit', id: mecha.id, position: mecha.position }); onShowDetail?.(); }}>机甲详情</button>
      </form> : null}
    </div>;
  }

  if (selected.kind === 'building') {
    const building = planet.buildings?.[selected.id];
    if (!building) {
      return null;
    }
    const name = getBuildingDisplayName(catalog, building.type);
    const ownBuilding = building.owner_id === session.playerId;
    const storageSummary = formatBuildingStorageSummary(catalog, building);
    return (
      <div className="planet-selection-bar" data-testid="planet-selection-bar">
        <Icon iconKey={building.type} size={20} />
        <div className="planet-selection-bar__info">
          <strong>{name}</strong>
          <span className="planet-selection-bar__meta">
            ({building.position.x}, {building.position.y}) · {translateBuildingState(building.runtime?.state)}
          </span>
          {/* 采集建筑只采一种矿（第 16 轮契约 §5.1）：选中条直接写明是哪一种。 */}
          {building.mining_item ? (
            <span className="planet-selection-bar__meta">
              开采 {getItemDisplayName(catalog, building.mining_item)}
            </span>
          ) : null}
          {storageSummary ? (
            <span className="planet-selection-bar__meta">{storageSummary}</span>
          ) : null}
        </div>
        {ownBuilding ? (
          <div className="planet-selection-bar__actions">
            {onShowDetail ? (
              <button
                className="secondary-button"
                type="button"
                onClick={onShowDetail}
              >
                详情
              </button>
            ) : null}
            <button
              className="secondary-button"
              type="button"
              onClick={() => submit('upgrade', () => client.cmdUpgrade(building.id), { entityId: building.id })}
            >
              升级
            </button>
            <button
              className="secondary-button planet-selection-bar__danger"
              type="button"
              onClick={() => {
                submit('demolish', () => client.cmdDemolish(building.id), { entityId: building.id });
                setSelected(null);
              }}
            >
              拆除
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (selected.kind === 'unit') {
    // 单位可能已掉出相机窗口（/scene 只返回窗口内实体），此时不能整条清空选择条：
    // 玩家仍然持有这个选中单位，右键/移动按钮还要继续对它下命令（试玩 1010 E）。
    const unit = planet.units?.[selected.id];
    if (!unit) {
      return (
        <div className="planet-selection-bar" data-testid="planet-selection-bar">
          <div className="planet-selection-bar__info">
            <strong>已选中的单位不在当前视野</strong>
            <span className="planet-selection-bar__meta">镜头移出了它的位置；右键地图仍可下达移动/攻击指令</span>
          </div>
        </div>
      );
    }
    const ownUnit = unit.owner_id === session.playerId;
    const underfootResource = ownUnit && unit.mecha ? findNearbyMinableResource(planet, catalog, unit.position) : undefined;
    // 运输机器人卡死提示（第 16 轮契约 haul_unreachable）：只看仍然成立、且 details.unit_id
    // 就是这台机器人的告警——服务端告警的 building_id/building_type 是**目标建筑**，
    // 只有 details.unit_id 指向机器人。
    const haulBlocked = isTransportRobot(unit)
      ? (alerts ?? []).find((alert) => alert.alert_type === 'haul_unreachable'
        && isAlertActive(alert)
        && alert.details?.unit_id === unit.id)
      : undefined;
    const haulBlockedDetail = haulBlocked
      ? haulUnreachableDetail(haulBlocked, (buildingId) => {
        const target = planet.buildings?.[buildingId];
        return target ? getBuildingDisplayName(catalog, target.type) : undefined;
      })
      : '';
    const activeMode = interactionMode.kind !== 'inspect' && interactionMode.kind !== 'build'
      ? interactionMode
      : null;
    return (
      <div className="planet-selection-bar" data-testid="planet-selection-bar">
        <Icon iconKey={unit.type} size={20} />
        <div className="planet-selection-bar__info">
          <strong>{translateUnitType(unit.type)}</strong>
          <span className="planet-selection-bar__meta">
            ({unit.position.x}, {unit.position.y}) · HP {unit.hp}/{unit.max_hp}
          </span>
          {isTransportRobot(unit) ? (
            <span className="planet-selection-bar__meta">
              {describeHaul(
                unit,
                (itemId) => getItemDisplayName(catalog, itemId),
                (buildingId) => {
                  const building = planet.buildings?.[buildingId];
                  return building ? getBuildingDisplayName(catalog, building.type) : undefined;
                },
              ) ?? (transportHaulMode(unit) === 'idle' ? '已停止' : '自动待命')}
            </span>
          ) : null}
          {haulBlocked ? (
            <span
              className="planet-selection-bar__meta planet-selection-bar__warning"
              data-testid="haul-unreachable"
              role="alert"
              title="运输机器人到不了目标：先清出通往目标建筑的路（别把它围死），或改派别的终点"
            >
              运输机器人到不了目标{haulBlockedDetail ? `：${haulBlockedDetail}` : ''}
            </span>
          ) : null}
          {unit.ammo_capacity?<AmmunitionBar current={unit.ammo??0} capacity={unit.ammo_capacity}/>:null}
          {unit.mecha ? <span className="planet-selection-bar__meta">
            能量 {unit.mecha.energy}/{unit.mecha.max_energy} · 护盾 {unit.mecha.shield}/{unit.mecha.max_shield}
          </span> : null}
          {ownUnit ? <span className="planet-selection-bar__hint">右键地面移动 · 右键敌人攻击</span> : null}
        </div>
        {ownUnit ? (
          <div className="planet-selection-bar__actions">
            {onShowDetail ? <button className="secondary-button" type="button" onClick={onShowDetail}>
              {unit.mecha ? '机甲详情' : '详情'}
            </button> : null}
            {underfootResource ? (
              <button
                className="secondary-button"
                type="button"
                title="选中机甲附近的矿点，进入手动采集"
                onClick={() => setSelected({ kind: 'resource', id: underfootResource.id, position: underfootResource.position })}
              >
                采集脚下{getItemDisplayName(catalog, underfootResource.kind)}
              </button>
            ) : null}
            <button
              className={`secondary-button${activeMode?.kind === 'move' ? ' planet-selection-bar__active' : ''}`}
              type="button"
              title="M · 也可直接右键点地移动"
              onClick={() => {
                sfx.uiClick();
                if (activeMode?.kind === 'move') {
                  exitInteractionMode();
                } else {
                  setInteractionMode({ kind: 'move' });
                }
              }}
            >
              {activeMode?.kind === 'move' ? '取消移动' : '移动'}
            </button>
            <button
              className={`secondary-button${activeMode?.kind === 'attack' ? ' planet-selection-bar__active' : ''}`}
              type="button"
              title="也可直接右键点敌攻击"
              onClick={() => {
                sfx.uiClick();
                if (activeMode?.kind === 'attack') {
                  exitInteractionMode();
                } else {
                  setInteractionMode({ kind: 'attack' });
                }
              }}
            >
              {activeMode?.kind === 'attack' ? '取消攻击' : '攻击'}
            </button>
            {!unit.mecha ? (
              <>
                <button
                  className={`secondary-button${activeMode?.kind === 'unit_order' && activeMode.order === 'attack_move' ? ' planet-selection-bar__active' : ''}`}
                  type="button"
                  title="A · 攻击移动：点击目标点，沿途交战"
                  onClick={() => {
                    sfx.uiClick();
                    setInteractionMode({ kind: 'unit_order', order: 'attack_move' });
                  }}
                >
                  攻击移动
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  title="H · 原地坚守：不追击，射程内自动开火"
                  onClick={() => submit('unit_order', () => client.cmdUnitOrder(unit.id, 'hold'), { entityId: unit.id })}
                >
                  坚守
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  title="S · 停止当前命令，回到待命"
                  onClick={() => submit('unit_order', () => client.cmdUnitOrder(unit.id, 'stop'), { entityId: unit.id })}
                >
                  停止
                </button>
              </>
            ) : null}
            {/* 运输机器人（§2.1）：自动搬运（出厂默认，切换按钮高亮）/ 设置运输（进入固定路线）/ 停止（进入待命）。 */}
            {isTransportRobot(unit) ? (
              <>
                <button
                  className={`secondary-button${transportHaulMode(unit) === 'auto' ? ' planet-selection-bar__active' : ''}`}
                  type="button"
                  title="切回全局自动搬运（出厂默认）：自动给本行星缺料的建筑送料"
                  onClick={() => submit('unit_order', () => client.cmdAutoHaul(unit.id), { entityId: unit.id })}
                >
                  自动搬运
                </button>
                <button
                  className={`secondary-button${activeMode?.kind === 'haul' ? ' planet-selection-bar__active' : ''}`}
                  type="button"
                  title="依次点击起点建筑、终点建筑；物品留空由服务端取终点能接收的第一种"
                  onClick={() => {
                    sfx.uiClick();
                    if (activeMode?.kind === 'haul') {
                      exitInteractionMode();
                    } else {
                      setInteractionMode({ kind: 'haul' });
                    }
                  }}
                >
                  {activeMode?.kind === 'haul'
                    ? (activeMode.fromBuildingId ? '已选起点，点终点' : '点起点建筑')
                    : '设置运输'}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return null;
}
