import { Outlet, useLocation } from 'react-router-dom';

import { useGameAudio } from '@/features/audio/use-game-audio';
import { EndgameBanner } from '@/features/lobby/EndgameBanner';
import { GameResetGuard } from '@/features/lobby/GameResetGuard';
import { NotificationToasts } from '@/features/notifications/NotificationToasts';
import { AlertBar } from '@/widgets/AlertBar';
import { TopNav } from '@/widgets/TopNav';

export function AppShell() {
  const { pathname } = useLocation();
  // App 级游戏音效：订阅战斗事件总线（此处全局只挂一次）。
  // 实体反查（坐标 / 类型 / 归属）读 features/audio/battle-context 的当前行星索引，
  // 由行星页与战争工作台各自在挂载时写入（见 use-planet-audio-scene / WarPage）。
  useGameAudio();
  return (
    <div className="app-shell">
      <TopNav />
      {/* 警报条（§3.3）：顶栏下方居中的窄条，无警报时整条不渲染 */}
      <AlertBar />
      <div className="app-body">
        {/*
          key 按 pathname 变化 → 路由切换时 .page-shell 重挂载，触发 CSS page-enter 动画重放。
          TopNav 在 main 之外，不随路由重挂载（保留其状态）。
        */}
        <main className="page-shell" key={pathname}>
          <Outlet />
        </main>
      </div>
      {/* 全局事件通知 toast 栈（右上角悬浮，全页面可见） */}
      <NotificationToasts />
      {/* C10 局变更守卫：轮询 /games/current，热重置/凭证失效时全局引导 */}
      <GameResetGuard />
      {/* 终局/出局胜负横幅：只在胜利/战败时出现，读档或开新局后自动复位 */}
      <EndgameBanner />
    </div>
  );
}
