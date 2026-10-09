import { create } from 'zustand';

/**
 * C10 大厅/会话：局变更检测状态。
 * - knownScope/knownIdentity：已确认的对局基线（scope = serverUrl::playerId）
 * - knownTick：基线对局已见到的最大 tick（tick 回退才是真重置；单纯 SSE 重连不算）
 * - resetNotice：检测到对局被管理员重置（本机 key 仍有效），提示用户状态已刷新
 * - reconnectNotice：只是服务端重启/SSE 重连（同一存档），提示已重新连接
 * - authFailureCount：/games/current 连续 401 次数（≥2 才登出，容忍换局瞬间的竞态）
 */
interface LobbyStore {
  knownScope: string;
  knownIdentity: string;
  knownTick: number;
  resetNotice: boolean;
  reconnectNotice: boolean;
  authFailureCount: number;
  /** 登出跳登录页时附带的引导提示（location.state 会被路由守卫的 Navigate 覆盖，故放 store） */
  loginNotice: string;
  /** 已提示过的终局键 started_at::declared_tick。跨轮询保持，避免重复打开。 */
  settlementPromptedKey: string;
  settlementNotice: boolean;
  recordIdentity: (scope: string, identity: string, tick: number) => void;
  flagResetNotice: () => void;
  dismissResetNotice: () => void;
  flagReconnectNotice: () => void;
  dismissReconnectNotice: () => void;
  noteSettlementPrompt: (key: string, visible: boolean) => void;
  hideSettlementNotice: () => void;
  bumpAuthFailure: () => number;
  resetAuthFailure: () => void;
  setLoginNotice: (notice: string) => void;
}

function createInitialLobbyState() {
  return {
    knownScope: '',
    knownIdentity: '',
    knownTick: 0,
    resetNotice: false,
    reconnectNotice: false,
    authFailureCount: 0,
    loginNotice: '',
    settlementPromptedKey: '',
    settlementNotice: false,
  };
}

/** 连续 401 达到该次数才强制登出：换局瞬间旧 key 可能恰好打出一发 401，需要容忍一次。 */
export const AUTH_FAILURE_LOGOUT_THRESHOLD = 2;

export const useLobbyStore = create<LobbyStore>()((set, get) => ({
  ...createInitialLobbyState(),
  recordIdentity: (scope, identity, tick) => {
    set({ knownScope: scope, knownIdentity: identity, knownTick: tick });
  },
  flagResetNotice: () => {
    set({ resetNotice: true });
  },
  dismissResetNotice: () => {
    set({ resetNotice: false });
  },
  flagReconnectNotice: () => {
    set({ reconnectNotice: true });
  },
  dismissReconnectNotice: () => {
    set({ reconnectNotice: false });
  },
  noteSettlementPrompt: (key, visible) => {
    set({ settlementPromptedKey: key, settlementNotice: visible });
  },
  hideSettlementNotice: () => {
    set({ settlementNotice: false });
  },
  bumpAuthFailure: () => {
    const next = get().authFailureCount + 1;
    set({ authFailureCount: next });
    return next;
  },
  resetAuthFailure: () => {
    if (get().authFailureCount !== 0) {
      set({ authFailureCount: 0 });
    }
  },
  setLoginNotice: (notice) => {
    set({ loginNotice: notice });
  },
}));

export function resetLobbyStore() {
  useLobbyStore.setState(createInitialLobbyState());
}
