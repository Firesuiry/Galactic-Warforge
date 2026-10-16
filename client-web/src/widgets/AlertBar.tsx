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

import { alertDetailsPosition, DEFAULT_TICKS_PER_SECOND, formatAlertText } from '@shared/alerts';
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
 */
export function mergeAlertRows(alerts: readonly AlertEntry[]): AlertRow[] {
  const byKey = new Map<string, AlertRow>();
  for (const alert of alerts) {
    const key = `${alert.building_id}::${alert.alert_type}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        key,
        buildingId: alert.building_id,
        buildingType: alert.building_type,
        alertType: alert.alert_type,
        severity: alert.severity,
        count: 1,
        tick: alert.tick,
        message: alert.message,
        details: alert.details ?? {},
      });
      continue;
    }
    existing.count += 1;
    if (alert.tick > existing.tick) {
      existing.tick = alert.tick;
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

/**
 * 建筑短标：完整 id（b-33）能区分同名的多台建筑，比只写「采矿机」有用。
 * 已按 id 命名（目录缺失）时不重复显示。
 */
function buildingTag(row: AlertRow): string {
  return row.buildingId;
}

/**
 * 告警条目的说明文案：传送带堵塞给出中文的位置/件数/时长
 * （服务端 message 只写「建筑 b-9：传送带被堵，物品运不出去」，定位不到格子），
 * 其余类型沿用服务端 message。
 */
function alertRowDetail(row: AlertRow, tickRate: number): string {
  return formatAlertText(
    { alert_type: row.alertType, details: row.details, message: row.message },
    tickRate,
  );
}

/** 条目 title：中文标签 + 细节（belt_blocked 用位置/件数/时长，其余用服务端 message）。 */
function alertRowTitle(row: AlertRow, tickRate: number): string {
  if (row.alertType === 'belt_blocked') {
    return alertRowDetail(row, tickRate);
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
  if (alerts.length === 0) {
    return null;
  }

  const latest = rows[0];

  /**
   * 聚焦到告警目标：
   * - `belt_blocked` 指向**带格本身**（details.position），行星页内直接移镜头到该格
   *   并选中它（与其他带位置的告警同一口径；带格选中会带出该格的详情）；
   * - 其余告警指向建筑：行星页内选中它（服务端告警通常不带坐标，这里不编造位置）；
   * - 不在行星页时带深链跳到活跃行星（带位置的告警额外带 x/y 直接聚焦）。
   */
  function focusAlert(row: AlertRow) {
    sfx.uiClick();
    setOpen(false);
    const tile = alertDetailsPosition(row.details);
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
        id: row.buildingId,
        position: planet.homeTile ? { ...planet.homeTile, z: 0 } : { x: 0, y: 0, z: 0 },
      });
      return;
    }
    const activePlanetId = summaryQuery.data?.active_planet_id;
    if (!activePlanetId) {
      return;
    }
    // 带位置的告警（当前只有 belt_blocked）带 x/y 直接聚焦；其余只带 select。
    const positionQuery = tile ? `&x=${tile.x}&y=${tile.y}` : '';
    navigate(`/planet/${activePlanetId}?select=building:${row.buildingId}${positionQuery}`);
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
        title={alertRowTitle(latest, tickRate)}
        type="button"
      >
        <TriangleAlert aria-hidden="true" size={14} strokeWidth={2} />
        <span className="alert-bar__type">
          {translateAlertType(latest.alertType, translateSeverity(latest.severity))}
        </span>
        <span className="alert-bar__building">{buildingLabel(catalogQuery.data, latest)}</span>
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
                title={alertRowTitle(row, tickRate)}
                type="button"
              >
                <TriangleAlert aria-hidden="true" size={13} strokeWidth={2} />
                <span className="alert-bar__row-type">
                  {translateAlertType(row.alertType, translateSeverity(row.severity))}
                </span>
                {/* 建筑名 + 短标（id 尾号）：同名建筑（多台风机/制造台）靠短标区分，
                    点条目聚焦的是哪一台必须一眼可辨。 */}
                <span className="alert-bar__row-building">
                  {buildingLabel(catalogQuery.data, row)}
                  <span className="alert-bar__row-tag">{buildingTag(row)}</span>
                </span>
                {/* 传送带堵塞指向带格本身：把位置/件数/时长写在条目上，
                    玩家不用点开地图就知道堵在哪、堵了多少。 */}
                {row.alertType === 'belt_blocked' ? (
                  <span className="alert-bar__row-detail">{alertRowDetail(row, tickRate)}</span>
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
