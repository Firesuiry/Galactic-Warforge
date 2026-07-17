/**
 * TopNav 铃铛：未读角标 + 最近 20 条历史面板（store 环形缓冲，不持久化）。
 * 展开/收起播 uiClick；面板外点击关闭（复用 TopNav 设置面板模式）。
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { sfx } from '@/engine/audio';
import { useNotificationsStore } from '@/features/notifications/store';

function formatTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function NotificationBell() {
  const navigate = useNavigate();
  const history = useNotificationsStore((state) => state.history);
  const unread = useNotificationsStore((state) => state.unread);
  const markAllRead = useNotificationsStore((state) => state.markAllRead);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

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
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        markAllRead();
      }
      return next;
    });
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
        <span aria-hidden="true">🔔</span>
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
            <ul className="notification-bell__list">
              {history.map((toast) => (
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
                    <span className="notification-bell__item-time">{formatTime(toast.at)}</span>
                    <span className="notification-bell__item-text">
                      {toast.title}
                      {toast.count > 1 ? ` ×${toast.count}` : ''}
                      {toast.body ? <span className="notification-bell__item-body">{toast.body}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
