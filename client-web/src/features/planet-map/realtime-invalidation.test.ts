import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPlanetInvalidationScheduler } from './realtime-invalidation';

describe('planet event refresh scheduling', () => {
  let client: QueryClient;
  let scope: { serverUrl: string; playerId: string; planetId: string; systemId: string };
  let scheduler: ReturnType<typeof createPlanetInvalidationScheduler>;
  let unsubscribers: (() => void)[];
  let onComplete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    scope = { serverUrl: 'http://game', playerId: 'p1', planetId: 'planet-a', systemId: 'sys-a' };
    unsubscribers = [];
    onComplete = vi.fn();
    scheduler = createPlanetInvalidationScheduler(client, () => scope, onComplete);
  });

  afterEach(() => {
    scheduler.reset();
    unsubscribers.forEach(unsubscribe => unsubscribe());
    client.clear();
    vi.useRealTimers();
  });

  function observe(kind = 'planet-scene', planet = scope.planetId, delay = 450) {
    const key = [kind, scope.serverUrl, scope.playerId, planet];
    let server = 0;
    let requests = 0;
    let active = 0;
    let peak = 0;
    const updates: number[] = [];
    const observer = new QueryObserver(client, {
      queryKey: key,
      initialData: 0,
      queryFn: async () => {
        const captured = server;
        requests++;
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setTimeout(resolve, delay));
        active--;
        return captured;
      },
    });
    unsubscribers.push(observer.subscribe(result => {
      if (result.fetchStatus === 'idle') updates.push(result.data ?? -1);
    }));
    return {
      observer, updates,
      setServer: (value: number) => { server = value; },
      value: () => client.getQueryData<number>(key),
      requests: () => requests,
      peak: () => peak,
    };
  }

  it('commits slow responses during sustained events and eventually includes the final event', async () => {
    const scene = observe();
    for (let value = 1; value <= 16; value++) {
      scene.setServer(value);
      scheduler.schedule({ scene: true });
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(scene.updates.filter(value => value > 0).length).toBeGreaterThanOrEqual(2);
    expect(scene.value()).toBeGreaterThan(0);
    expect(scene.peak()).toBe(1);
    await vi.advanceTimersByTimeAsync(1200);
    expect(scene.value()).toBe(16);
    expect(scene.requests()).toBeLessThanOrEqual(5);
  });

  it('keeps the event arriving during its own refresh as exactly one trailing fetch', async () => {
    const scene = observe();
    scene.setServer(1);
    scheduler.schedule({ scene: true });
    await vi.advanceTimersByTimeAsync(250);
    scene.setServer(2);
    scheduler.schedule({ scene: true });
    await vi.advanceTimersByTimeAsync(350);
    expect(scene.value()).toBe(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(scene.value()).toBe(2);
    expect(scene.requests()).toBe(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(scene.requests()).toBe(2);
  });

  it('joins an existing request, then fetches once more without an infinite dirty loop', async () => {
    const scene = observe();
    scene.setServer(1);
    const existing = scene.observer.refetch();
    await vi.advanceTimersByTimeAsync(50);
    scene.setServer(2);
    scheduler.schedule({ scene: true });
    await vi.advanceTimersByTimeAsync(400);
    await existing;
    expect(scene.value()).toBe(1);
    expect(scene.requests()).toBe(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(scene.value()).toBe(2);
    expect(scene.requests()).toBe(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(scene.requests()).toBe(2);
  });

  it('preserves all query flags received while a different query is in flight', async () => {
    const scene = observe();
    const networks = observe('planet-networks', scope.planetId, 50);
    scene.setServer(1);
    scheduler.schedule({ scene: true });
    await vi.advanceTimersByTimeAsync(250);
    networks.setServer(3);
    scheduler.schedule({ networks: true, scene: false });
    await vi.advanceTimersByTimeAsync(700);
    expect(scene.value()).toBe(1);
    expect(networks.value()).toBe(3);
    expect(scene.requests()).toBe(1);
    expect(networks.requests()).toBe(1);
  });

  it('does not let an old planet completion reschedule work or complete the new scope', async () => {
    const oldScene = observe();
    oldScene.setServer(1);
    scheduler.schedule({ scene: true });
    await vi.advanceTimersByTimeAsync(250);
    oldScene.setServer(2);
    scheduler.schedule({ scene: true });
    scheduler.reset();
    scope = { ...scope, planetId: 'planet-b' };
    const newScene = observe();
    newScene.setServer(7);
    scheduler.schedule({ scene: true });
    await vi.advanceTimersByTimeAsync(350);
    expect(onComplete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(newScene.value()).toBe(7);
    expect(oldScene.value()).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(oldScene.requests()).toBe(1);
    expect(newScene.requests()).toBe(1);
  });

  it('drops pending timers and trailing events on unmount/reset', async () => {
    const scene = observe();
    scheduler.schedule({ scene: true });
    scheduler.reset();
    await vi.advanceTimersByTimeAsync(1000);
    expect(scene.requests()).toBe(0);
    scheduler.schedule({ scene: true });
    await vi.advanceTimersByTimeAsync(250);
    scheduler.schedule({ scene: true });
    scheduler.reset();
    await vi.advanceTimersByTimeAsync(3000);
    expect(scene.requests()).toBe(1);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
