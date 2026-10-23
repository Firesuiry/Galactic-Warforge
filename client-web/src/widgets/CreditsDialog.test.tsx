import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '@/stores/session';
import { jsonResponse } from '@/test/utils';
import { TopNav } from '@/widgets/TopNav';

const CREDITS = {
  note: '测试用清单',
  groups: [
    {
      id: 'sketchfab',
      title: '3D 模型（Sketchfab，CC BY 4.0）',
      entries: [
        {
          type: 'executor', title: 'XR-88 Mecha', author: 'rafadurand',
          authorUrl: 'https://sketchfab.com/rafadurand',
          modelUrl: 'https://sketchfab.com/3d-models/xr-88-mecha-94cbf12e92c4490ba2ea5739221e7252',
          license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
          changes: '减面、重新贴图、阵营涂装',
        },
      ],
    },
  ],
};

function renderTopNav() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/galaxy']}>
        <TopNav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TopNav credits', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens the credits dialog from settings and lists author + model link', async () => {
    useSessionStore.getState().setSession({ serverUrl: 'http://localhost:5173', playerId: 'p1', playerKey: 'key_player_1' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://localhost:5173');
      if (url.pathname === '/assets/credits.json') return jsonResponse(CREDITS);
      if (url.pathname === '/alerts/production/snapshot') return jsonResponse({ available_from_tick: 1, has_more: false, alerts: [] });
      if (url.pathname === '/state/summary') return jsonResponse({ tick: 1 });
      return jsonResponse({});
    });
    const user = userEvent.setup();
    renderTopNav();

    await user.click(screen.getByRole('button', { name: '设置' }));
    await user.click(screen.getByRole('button', { name: '鸣谢（第三方素材与许可）' }));

    const dialog = await screen.findByRole('dialog', { name: '鸣谢' });
    expect(dialog).toBeTruthy();
    await waitFor(() => expect(screen.getByText('XR-88 Mecha')).toBeTruthy());
    expect(screen.getByText('rafadurand').closest('a')?.getAttribute('href')).toBe('https://sketchfab.com/rafadurand');
    expect(screen.getByText('XR-88 Mecha').closest('a')?.getAttribute('href')).toContain('sketchfab.com/3d-models/xr-88-mecha');
    expect(screen.getByText(/改动：/).textContent).toContain('阵营涂装');
  });
});
