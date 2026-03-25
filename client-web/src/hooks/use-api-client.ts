import { useMemo } from 'react';

import { createApiClient } from '@shared/api';
import {
  DEFAULT_GALAXY_ID,
  DEFAULT_PLANET_ID,
  DEFAULT_SYSTEM_ID,
} from '@shared/config';

import { createFixtureFetch, isFixtureServerUrl } from '@/fixtures';
import { useSessionSnapshot } from '@/hooks/use-session';

export function useApiClient() {
  const session = useSessionSnapshot();
  const fetchFn = useMemo(
    () => (isFixtureServerUrl(session.serverUrl) ? createFixtureFetch(session.serverUrl) : undefined),
    [session.serverUrl],
  );

  return useMemo(
    () => createApiClient({
      serverUrl: session.serverUrl,
      fetchFn,
      auth: {
        playerId: session.playerId,
        playerKey: session.playerKey,
      },
      defaultGalaxyId: DEFAULT_GALAXY_ID,
      defaultPlanetId: DEFAULT_PLANET_ID,
      defaultSystemId: DEFAULT_SYSTEM_ID,
    }),
    [fetchFn, session.playerId, session.playerKey, session.serverUrl],
  );
}
