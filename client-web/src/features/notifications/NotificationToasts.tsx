/**
 * 右下角悬浮 toast 栈（全局挂载 AppShell）：
 * - 进场滑入 / 出场渐隐右滑动画；?freeze=1 不播动画直接呈现（截图测试约定）。
 * - 自动 5s 消退：组件 interval 驱动 store.sweep；hover 暂停（pause/resume）。
 * - store 只把过期条目标记 leaving，动画结束后由本组件 remove 真正删除。
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  isNotificationsFrozen,
} from '@/features/notifications/notify';
import {
  useNotificationsStore,
  type Toast,
} from '@/features/notifications/store';

const EXIT_ANIMATION_MS = 320;
const SWEEP_INTERVAL_MS = 250;

const KIND_GLYPH: Record<Toast['kind'], string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  danger: '✖',
};

function ToastCard({ toast, frozen }: { toast: Toast; frozen: boolean }) {
  const navigate = useNavigate();
  const pause = useNotificationsStore((state) => state.pause);
  const resume = useNotificationsStore((state) => state.resume);
  const dismiss = useNotificationsStore((state) => state.dismiss);
  const remove = useNotificationsStore((state) => state.remove);

  // 出场动画：leaving 标记后播完动画再真正删除
  useEffect(() => {
    if (!toast.leaving) {
      return undefined;
    }
    const timer = window.setTimeout(() => remove(toast.id), frozen ? 0 : EXIT_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast.leaving, toast.id, frozen, remove]);

  function handleClick() {
    if (toast.href) {
      navigate(toast.href);
    }
    dismiss(toast.id);
  }

  return (
    <div
      className={[
        'toast',
        `toast--${toast.kind}`,
        toast.leaving ? 'toast--leaving' : '',
        frozen ? 'toast--frozen' : '',
        toast.href ? 'toast--clickable' : '',
      ].filter(Boolean).join(' ')}
      role="status"
      onMouseEnter={() => pause(toast.id)}
      onMouseLeave={() => resume(toast.id)}
      onClick={handleClick}
    >
      <span className="toast__glyph" aria-hidden="true">{KIND_GLYPH[toast.kind]}</span>
      <div className="toast__content">
        <div className="toast__title">
          {toast.title}
          {toast.count > 1 ? <span className="toast__count">×{toast.count}</span> : null}
        </div>
        {toast.body ? <div className="toast__body">{toast.body}</div> : null}
      </div>
      <button
        className="toast__close"
        type="button"
        aria-label="关闭通知"
        onClick={(event) => {
          event.stopPropagation();
          dismiss(toast.id);
        }}
      >
        ×
      </button>
    </div>
  );
}

export function NotificationToasts() {
  const toasts = useNotificationsStore((state) => state.toasts);
  const sweep = useNotificationsStore((state) => state.sweep);
  const frozen = isNotificationsFrozen();

  useEffect(() => {
    const timer = window.setInterval(() => sweep(), SWEEP_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [sweep]);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} frozen={frozen} />
      ))}
    </div>
  );
}
