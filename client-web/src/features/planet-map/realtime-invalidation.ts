import type { QueryClient, QueryKey } from '@tanstack/react-query';

interface QueryScope {
  serverUrl: string;
  playerId: string;
  planetId: string;
  systemId: string;
}

export interface InvalidationFlags {
  scene: boolean;
  runtime: boolean;
  networks: boolean;
  systemRuntime: boolean;
  summary: boolean;
  stats: boolean;
  alerts: boolean;
}

type PendingFlags = Partial<InvalidationFlags>;

// Serialize event-driven refreshes so slow requests can finish, then fetch any
// changes that arrived while they were in flight. A bare cancelRefetch:false
// would reuse an old request and silently lose the final event in a burst.
export function createPlanetInvalidationScheduler(
  client: QueryClient,
  getScope: () => QueryScope,
  onComplete: () => void,
) {
  let pending: PendingFlags = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let generation = 0;

  function schedule(flags: PendingFlags) {
    for (const key of Object.keys(flags) as (keyof InvalidationFlags)[]) {
      if (flags[key]) pending[key] = true;
    }
    if (timer !== undefined || inFlight || !Object.values(pending).some(Boolean)) return;
    timer = setTimeout(() => { void flush(); }, 150);
  }

  async function flush() {
    timer = undefined;
    inFlight = true;
    const batchGeneration = generation;
    const flags = pending;
    pending = {};
    const { serverUrl, playerId, planetId, systemId } = getScope();
    const queries: [keyof InvalidationFlags, QueryKey][] = [
      ['scene', ['planet-view', serverUrl, playerId, planetId]],
      ['runtime', ['planet-runtime', serverUrl, playerId, planetId]],
      ['networks', ['planet-networks', serverUrl, playerId, planetId]],
      // 顶栏 / 告警栏读的是 'shell-summary'（与行星页的 'summary' 同源不同 key）：
      // 两者都失效，接管机甲后 chip 不必等 5s 轮询。
      ['summary', ['summary', serverUrl, playerId]],
      ['summary', ['shell-summary', serverUrl, playerId]],
      ['stats', ['stats', serverUrl, playerId]],
      ['alerts', ['alerts-snapshot', serverUrl, playerId, planetId]],
    ];
    if (systemId) queries.push(['systemRuntime', ['system-runtime', serverUrl, playerId, systemId]]);

    await Promise.allSettled(queries.filter(([flag]) => flags[flag]).map(([flag, queryKey]) => {
      // A request started outside this scheduler may predate the event. Join it
      // without cancellation, but keep exactly one trailing refresh for its key.
      if (client.isFetching({ queryKey, type: 'active' }) > 0) pending[flag] = true;
      return client.invalidateQueries({ queryKey }, { cancelRefetch: false });
    }));
    if (batchGeneration !== generation) return;
    inFlight = false;
    onComplete();
    schedule({});
  }

  function reset() {
    generation++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = {};
    inFlight = false;
  }

  return { schedule, reset };
}
