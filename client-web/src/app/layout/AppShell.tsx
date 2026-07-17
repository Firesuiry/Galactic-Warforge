import { Outlet, useLocation } from 'react-router-dom';

import { useGameAudio } from '@/features/audio/use-game-audio';
import { NotificationToasts } from '@/features/notifications/NotificationToasts';
import { Outliner } from '@/widgets/Outliner';
import { TopNav } from '@/widgets/TopNav';

export function AppShell() {
  const { pathname } = useLocation();
  // App 级游戏音效：订阅战斗事件总线（此处全局只挂一次）
  useGameAudio();
  return (
    <div className="app-shell">
      <TopNav />
      <div className="app-body">
        {/*
          key 按 pathname 变化 → 路由切换时 .page-shell 重挂载，触发 CSS page-enter 动画重放。
          TopNav 在 main 之外，不随路由重挂载（保留其状态）。
        */}
        <main className="page-shell" key={pathname}>
          <Outlet />
        </main>
        <Outliner />
      </div>
      {/* 全局事件通知 toast 栈（右下角悬浮，全页面可见） */}
      <NotificationToasts />
    </div>
  );
}
