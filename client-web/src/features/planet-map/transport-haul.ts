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

/** 车顶货物（有货才画）：无 haul / 无 cargo / 数量 ≤ 0 时为 null。 */
export function transportCargo(unit: Unit | undefined | null) {
  const cargo = transportHaulRoute(unit)?.cargo;
  if (!cargo || !cargo.item_id || (cargo.quantity ?? 0) <= 0) return null;
  return cargo;
}

/** 选中条的一句话摘要：「前往取货 · 已送达 12 · 铁块 ×4」。 */
export function describeHaul(unit: Unit | undefined | null, label: (itemId: string) => string): string | null {
  const route = transportHaulRoute(unit);
  if (!route) return null;
  const parts = [haulPhaseLabel(route.phase), `已送达 ${route.delivered_total ?? 0}`];
  const cargo = transportCargo(unit);
  if (cargo) parts.push(`载 ${label(cargo.item_id)} ×${cargo.quantity}`);
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
