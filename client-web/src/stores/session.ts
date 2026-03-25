import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { normalizeServerUrl } from '@shared/utils';

const STORAGE_KEY = 'siliconworld-client-web-session';

export interface SessionFormValue {
  serverUrl: string;
  playerId: string;
  playerKey: string;
}

export interface SessionStore extends SessionFormValue {
  setSession: (value: SessionFormValue) => void;
  clearSession: () => void;
}

export function getDefaultWebServerUrl() {
  const configuredServer = import.meta.env.VITE_SW_DEFAULT_SERVER;
  if (configuredServer) {
    return normalizeServerUrl(configuredServer);
  }
  if (typeof window !== 'undefined') {
    return normalizeServerUrl(window.location.origin);
  }
  return '';
}

export function createInitialSessionValue(): SessionFormValue {
  return {
    serverUrl: getDefaultWebServerUrl(),
    playerId: '',
    playerKey: '',
  };
}

export function hasActiveSession(value: Pick<SessionFormValue, 'playerId' | 'playerKey'>) {
  return Boolean(value.playerId.trim() && value.playerKey.trim());
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      ...createInitialSessionValue(),
      setSession: (value) => {
        set({
          ...value,
          serverUrl: normalizeServerUrl(value.serverUrl),
        });
      },
      clearSession: () => {
        set(createInitialSessionValue());
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function resetSessionStore() {
  useSessionStore.persist.clearStorage();
  useSessionStore.setState({
    ...createInitialSessionValue(),
    setSession: useSessionStore.getState().setSession,
    clearSession: useSessionStore.getState().clearSession,
  });
}
