import { describe, expect, it } from 'vitest';

import { createFixtureFetch, createFixtureServerUrl } from '@/fixtures';

import type { AlertSnapshotResponse } from '@shared/types';

/**
 * 试玩 1016 严重 1：shell 告警只取 limit=50，快照必须「仍成立在前、最新在前」，
 * 且 active_only=true 时 limit 只作用于仍成立的条目。Storybook/fixture 的
 * mock 要镜像服务端语义，否则浏览器里看到的与真服不一致。
 */
interface SnapshotParams {
  after_alert_id?: string;
  since_tick?: number;
  active_only?: boolean;
  limit?: number;
}

async function fetchSnapshot(params: SnapshotParams): Promise<AlertSnapshotResponse> {
  const serverUrl = createFixtureServerUrl('baseline');
  const fetchFn = createFixtureFetch(serverUrl);
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) search.set(key, String(value));
  });
  const response = await fetchFn(`${serverUrl}/alerts/production/snapshot?${search.toString()}`, {
    headers: { Authorization: 'Bearer key_player_1' },
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<AlertSnapshotResponse>;
}

describe('fixture /alerts/production/snapshot', () => {
  it('默认快照仍成立在前、最新在前', async () => {
    const snapshot = await fetchSnapshot({});
    expect(snapshot.alerts.map((alert) => alert.alert_id)).toEqual([
      'alert-miner-input',
      'alert-assembler-power',
    ]);
    expect(snapshot.alerts.every((alert) => alert.active !== false)).toBe(true);
  });

  it('active_only + limit 只数仍成立的条目', async () => {
    const snapshot = await fetchSnapshot({ active_only: true, limit: 1 });
    expect(snapshot.alerts.map((alert) => alert.alert_id)).toEqual(['alert-miner-input']);
    expect(snapshot.has_more).toBe(true);
  });
});
