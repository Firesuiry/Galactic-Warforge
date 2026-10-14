/**
 * 运输机器人（transport_robot）路线的纯逻辑：阶段文案、路线解析、命令载荷。
 *
 * 契约（服务端另一分支实现，前端按此渲染，不等待服务端）：
 * - 单位 `type: "transport_robot"`，JSON 带
 *   `haul: {from_building_id, to_building_id, item_id, phase, cargo, delivered_total}`；无路线时无 haul 字段。
 * - 设置路线：`unit_order`，order `haul`，entity_ids=[机器人]，payload
 *   `{from_building_id, to_building_id, item_id?}`；`order: "stop"` 清除。
 */

import type { Unit, TransportHaul, TransportHaulPhase } from '@shared/types';

/** 单位类型 id：运输机器人（服务端 units.yaml 的 transport_robot）。 */
export const TRANSPORT_ROBOT_TYPE = 'transport_robot';

/** 阶段中文（选中条/详情面板/3D 标签共用）。 */
export const HAUL_PHASE_LABELS: Record<TransportHaulPhase, string> = {
  to_source: '前往取货',
  loading: '装货中',
  to_target: '运送中',
  unloading: '卸货中',
  waiting_source: '等待取货',
  waiting_target: '等待卸货',
};

export function haulPhaseLabel(phase: string | undefined): string {
  if (!phase) return '未设路线';
  return HAUL_PHASE_LABELS[phase as TransportHaulPhase] ?? '未设路线';
}

/** 是否为运输机器人（含未设路线的情况：type 判定，不依赖 haul 字段）。 */
export function isTransportRobot(unit: Pick<Unit, 'type'> | undefined | null): boolean {
  return unit?.type === TRANSPORT_ROBOT_TYPE;
}

/** 单位的往返路线（无 haul 字段 = 未设路线）。 */
export function transportHaulRoute(unit: Unit | undefined | null): TransportHaul | null {
  if (!unit || !isTransportRobot(unit) || !unit.haul) return null;
  const { from_building_id: from, to_building_id: to } = unit.haul;
  if (!from || !to) return null;
  return unit.haul;
}

/**
 * 车顶货物：**载货期间**（装货/运送/卸货）都要看得见，无货（未设路线 / 空车返程）时为 null。
 *
 * 卸货阶段服务端每 tick 把已卸的量从 cargo 里扣掉，卸完即清空 `cargo`（车上确实没货了），
 * 但玩家眼里这一趟还没结束、车顶的货还在往下卸——所以 quantity ≤ 0 时按 `item_id` 兜底显示 1 件，
 * 颜色与运送中的货物一致，直到货物真的交给终点、机器人掉头回起点为止。
 * `waiting_target`（终点收不下，货留在车上）服务端本来就保留 cargo，走正常分支。
 */
export function transportCargo(unit: Unit | undefined | null) {
  const route = transportHaulRoute(unit);
  if (!route) return null;
  const cargo = route.cargo;
  if (cargo?.item_id && (cargo.quantity ?? 0) > 0) return cargo;
  const delivering = route.phase === 'unloading' || route.phase === 'waiting_target';
  if (delivering && route.item_id) return { item_id: route.item_id, quantity: 1 };
  return null;
}

/** 选中条的一句话摘要：「前往取货 · 已送达 12 · 铁块 ×4」。 */
export function describeHaul(unit: Unit | undefined | null, label: (itemId: string) => string): string | null {
  const route = transportHaulRoute(unit);
  if (!route) return null;
  const parts = [haulPhaseLabel(route.phase), `已送达 ${route.delivered_total ?? 0}`];
  const cargo = route.cargo;
  // 卸货阶段服务端已把货从 cargo 扣空：摘要不写「载 ×1」（那是渲染用的兜底），
  // 只在车上真的有货时写载量。
  if (cargo?.item_id && (cargo.quantity ?? 0) > 0) parts.push(`载 ${label(cargo.item_id)} ×${cargo.quantity}`);
  else if (route.item_id) parts.push(`运送 ${label(route.item_id)}`);
  return parts.join(' · ');
}

/** 「设置运输」命令载荷：确认前必须两端都选好。 */
export interface HaulRouteDraft {
  fromBuildingId: string;
  toBuildingId: string;
  itemId?: string;
}

export function haulRouteReady(draft: Partial<HaulRouteDraft> | null | undefined): draft is HaulRouteDraft {
  return Boolean(draft?.fromBuildingId && draft?.toBuildingId);
}

/** 多选机器人能否一次设同一路线（至少一台运输机器人且两端已选）。 */
export function canSetHaul(units: readonly (Unit | undefined)[], draft: Partial<HaulRouteDraft> | null | undefined) {
  return units.some((unit) => isTransportRobot(unit)) && haulRouteReady(draft);
}
