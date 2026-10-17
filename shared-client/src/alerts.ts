/**
 * 产线告警（`production_alert`）的类型口径与中文文案。
 *
 * 服务端 `server/internal/model/production_monitor.go` 是唯一事实源：
 * 告警类型一律 snake_case 枚举，玩家界面与 CLI 都不能把它裸显出来。
 * 本模块给出「枚举 → 中文标签」与「一条告警 → 单行中文文案」，
 * 供 CLI（alert_snapshot / briefing）与 Web（警报条 / toast）共用，
 * 免得两边各写一份标签又互相漂移。
 */

import type { AlertEntry } from './types.js';

/**
 * 服务端产线告警类型（与 `model.ProductionAlertType` 一一对应）。
 * `power_low` 是旧存档/旧服留下的欠压类型，仍要能显示。
 */
export type ProductionAlertType =
  | 'throughput_drop'
  | 'backlog'
  | 'input_shortage'
  | 'output_blocked'
  | 'power_shortage'
  | 'power_low'
  | 'unit_spawn_blocked'
  | 'belt_blocked'
  | 'haul_unreachable'
  | 'sorter_stalled';

export const PRODUCTION_ALERT_TYPES: readonly ProductionAlertType[] = [
  'throughput_drop',
  'backlog',
  'input_shortage',
  'output_blocked',
  'power_shortage',
  'power_low',
  'unit_spawn_blocked',
  'belt_blocked',
  'haul_unreachable',
  'sorter_stalled',
];

/** 服务端遭遇战预设的 tick 速率（config-skirmish.yaml max_tick_rate）。 */
export const DEFAULT_TICKS_PER_SECOND = 10;

/** 告警类型 → 中文短标签。键与服务端枚举一一对应（client-web 词典按此对齐）。 */
export const ALERT_TYPE_LABELS: Record<ProductionAlertType, string> = {
  throughput_drop: '产能下降',
  backlog: '堆积升高',
  input_shortage: '原料短缺',
  output_blocked: '产物阻塞',
  power_shortage: '电力不足',
  power_low: '电力不足',
  unit_spawn_blocked: '出厂口被占满',
  belt_blocked: '传送带堵塞',
  haul_unreachable: '运输机器人到不了目标',
  sorter_stalled: '分拣器停工',
};

/** 未知类型的兜底文案：绝不把 snake_case 枚举写进界面。 */
export const UNKNOWN_ALERT_LABEL = '产线告警';

export function isProductionAlertType(value: string | undefined | null): value is ProductionAlertType {
  return Boolean(value && value in ALERT_TYPE_LABELS);
}

/** 告警类型 → 中文短标签（未知回退「产线告警」）。 */
export function alertTypeLabel(alertType: string | undefined | null): string {
  if (!isProductionAlertType(alertType)) {
    return UNKNOWN_ALERT_LABEL;
  }
  return ALERT_TYPE_LABELS[alertType];
}

export interface AlertTilePosition {
  x: number;
  y: number;
}

/**
 * 告警现在是否仍然成立。服务端快照里已解除的告警会留在历史中并标 `active: false`
 * （第 16 轮契约）；缺省视为成立（兼容旧服务端 / 旧存档）。
 */
export function isAlertActive(alert: Pick<AlertEntry, 'active'>): boolean {
  return alert.active !== false;
}

/** 只保留仍然成立的告警（警报条 / 地图红标 / toast 的统一口径）。 */
export function activeAlerts<T extends Pick<AlertEntry, 'active'>>(alerts: readonly T[] | undefined): T[] {
  return (alerts ?? []).filter(isAlertActive);
}

/**
 * 告警的「最近一次发生」tick：聚合告警用 `last_tick`（缺省回退 `tick`）。
 * 排序用它，避免一条老告警被反复提醒时仍排在旧位置。
 */
export function alertLastTick(alert: Pick<AlertEntry, 'tick' | 'last_tick'>): number {
  return typeof alert.last_tick === 'number' && Number.isFinite(alert.last_tick)
    ? Math.max(alert.tick, alert.last_tick)
    : alert.tick;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 告警 `details` 里的位置：`details.position`（服务端 `model.Position`）或 `details.{x,y}`。
 * 没有就返回 null——绝不编造坐标（只有部分告警类型带位置，如 `belt_blocked`）。
 */
export function alertDetailsPosition(
  details: Record<string, unknown> | undefined | null,
): AlertTilePosition | null {
  if (!details) {
    return null;
  }
  const nested = details.position;
  const source = (typeof nested === 'object' && nested !== null ? nested : details) as Record<string, unknown>;
  const x = asFiniteNumber(source.x);
  const y = asFiniteNumber(source.y);
  if (x === undefined || y === undefined) {
    return null;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

/** 把 tick 数换算成秒（速率缺失时按服务端预设 10 tps）。 */
export function ticksToSeconds(ticks: number, tickRate: number = DEFAULT_TICKS_PER_SECOND): number {
  const rate = tickRate > 0 ? tickRate : DEFAULT_TICKS_PER_SECOND;
  return Math.round(ticks / rate);
}

/**
 * 传送带堵塞的细节段：`(12, 7)：5 件货 30 秒没动`（没有 details 时返回空串）。
 *
 * `details` 带 `position` / `queued_items` / `blocked_ticks`（服务端
 * `settleBeltBlockAlerts`）；缺哪项就少写哪段，不写占位符也不编数字。
 * toast 用它拼「建筑名 + 细节」，警报条与 CLI 用整句（见 `beltBlockedText`）。
 */
export function beltBlockedDetail(
  alert: Pick<AlertEntry, 'alert_type' | 'details'>,
  tickRate: number = DEFAULT_TICKS_PER_SECOND,
): string {
  const details = alert.details ?? {};
  const position = alertDetailsPosition(details);
  const queued = asFiniteNumber(details.queued_items);
  const blockedTicks = asFiniteNumber(details.blocked_ticks);

  const movementParts: string[] = [];
  if (queued !== undefined && queued > 0) {
    movementParts.push(`${Math.round(queued)} 件货`);
  }
  if (blockedTicks !== undefined && blockedTicks > 0) {
    movementParts.push(`${ticksToSeconds(blockedTicks, tickRate)} 秒没动`);
  }

  const where = position ? `(${position.x}, ${position.y})` : '';
  const movement = movementParts.join(' ');
  if (where && movement) {
    return `${where}：${movement}`;
  }
  return where || movement;
}

/**
 * 传送带堵塞的整句文案：`传送带堵塞 (12, 7)：5 件货 30 秒没动`。
 */
export function beltBlockedText(
  alert: Pick<AlertEntry, 'alert_type' | 'details'>,
  tickRate: number = DEFAULT_TICKS_PER_SECOND,
): string {
  const label = alertTypeLabel(alert.alert_type);
  const details = alert.details ?? {};
  const position = alertDetailsPosition(details);
  const queued = asFiniteNumber(details.queued_items);
  const blockedTicks = asFiniteNumber(details.blocked_ticks);

  const movementParts: string[] = [];
  if (queued !== undefined && queued > 0) {
    movementParts.push(`${Math.round(queued)} 件货`);
  }
  if (blockedTicks !== undefined && blockedTicks > 0) {
    movementParts.push(`${ticksToSeconds(blockedTicks, tickRate)} 秒没动`);
  }

  const where = position ? ` (${position.x}, ${position.y})` : '';
  const movement = movementParts.join(' ');
  return movement ? `${label}${where}：${movement}` : `${label}${where}`;
}

/**
 * 运输机器人到不了目标（`haul_unreachable`，第 16 轮契约）的细节段：
 * `机器人 u-184 → 电弧熔炉 (61, 135)`。details 带 `unit_id` / `building_id` / `position`；
 * 缺哪项就少写哪段，不写占位符也不编数字。
 */
export function haulUnreachableDetail(
  alert: Pick<AlertEntry, 'details'>,
  buildingName?: (buildingId: string) => string | undefined,
): string {
  const details = alert.details ?? {};
  const unitId = typeof details.unit_id === 'string' ? details.unit_id : '';
  const buildingId = typeof details.building_id === 'string' ? details.building_id : '';
  const position = alertDetailsPosition(details);
  const target = buildingId
    ? `${buildingName?.(buildingId) ?? buildingId}${position ? ` (${position.x}, ${position.y})` : ''}`
    : position ? `(${position.x}, ${position.y})` : '';
  const parts: string[] = [];
  if (unitId) parts.push(`机器人 ${unitId}`);
  if (target) parts.push(`→ ${target}`);
  return parts.join(' ');
}

/**
 * 运输机器人到不了目标的整句文案：`运输机器人到不了目标 机器人 u-184 → 电弧熔炉 (61, 135)`。
 */
export function haulUnreachableText(
  alert: Pick<AlertEntry, 'alert_type' | 'details'>,
  buildingName?: (buildingId: string) => string | undefined,
): string {
  const detail = haulUnreachableDetail(alert, buildingName);
  const label = alertTypeLabel(alert.alert_type);
  return detail ? `${label} ${detail}` : label;
}

/** `sorter_stalled` 的 reason 枚举 → 中文说明（服务端 `sorter_stall_alert.go`）。 */
export const SORTER_STALL_REASON_LABELS: Record<string, string> = {
  no_power: '分拣器断电',
  paused: '分拣器已暂停',
  pick_empty: '取货端没有它认的货',
  drop_blocked: '放货端收不下',
};

/** `sorter_stalled` 的 reason → 中文（未知 reason 返回空串，不裸显枚举）。 */
export function sorterStallReasonLabel(reason: unknown): string {
  return typeof reason === 'string' ? SORTER_STALL_REASON_LABELS[reason] ?? '' : '';
}

/**
 * 分拣器停工的细节段：`分拣器断电 → 电弧熔炉 (61, 135)`。
 * details 带 `reason` / `building_id` / `position`；缺哪项就少写哪段。
 */
export function sorterStalledDetail(
  alert: Pick<AlertEntry, 'details'>,
  buildingName?: (buildingId: string) => string | undefined,
): string {
  const details = alert.details ?? {};
  const reason = sorterStallReasonLabel(details.reason);
  const buildingId = typeof details.building_id === 'string' ? details.building_id : '';
  const position = alertDetailsPosition(details);
  const target = buildingId
    ? `${buildingName?.(buildingId) ?? buildingId}${position ? ` (${position.x}, ${position.y})` : ''}`
    : position ? `(${position.x}, ${position.y})` : '';
  const parts: string[] = [];
  if (reason) parts.push(reason);
  if (target) parts.push(`→ ${target}`);
  return parts.join(' ');
}

/** 分拣器停工的整句文案：`分拣器停工 分拣器断电 → 电弧熔炉 (61, 135)`。 */
export function sorterStalledText(
  alert: Pick<AlertEntry, 'alert_type' | 'details'>,
  buildingName?: (buildingId: string) => string | undefined,
): string {
  const detail = sorterStalledDetail(alert, buildingName);
  const label = alertTypeLabel(alert.alert_type);
  return detail ? `${label} ${detail}` : label;
}

/**
 * 一条告警的单行中文文案（CLI 与 toast 共用）。
 * 传送带堵塞带位置/件数/时长；运输机器人到不了目标带机器人/建筑/坐标；其余类型只给中文标签。
 */
export function formatAlertText(
  alert: Pick<AlertEntry, 'alert_type' | 'details' | 'message'>,
  tickRate: number = DEFAULT_TICKS_PER_SECOND,
): string {
  if (alert.alert_type === 'belt_blocked') {
    return beltBlockedText(alert, tickRate);
  }
  if (alert.alert_type === 'haul_unreachable') {
    return haulUnreachableText(alert);
  }
  if (alert.alert_type === 'sorter_stalled') {
    return sorterStalledText(alert);
  }
  return alertTypeLabel(alert.alert_type);
}
