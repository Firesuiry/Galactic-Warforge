import { screen } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';

import { resetStarmapViewStore, useStarmapViewStore } from '@/features/starmap/store';
import { renderApp, jsonResponse } from '@/test/utils';
import { useSessionStore } from '@/stores/session';

vi.mock('@/engine/PixiStage', () => ({
  PixiStage: () => <div data-testid="pixi-stage" />,
}));

describe('SystemPage', () => {
  beforeEach(() => {
    resetStarmapViewStore();
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/world/galaxy')) {
        return Promise.resolve(jsonResponse({
          galaxy_id: 'galaxy-1',
          name: 'Milky Test',
          discovered: true,
          systems: [
            {
              system_id: 'sys-1',
              name: 'Helios',
              discovered: true,
              position: { x: 10, y: 12 },
              star: { type: 'K' },
            },
          ],
        }));
      }
      if (url.endsWith('/world/systems/sys-1')) {
        return Promise.resolve(jsonResponse({
          system_id: 'sys-1',
          name: 'Helios',
          discovered: true,
          position: { x: 10, y: 12 },
          star: { type: 'K' },
          planets: [
            { planet_id: 'planet-1-1', name: 'Gaia', discovered: true, kind: 'terrestrial' },
            { planet_id: 'planet-1-2', name: 'Ares', discovered: true, kind: 'lava' },
          ],
        }));
      }
      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse({
          tick: 240,
          active_planet_id: 'planet-1-1',
          map_width: 128,
          map_height: 128,
          players: {
            p1: {
              player_id: 'p1',
              is_alive: true,
              resources: { minerals: 1000, energy: 800 },
            },
          },
        }));
      }
      if (url.endsWith('/state/stats')) {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 240,
          energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
        }));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    }));
  });

  it('深链 /system/:id 直接聚焦对应恒星系', async () => {
    renderApp(['/system/sys-1']);

    expect(useStarmapViewStore.getState().focusedSystemId).toBe('sys-1');
    // 面包屑显示当前恒星系名
    expect(await screen.findByText('Helios')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Milky Test' })).toBeInTheDocument();
  });
});
