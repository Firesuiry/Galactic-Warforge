/**
 * 警报条（§3.3）：顶栏下方居中的窄条。
 *
 * 收起态：只显示最新一条（图标 · 类型 · 建筑 · tick）+ 总数徽标 + 展开箭头。
 * 展开态：下拉列表，最多 8 条（可滚动），按「建筑 + 类型」合并计数，点击聚焦对应目标。
 * 无警报时整条不渲染（返回 null），不给地图让出任何高度。
 *
 * 数据源：useShellAlerts（与顶栏共用 query key/limit，研究站噪音已过滤）。
 * 聚焦：行星页内直接选中并移镜头（复用 store 动作）；其他页面带 select 深链跳到活跃行星。
 * 传送带堵塞（`belt_blocked`）指向**带格**：条目上直接写「(12, 7)：5 件货 30 秒没动」，
 * 点击把镜头移到那一格并选中它——地图上另有红杠标记（PlanetBeltBlockedLayer）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, TriangleAlert } from 'lucide-react';

import { alertDetailsPosition, alertLastTick, DEFAULT_TICKS_PER_SECOND, formatAlertText, haulUnreachableText, isAlertActive, sorterStalledText } from '@shared/alerts';
import type { AlertEntry, CatalogView } from '@shared/types';

import { sfx } from '@/engine/audio';
import { useCurrentGameQuery } from '@/features/lobby/use-current-game';
import { getBuildingDisplayName } from '@/features/planet-map/model';
import { usePlanetViewStore } from '@/features/planet-map/store';
import { useShellAlerts } from '@/features/production-alerts-query';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { translateAlertType, translateSeverity } from '@/i18n/translate';

/** 展开列表最多显示的条目（合并计数后）。 */
const MAX_VISIBLE = 8;

interface AlertRow {
  key: string;
  buildingId: string;
  buildingType: string;
  alertType: string;
  severity: string;
  count: number;
  tick: number;
  message: string;
  details: Record<string, unknown>;
}

/**
 * 按「建筑 + 类型」合并计数，取每组最新一条的 tick/message；
 * 组序 = 最新 tick 倒序：玩家先看到最近发生的事。
 * 已解除的告警（`active: false`）不进来；聚合告警用 `last_tick` 排序，
 * 这样持续被提醒的老告警不会永远压在列表底部、也不会反过来挤掉新告警。
 */
export function mergeAlertRows(alerts: readonly AlertEntry[]): AlertRow[] {
  const byKey = new Map<string, AlertRow>();
  for (const alert of alerts) {
    if (!isAlertActive(alert)) continue;
    const key = `${alert.building_id}::${alert.alert_type}`;
    const tick = alertLastTick(alert);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        key,
        buildingId: alert.building_id,
        buildingType: alert.building_type,
        alertType: alert.alert_type,
        severity: alert.severity,
        count: 1,
        tick,
        message: alert.message,
        details: alert.details ?? {},
      });
      continue;
    }
    existing.count += 1;
    if (tick > existing.tick) {
      existing.tick = tick;
      existing.message = alert.message;
      existing.severity = alert.severity;
      existing.details = alert.details ?? {};
    }
  }
  return [...byKey.values()].sort((a, b) => b.tick - a.tick);
}

/** 严重度 → 视觉档位（沿用既有 info/warning/danger 三档色条）。 */
function severityClass(severity: string): string {
  switch (severity) {
    case 'critical':
    case 'error':
      return 'danger';
    case 'info':
      return 'info';
    default:
      return 'warning';
  }
}

/** 建筑显示名：目录里有中文名就用它，否则回退建筑 id。 */
function buildingLabel(catalog: CatalogView | undefined, row: AlertRow): string {
  return getBuildingDisplayName(catalog, row.buildingType) || row.buildingId;
}

/** `haul_unreachable` 的目标建筑 id（details.building_id）。 */
function haulTargetId(row: AlertRow): string {
  return typeof row.details.building_id === 'string' ? row.details.building_id : '';
}

/**
 * 行首「建筑」列：`haul_unreachable` 讲的是机器人到不了**目标建筑**，
 * 建筑列应显示目标建筑（含 id 短标）。服务端契约（auto_haul_unreachable.go）：
 * 告警的 building_id / building_type 就是目标建筑，details 只带 unit_id/building_id/position。
 */
function rowBuildingLabel(catalog: CatalogView | undefined, row: AlertRow): string {
  if (row.alertType === 'haul_unreachable') {
    const type = row.buildingType || haulTargetId(row);
    return type ? getBuildingDisplayName(catalog, type) : haulTargetId(row);
  }
  return buildingLabel(catalog, row);
}

/** 行首建筑短标：`haul_unreachable` 用目标建筑 id。 */
function rowBuildingTag(row: AlertRow): string {
  return (row.alertType === 'haul_unreachable' && haulTargetId(row)) || row.buildingId;
}

/**
 * 告警条目的说明文案：传送带堵塞给出中文的位置/件数/时长
 * （服务端 message 只写「建筑 b-9：传送带被堵，物品运不出去」，定位不到格子），
 * 运输机器人到不了目标给出机器人/目标建筑/坐标，分拣器停工给出原因/目标建筑/坐标；
 * 其余类型只给中文标签。
 */
function alertRowDetail(row: AlertRow, tickRate: number, catalog?: CatalogView): string {
  if (row.alertType === 'haul_unreachable') {
    // 服务端把告警挂到到不了的建筑上（building_id/building_type 都是它），
    // 告警自身的 building_type 就是目标建筑类型。
    return haulUnreachableText(
      { alert_type: row.alertType, details: row.details },
      () => (row.buildingType ? getBuildingDisplayName(catalog, row.buildingType) : undefined),
    );
  }
  if (row.alertType === 'sorter_stalled') {
    // 告警挂在分拣器上，details.building_id 才是被喂料的目标机器；
    // 目标建筑类型在 details.target_type（服务端 sorter_stall_alert.go）。
    const targetType = typeof row.details.target_type === 'string' ? row.details.target_type : '';
    return sorterStalledText(
      { alert_type: row.alertType, details: row.details },
      () => (targetType ? getBuildingDisplayName(catalog, targetType) : undefined),
    );
  }
  return formatAlertText(
    { alert_type: row.alertType, details: row.details, message: row.message },
    tickRate,
  );
}

/** 条目 title：中文标签 + 细节（belt_blocked / haul_unreachable / sorter_stalled 用 details，其余用服务端 message）。 */
function alertRowTitle(row: AlertRow, tickRate: number, catalog?: CatalogView): string {
  if (row.alertType === 'belt_blocked' || row.alertType === 'haul_unreachable' || row.alertType === 'sorter_stalled') {
    return alertRowDetail(row, tickRate, catalog);
  }
  return `${translateAlertType(row.alertType, row.message)}：${row.message}`;
}

export function AlertBar() {
  const client = useApiClient();
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSessionSnapshot();
  const { alerts } = useShellAlerts();
  // 「30 秒没动」这类时长按服务端实际 tick 速率换算（服务端可调速）。
  const tickRate = useCurrentGameQuery().data?.max_tick_rate ?? DEFAULT_TICKS_PER_SECOND;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const hasAlerts = alerts.length > 0;
  const catalogQuery = useQuery({
    queryKey: ['catalog', session.serverUrl, session.playerId],
    queryFn: () => client.fetchCatalog(),
    enabled: Boolean(session.playerId) && hasAlerts,
    staleTime: 5 * 60 * 1000,
  });
  const summaryQuery = useQuery({
    queryKey: ['shell-summary', session.serverUrl, session.playerId],
    queryFn: () => client.fetchSummary(),
    enabled: Boolean(session.playerId) && hasAlerts,
    refetchInterval: 5000,
  });

  // 点开外面关掉下拉（与顶栏设置弹层同一模式）。
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // 换会话时收起：避免上一次的展开态跨对局残留。
  useEffect(() => {
    setOpen(false);
  }, [session.playerId, session.serverUrl]);

  const rows = useMemo(() => mergeAlertRows(alerts), [alerts]);
  // 只剩已解除的历史告警时整条不渲染（旧告警不该占着顶栏）。
  if (rows.length === 0) {
    return null;
  }

  const latest = rows[0];

  /**
   * 聚焦到告警目标：
   * - `belt_blocked` 指向**带格本身**（details.position），行星页内直接移镜头到该格
   *   并选中它（与其他带位置的告警同一口径；带格选中会带出该格的详情）；
   * - `haul_unreachable` 指向**目标建筑**（details.building_id），并带上坐标：
   *   运输机器人到不了它，玩家要看的正是这座建筑的位置；
   * - `sorter_stalled` 指向**分拣器本身**（告警的 building_id），坐标用
   *   details.position（分拣器自己的位置）；details.target_position 是目标机器，
   *   不能拿来当分拣器的坐标；
   * - 其余告警指向建筑：行星页内选中它（服务端告警通常不带坐标，这里不编造位置）；
   * - 不在行星页时带深链跳到活跃行星（带位置的告警额外带 x/y 直接聚焦）。
   */
  function focusAlert(row: AlertRow) {
    sfx.uiClick();
    setOpen(false);
    const tile = alertDetailsPosition(row.details);
    const haulTarget = row.alertType === 'haul_unreachable'
      ? (typeof row.details.building_id === 'string' ? row.details.building_id : '')
      : '';
    const targetBuildingId = haulTarget || row.buildingId;
    const onPlanet = location.pathname.startsWith('/planet/');
    if (onPlanet) {
      const planet = usePlanetViewStore.getState();
      if (row.alertType === 'belt_blocked' && tile) {
        planet.setSelected({ kind: 'tile', position: { ...tile, z: 0 } });
        planet.requestFocus(tile);
        return;
      }
      planet.setSelected({
        kind: 'building',
        id: targetBuildingId,
        position: tile
          ? { ...tile, z: 0 }
          : planet.homeTile ? { ...planet.homeTile, z: 0 } : { x: 0, y: 0, z: 0 },
      });
      if (tile) {
        planet.requestFocus(tile);
      }
      return;
    }
    const activePlanetId = summaryQuery.data?.active_planet_id;
    if (!activePlanetId) {
      return;
    }
    // 带位置的告警（belt_blocked / haul_unreachable）带 x/y 直接聚焦；其余只带 select。
    const positionQuery = tile ? `&x=${tile.x}&y=${tile.y}` : '';
    navigate(`/planet/${activePlanetId}?select=building:${targetBuildingId}${positionQuery}`);
  }

  return (
    <div className="alert-bar" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label="产线警报"
        className={`alert-bar__summary alert-bar__summary--${severityClass(latest.severity)}`}
        onClick={() => {
          sfx.uiClick();
          setOpen((value) => !value);
        }}
        title={alertRowTitle(latest, tickRate, catalogQuery.data)}
        type="button"
      >
        <TriangleAlert aria-hidden="true" size={14} strokeWidth={2} />
        <span className="alert-bar__type">
          {translateAlertType(latest.alertType, translateSeverity(latest.severity))}
        </span>
        <span className="alert-bar__building">{rowBuildingLabel(catalogQuery.data, latest)}</span>
        <span className="alert-bar__tick">t{latest.tick}</span>
        <span className="alert-bar__count">{alerts.length}</span>
        {open ? (
          <ChevronUp aria-hidden="true" size={14} strokeWidth={2} />
        ) : (
          <ChevronDown aria-hidden="true" size={14} strokeWidth={2} />
        )}
      </button>
      {open ? (
        <ul className="alert-bar__list" data-testid="alert-bar-list">
          {rows.slice(0, MAX_VISIBLE).map((row) => (
            <li key={row.key}>
              <button
                className={`alert-bar__row alert-bar__row--${severityClass(row.severity)}`}
                onClick={() => focusAlert(row)}
                title={alertRowTitle(row, tickRate, catalogQuery.data)}
                type="button"
              >
                <TriangleAlert aria-hidden="true" size={13} strokeWidth={2} />
                <span className="alert-bar__row-type">
                  {translateAlertType(row.alertType, translateSeverity(row.severity))}
                </span>
                {/* 建筑名 + 短标（id 尾号）：同名建筑（多台风机/制造台）靠短标区分，
                    点条目聚焦的是哪一台必须一眼可辨。 */}
                <span className="alert-bar__row-building">
                  {rowBuildingLabel(catalogQuery.data, row)}
                  <span className="alert-bar__row-tag">{rowBuildingTag(row)}</span>
                </span>
                {/* 传送带堵塞指向带格本身、运输机器人到不了目标指向目标建筑：
                    把位置/件数/时长（或机器人/建筑）写在条目上，
                    玩家不用点开地图就知道堵在哪、堵了多少。 */}
                {row.alertType === 'belt_blocked' || row.alertType === 'haul_unreachable' || row.alertType === 'sorter_stalled' ? (
                  <span className="alert-bar__row-detail">{alertRowDetail(row, tickRate, catalogQuery.data)}</span>
                ) : null}
                {row.count > 1 ? <span className="alert-bar__row-count">×{row.count}</span> : null}
                <span className="alert-bar__row-tick">t{row.tick}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
