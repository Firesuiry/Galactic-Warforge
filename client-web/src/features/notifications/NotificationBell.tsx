/**
 * TopNav 铃铛：未读角标 + 最近 20 条历史面板。
 * 历史来源两路（互补）：
 * - 本机持久化：sessionStorage 按 serverUrl::playerId 隔离，刷新后立即回填（persistence.ts）；
 * - 服务端回填：仅最近 RESTORE_WINDOW_TICKS tick、每会话一次，补跨设备/清缓存的历史。
 * 展开/收起播 uiClick；面板外点击关闭（复用 TopNav 设置面板模式）。
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';

import { sfx } from '@/engine/audio';
import { isPowerAlertToast } from '@/features/notifications/event-toasts';
import { historyFromEvents, NOTIFICATION_EVENT_TYPES } from '@/features/notifications/notify';
import { useNotificationHistoryPersistence } from '@/features/notifications/persistence';
import { useNotificationsStore, type Toast } from '@/features/notifications/store';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';

/** 已回填过的会话（serverUrl::playerId），同一会话只回填一次。 */
const restoredSessions = new Set<string>();
/** 回填窗口：最近 3000 tick（10 tick/s 约 5 分钟）。 */
const RESTORE_WINDOW_TICKS = 3000;

function useRestoreHistory() {
  const client = useApiClient();
  const session = useSessionSnapshot();
  useEffect(() => {
    const key = `${session.serverUrl}::${session.playerId}`;
    if (!session.playerId || restoredSessions.has(key)) {
      return;
    }
    restoredSessions.add(key);
    // 快照按时间正序分页：只取最近一段（约 5 分钟）的事件，再从中挑最新的回填
    client.fetchSummary()
      .then((summary) => client.fetchEventSnapshot({
        event_types: [...NOTIFICATION_EVENT_TYPES],
        since_tick: Math.max(0, summary.tick - RESTORE_WINDOW_TICKS),
        limit: 1000,
      }))
      .then((snapshot) => {
        useNotificationsStore.getState().restoreHistory(historyFromEvents(snapshot.events ?? [], session.playerId));
      })
      .catch(() => restoredSessions.delete(key));
  }, [client, session.serverUrl, session.playerId]);
}

function formatStamp(toast: Toast): string {
  return toast.at > 0 ? formatTime(toast.at) : toast.tick !== undefined ? `t${toast.tick}` : '';
}

function formatTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 历史分组：断电类单独归到顶部，其余保持原有时间倒序。
 * 断电类判定见 event-toasts 的 isPowerAlertToast（按 mergeKey 前缀 + 告警类型）。
 */
export function groupHistoryByPower(history: readonly Toast[]): { power: Toast[]; others: Toast[] } {
  const power: Toast[] = [];
  const others: Toast[] = [];
  for (const toast of history) {
    if (isPowerAlertToast(toast)) {
      power.push(toast);
    } else {
      others.push(toast);
    }
  }
  return { power, others };
}

export function NotificationBell() {
  const navigate = useNavigate();
  const history = useNotificationsStore((state) => state.history);
  const unread = useNotificationsStore((state) => state.unread);
  const markAllRead = useNotificationsStore((state) => state.markAllRead);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // 先恢复本机持久化历史（同步），服务端回填（异步）随后到达，二者按 mergeKey 去重
  useNotificationHistoryPersistence();
  useRestoreHistory();

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function handleToggle() {
    sfx.uiClick();
    // 不在 setState 更新函数里改 store（React 会报 render 期间 setState）
    if (!open) {
      markAllRead();
    }
    setOpen(!open);
  }

  const { power: powerAlerts, others: otherAlerts } = groupHistoryByPower(history);

  function renderItem(toast: Toast) {
    return (
      <li key={toast.id}>
        <button
          className={`notification-bell__item notification-bell__item--${toast.kind}`}
          type="button"
          onClick={() => {
            if (toast.href) {
              setOpen(false);
              navigate(toast.href);
            }
          }}
        >
          <span className="notification-bell__item-time">{formatStamp(toast)}</span>
          <span className="notification-bell__item-text">
            {toast.title}
            {toast.count > 1 ? ` ×${toast.count}` : ''}
            {toast.body ? <span className="notification-bell__item-body">{toast.body}</span> : null}
          </span>
        </button>
      </li>
    );
  }

  return (
    <div className="notification-bell" ref={panelRef}>
      <button
        className="top-nav__icon-btn notification-bell__btn"
        type="button"
        onClick={handleToggle}
        title="通知"
        aria-label="通知"
        aria-expanded={open}
      >
        <Bell size={18} strokeWidth={2} aria-hidden="true" />
        {unread > 0 ? (
          <span className="notification-bell__badge">{unread > 99 ? '99+' : unread}</span>
        ) : null}
      </button>
      {open ? (
        <div className="notification-bell__panel" role="menu" aria-label="通知历史">
          <div className="notification-bell__panel-title">最近通知</div>
          {history.length === 0 ? (
            <div className="notification-bell__empty">暂无通知</div>
          ) : (
            <>
              {/* 断电类置顶单独分组：试玩报告 F——断电告警被上百条产线吞吐告警淹没 */}
              {powerAlerts.length > 0 ? (
                <section className="notification-bell__group">
                  <div className="notification-bell__group-title notification-bell__group-title--power">
                    断电告警
                  </div>
                  <ul className="notification-bell__list">
                    {powerAlerts.map((toast) => renderItem(toast))}
                  </ul>
                </section>
              ) : null}
              {otherAlerts.length > 0 ? (
                <section className="notification-bell__group">
                  <div className="notification-bell__group-title">其他通知</div>
                  <ul className="notification-bell__list">
                    {otherAlerts.map((toast) => renderItem(toast))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
