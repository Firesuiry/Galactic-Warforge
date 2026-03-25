import { Outlet } from 'react-router-dom';

import { TopNav } from '@/widgets/TopNav';

export function AppShell() {
  return (
    <div className="app-shell">
      <TopNav />
      <main className="page-shell">
        <Outlet />
      </main>
    </div>
  );
}
