import { useShallow } from 'zustand/react/shallow';

import { useSessionStore, hasActiveSession } from '@/stores/session';

export function useHasSession() {
  return useSessionStore((state) => hasActiveSession(state));
}

export function useSessionSnapshot() {
  return useSessionStore(useShallow((state) => ({
    playerId: state.playerId,
    playerKey: state.playerKey,
    serverUrl: state.serverUrl,
  })));
}
