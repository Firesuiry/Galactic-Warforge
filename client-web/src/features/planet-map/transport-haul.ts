/**
 * 运输机器人（transport_robot）的纯逻辑：模式/阶段文案、路线解析、命令载荷。
 *
 * 契约（服务端 §2.1 实现，前端按此渲染）：
 * - 单位 `type: "transport_robot"`，JSON 带
 *   `haul: {mode, from_building_id, to_building_id, item_id, phase, cargo, delivered_total, claim?}`。
 * - 模式：`auto`（全局自动，出厂默认）、`route`（固定路线）、`idle`（停止待命）。
 * - 切模式：`unit_order`，order `haul`（→route，payload `{from_building_id, to_building_id, item_id?}`）、
 *   order `auto_haul`（→auto，无参数）、order `stop`（→idle）。
 * - 自动模式的任务（from/to）由服务端派单写入：from = 取货建筑、to = 送货建筑；
 *   车上带货改派时 from 为空（货已在车上）。
 */

import type { Unit, TransportHaul, TransportHaulMode, TransportHaulPhase } from '@shared/types';

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
  idle: '自动待命',
};

/** 模式中文（选中条按钮与胶囊共用）。 */
export const HAUL_MODE_LABELS: Record<TransportHaulMode, string> = {
  auto: '自动搬运',
  route: '固定路线',
  idle: '已停止',
};

export function haulPhaseLabel(phase: string | undefined): string {
  if (!phase) return '自动待命';
  return HAUL_PHASE_LABELS[phase as TransportHaulPhase] ?? '自动待命';
}

/** 是否为运输机器人（含未设路线的情况：type 判定，不依赖 haul 字段）。 */
export function isTransportRobot(unit: Pick<Unit, 'type'> | undefined | null): boolean {
  return unit?.type === TRANSPORT_ROBOT_TYPE;
}

/** 运输机器人的模式；没有 haul 字段的旧快照按 auto（出厂默认）处理。 */
export function transportHaulMode(unit: Unit | undefined | null): TransportHaulMode | null {
  if (!isTransportRobot(unit)) return null;
  return unit?.haul?.mode ?? 'auto';
}

/**
 * 当前任务（两端齐全才算有效）。
 * 自动模式下 from 允许为空（车上带货改派），此时仍算有任务（只有 to）。
 */
export function transportHaulTask(unit: Unit | undefined | null): TransportHaul | null {
  if (!unit || !isTransportRobot(unit) || !unit.haul) return null;
  if (!unit.haul.to_building_id) return null;
  return unit.haul;
}

/**
 * 固定路线（§2「设置运输」画线用）：route 模式且两端齐全。
 * 自动模式的任务画线走 transportHaulTask。
 */
export function transportHaulRoute(unit: Unit | undefined | null): TransportHaul | null {
  const task = transportHaulTask(unit);
  if (!task) return null;
  if (transportHaulMode(unit) !== 'route') return null;
  if (!task.from_building_id) return null;
  return task;
}

/**
 * 车顶货物：**载货期间**（装货/运送/卸货）都要看得见，无货（无任务 / 空车返程）时为 null。
 *
 * 卸货阶段服务端每 tick 把已卸的量从 cargo 里扣掉，卸完即清空 `cargo`（车上确实没货了），
 * 但玩家眼里这一趟还没结束、车顶的货还在往下卸——所以 quantity ≤ 0 时按 `item_id` 兜底显示 1 件，
 * 颜色与运送中的货物一致，直到货物真的交给终点、机器人掉头回起点为止。
 * `waiting_target`（终点收不下，货留在车上）服务端本来就保留 cargo，走正常分支。
 */
export function transportCargo(unit: Unit | undefined | null) {
  const task = transportHaulTask(unit);
  if (!task) return null;
  const cargo = task.cargo;
  if (cargo?.item_id && (cargo.quantity ?? 0) > 0) return cargo;
  const delivering = task.phase === 'unloading' || task.phase === 'waiting_target';
  if (delivering && task.item_id) return { item_id: task.item_id, quantity: 1 };
  return null;
}

/**
 * 自动模式空闲时的一句话状态（服务端 `haul.idle_reason` / `idle_detail`）：
 * - 车上有货：`带着 4 铁矿 待命：没有可送的地方`
 * - 上一单中止：`上一单中止：<原因>`
 * - 有需求但都到不了：`自动待命：缺料建筑都到不了`
 * - 无需求：`自动待命：没有缺料的建筑`
 * 没有 idle_reason（旧快照 / 有任务）时返回 null，由调用方回落到「自动待命」。
 */
export function describeHaulIdle(
  unit: Unit | undefined | null,
  label: (itemId: string) => string,
): string | null {
  if (!isTransportRobot(unit)) return null;
  const haul = unit?.haul;
  if (!haul || haul.mode !== 'auto' || haul.to_building_id) return null;
  const reason = haul.idle_reason;
  if (!reason) return null;
  const cargo = haul.cargo;
  if (reason === 'cargo_no_destination') {
    const item = cargo?.item_id ? label(cargo.item_id) : '货';
    const quantity = cargo?.quantity ?? 0;
    return quantity > 0
      ? `带着 ${quantity} ${item} 待命：没有可送的地方`
      : `带着${item}待命：没有可送的地方`;
  }
  if (reason === 'last_aborted') {
    const detail = haul.idle_detail?.trim();
    return detail ? `上一单中止：${detail}` : '上一单中止';
  }
  if (reason === 'no_reachable_demand') return '自动待命：缺料建筑都到不了';
  return '自动待命：没有缺料的建筑';
}

/**
 * 选中条/详情/悬停的一句话摘要。
 * - route：「运送中 · 已送达 12 · 载 铁块 ×4」
 * - auto 有任务：「自动：送 铁矿 → 电弧熔炉」（缺建筑名时「自动：送 铁矿」）
 * - auto 无任务：「自动待命」；有 idle_reason 时写明原因（见 describeHaulIdle）
 * - idle：「已停止（点「自动搬运」恢复）」
 * buildingName 用于把建筑 id 翻成中文名（自动模式的胶囊/摘要共用）。
 */
export function describeHaul(
  unit: Unit | undefined | null,
  label: (itemId: string) => string,
  buildingName?: (buildingId: string) => string | undefined,
): string | null {
  if (!isTransportRobot(unit)) return null;
  const mode = transportHaulMode(unit);
  if (mode === 'idle') return '已停止（点「自动搬运」恢复）';
  if (mode === 'auto') return describeHaulIdle(unit, label) ?? describeAutoHaul(unit, label, buildingName);
  const route = transportHaulRoute(unit);
  if (!route) return '未设路线（选中条「设置运输」）';
  const parts = [haulPhaseLabel(route.phase), `已送达 ${route.delivered_total ?? 0}`];
  const cargo = route.cargo;
  // 卸货阶段服务端已把货从 cargo 扣空：摘要不写「载 ×1」（那是渲染用的兜底），
  // 只在车上真的有货时写载量。
  if (cargo?.item_id && (cargo.quantity ?? 0) > 0) parts.push(`载 ${label(cargo.item_id)} ×${cargo.quantity}`);
  else if (route.item_id) parts.push(`运送 ${label(route.item_id)}`);
  return parts.join(' · ');
}

/**
 * 自动模式的摘要与胶囊文案：「自动：送 铁矿 → 电弧熔炉」（无任务时「自动待命」）。
 * buildings 用于把建筑 id 翻成中文名；缺失时退化成「自动：送 铁矿」。
 */
export function describeAutoHaul(
  unit: Unit | undefined | null,
  label: (itemId: string) => string,
  buildingName?: (buildingId: string) => string | undefined,
): string {
  const task = transportHaulTask(unit);
  if (!task) return '自动待命';
  const item = task.item_id ? label(task.item_id) : '物料';
  const target = buildingName?.(task.to_building_id);
  if (!target) return `自动：送 ${item}`;
  return `自动：送 ${item} → ${target}`;
}

/** 自动模式是否有进行中的任务（用于胶囊/画线）。 */
export function autoHaulActive(unit: Unit | undefined | null): boolean {
  return transportHaulMode(unit) === 'auto' && transportHaulTask(unit) !== null;
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

/** 多选里是否至少有一台运输机器人（「自动搬运」按钮的显示条件）。 */
export function hasTransportRobot(units: readonly (Unit | undefined)[]): boolean {
  return units.some((unit) => isTransportRobot(unit));
}

/** 多选里是否全都在自动模式（按钮高亮条件）。 */
export function allAutoHaul(units: readonly (Unit | undefined)[]): boolean {
  const robots = units.filter((unit) => isTransportRobot(unit));
  return robots.length > 0 && robots.every((unit) => transportHaulMode(unit) === 'auto');
}
