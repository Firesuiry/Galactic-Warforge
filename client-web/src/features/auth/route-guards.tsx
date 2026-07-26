import type { PropsWithChildren } from 'react';
import { useEffect } from 'react';

import { Navigate, useLocation, useSearchParams } from 'react-router-dom';

import { useHasSession } from '@/hooks/use-session';
import { useSessionStore } from '@/stores/session';

// 允许通过 URL 参数 ?as=p1|p2&key=xxx 快速建立会话，便于演示/截图/观战。
// 仅当当前没有会话时生效，且参数齐全才会写入。
// 必须在路由守卫判定 hasSession 之前同步执行，否则首次渲染会被守卫重定向走。
function bootstrapUrlSession(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  const as = params.get('as');
  const key = params.get('key');
  if (!as || !key) {
    return false;
  }
  const store = useSessionStore.getState();
  if (store.playerId && store.playerKey) {
    return false;
  }
  store.setSession({ serverUrl: store.serverUrl, playerId: as, playerKey: key });
  return true;
}

// 在模块加载时立即尝试 bootstrap，确保首个 render 之前 session 已就位。
bootstrapUrlSession();

function useUrlSessionBootstrap() {
  const [searchParams] = useSearchParams();
  const setSession = useSessionStore((s) => s.setSession);
  const serverUrl = useSessionStore((s) => s.serverUrl);
  const hasSession = useHasSession();
  useEffect(() => {
    if (hasSession) {
      return;
    }
    const as = searchParams.get('as');
    const key = searchParams.get('key');
    if (!as || !key) {
      return;
    }
    setSession({ serverUrl, playerId: as, playerKey: key });
  }, [hasSession, searchParams, serverUrl, setSession]);
}

export function RequireSession({ children }: PropsWithChildren) {
  useUrlSessionBootstrap();
  const hasSession = useHasSession();
  const location = useLocation();

  if (!hasSession) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

export function OnlyGuests({ children }: PropsWithChildren) {
  useUrlSessionBootstrap();
  const hasSession = useHasSession();

  if (hasSession) {
    return <Navigate to="/galaxy" replace />;
  }

  return children;
}
