import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from '@shared/api';
import { DEFAULT_EVENT_TYPES } from '@shared/config';

import { jsonResponse } from '@/test/utils';

describe('shared api client', () => {
  it('在未显式传入 event_types 时为事件快照补默认类型', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));

      expect(url.pathname).toBe('/events/snapshot');
      expect(url.searchParams.get('event_types')).toBe(DEFAULT_EVENT_TYPES.join(','));
      expect(url.searchParams.get('limit')).toBe('8');

      return Promise.resolve(jsonResponse({
        event_types: DEFAULT_EVENT_TYPES,
        available_from_tick: 0,
        has_more: false,
        events: [],
      }));
    });

    const client = createApiClient({
      serverUrl: 'http://localhost:5173',
      fetchFn: fetchMock as typeof fetch,
      auth: {
        playerId: 'p1',
        playerKey: 'key_player_1',
      },
    });

    await expect(client.fetchEventSnapshot({ limit: 8 })).resolves.toMatchObject({
      events: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
