import { useEffect, useRef } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { Flag, TriangleAlert } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  gameIdentityOf,
  gameStatusOf,
  isAuthErrorMessage,
  isSameSettlementPrompt,
  SETTLEMENT_PROMPTED_STORAGE_KEY,
  settlementPromptKey,
} from '@/features/lobby/current-game';
import { useCurrentGameQuery } from '@/features/lobby/use-current-game';
import { useSessionSnapshot } from '@/hooks/use-session';
import {
  AUTH_FAILURE_LOGOUT_THRESHOLD,
  resetLobbyStore,
  useLobbyStore,
} from '@/stores/lobby';
import { useSessionStore } from '@/stores/session';

function readPromptedSettlementKey() {
  try {
    return sessionStorage.getItem(SETTLEMENT_PROMPTED_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writePromptedSettlementKey(key: string) {
  try {
    sessionStorage.setItem(SETTLEMENT_PROMPTED_STORAGE_KEY, key);
  } catch {
    // 隐私模式写不了 sessionStorage 时，仍靠本页 store 去重。
  }
}

/**
 * C10 局变更守卫（挂在 AppShell，全页面生效）：
 * - 轮询 /games/current，started_at/seed 变化 → 判定管理员热重置：
 *   清空 react-query 缓存强制全量重拉，并弹出顶部提示条
 * - 连续 401（旧 key 已被新局作废）→ 自动登出并跳登录页，附重新登录引导；
 *   SSE 随 AppShell 卸载停止，避免拿旧 key 无限重连
 * - status=finished 且不在结算页：同一 started_at+declared_tick 只提示一次
 */
export function GameResetGuard() {
  const session = useSessionSnapshot();
  const location = useLocation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const clearSession = useSessionStore((state) => state.clearSession);
  const resetNotice = useLobbyStore((state) => state.resetNotice);
  const dismissResetNotice = useLobbyStore((state) => state.dismissResetNotice);
  const settlementNotice = useLobbyStore((state) => state.settlementNotice);
  const promptedRef = useRef(readPromptedSettlementKey());

  const gameQuery = useCurrentGameQuery();
  const scope = `${session.serverUrl}::${session.playerId}`;

  useEffect(() => {
    const game = gameQuery.data;
    if (!game) {
      return;
    }
    const store = useLobbyStore.getState();
    store.resetAuthFailure();
    const identity = gameIdentityOf(game);
    if (store.knownScope !== scope) {
      // 换会话/换服务器：以当前对局为新基线，清掉残留提示
      store.recordIdentity(scope, identity);
      store.dismissResetNotice();
      return;
    }
    if (!store.knownIdentity) {
      store.recordIdentity(scope, identity);
      return;
    }
    if (store.knownIdentity !== identity) {
      // 局变了但本机 key 仍有效（管理员保留了该玩家的 key）：全量重拉 + 提示
      store.recordIdentity(scope, identity);
      store.flagResetNotice();
      queryClient.clear();
    }
  }, [gameQuery.data, scope, queryClient]);

  useEffect(() => {
    const game = gameQuery.data;
    const store = useLobbyStore.getState();
    if (!game || gameStatusOf(game) !== 'finished') {
      if (store.settlementNotice) {
        store.hideSettlementNotice();
      }
      return;
    }
    const key = settlementPromptKey(game);
    const already = isSameSettlementPrompt(promptedRef.current, game)
      || isSameSettlementPrompt(store.settlementPromptedKey, game)
      || isSameSettlementPrompt(readPromptedSettlementKey(), game);
    if (location.pathname === '/settlement') {
      promptedRef.current = key;
      writePromptedSettlementKey(key);
      store.noteSettlementPrompt(key, false);
      return;
    }
    if (already) {
      promptedRef.current = key;
      if (!store.settlementPromptedKey) {
        // 刷新后 session 已记过：不再打开，也不要清掉正在显示的条（本分支 store 为空）。
        store.noteSettlementPrompt(key, false);
      }
      return;
    }
    promptedRef.current = key;
    writePromptedSettlementKey(key);
    store.noteSettlementPrompt(key, true);
  }, [gameQuery.data, location.pathname]);

  useEffect(() => {
    const error = gameQuery.error;
    if (!error) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (!isAuthErrorMessage(message)) {
      useLobbyStore.getState().resetAuthFailure();
      return;
    }
    const failures = useLobbyStore.getState().bumpAuthFailure();
    if (failures < AUTH_FAILURE_LOGOUT_THRESHOLD) {
      return;
    }
    // key 已失效（对局被重置/服务端换 key 集）：登出并引导用新 key 重新登录
    clearSession();
    queryClient.clear();
    resetLobbyStore();
    useLobbyStore.getState().setLoginNotice('session-expired');
    navigate('/login', { replace: true });
  }, [gameQuery.error, clearSession, navigate, queryClient]);

  if (!resetNotice && !settlementNotice) {
    return null;
  }

  return (
    <>
      {resetNotice ? (
        <div className="game-reset-banner" role="alert">
          <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />
          <span>对局已被管理员重置，本地缓存已刷新为最新状态；实时事件流会自动重连。</span>
          <button
            className="game-reset-banner__dismiss"
            type="button"
            onClick={dismissResetNotice}
          >
            知道了
          </button>
        </div>
      ) : null}
      {settlementNotice ? (
        <div
          className={`game-reset-banner${resetNotice ? ' game-reset-banner--below' : ''}`}
          role="status"
        >
          <Flag size={16} strokeWidth={2} aria-hidden="true" />
          <span>对局已结束，请前往结算页查看胜负与战损。</span>
          <Link className="game-reset-banner__dismiss" to="/settlement">
            查看结算
          </Link>
          <button
            className="game-reset-banner__dismiss"
            type="button"
            onClick={() => useLobbyStore.getState().hideSettlementNotice()}
          >
            知道了
          </button>
        </div>
      ) : null}
    </>
  );
}
