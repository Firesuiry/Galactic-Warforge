import { Outlet, useLocation } from 'react-router-dom';

import { TopNav } from '@/widgets/TopNav';

export function AppShell() {
  const { pathname } = useLocation();
  return (
    <div className="app-shell">
      <TopNav />
      {/*
        key 按 pathname 变化 → 路由切换时 .page-shell 重挂载，触发 CSS page-enter 动画重放。
        TopNav 在 main 之外，不随路由重挂载（保留其状态）。
      */}
      <main className="page-shell" key={pathname}>
        <Outlet />
      </main>
    </div>
  );
}
