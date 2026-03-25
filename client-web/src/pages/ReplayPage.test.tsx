import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createFixtureServerUrl } from '@/fixtures';
import { useSessionStore } from '@/stores/session';
import { renderApp } from '@/test/utils';

describe('ReplayPage', () => {
  beforeEach(() => {
    useSessionStore.getState().setSession({
      serverUrl: createFixtureServerUrl('baseline'),
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
  });

  it('允许输入 tick 范围并展示 replay digest 和 snapshot digest', async () => {
    const user = userEvent.setup();

    renderApp(['/replay']);

    expect(await screen.findByRole('heading', { name: 'Replay 调试台' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByDisplayValue('120')).toBeInTheDocument();
      expect(screen.getByDisplayValue('128')).toBeInTheDocument();
    });

    await user.clear(screen.getByLabelText('from_tick'));
    await user.type(screen.getByLabelText('from_tick'), '124');
    await user.clear(screen.getByLabelText('to_tick'));
    await user.type(screen.getByLabelText('to_tick'), '128');
    await user.click(screen.getByRole('button', { name: '执行 replay' }));

    expect(await screen.findByText('结果摘要')).toBeInTheDocument();
    expect(await screen.findByText('检测到漂移')).toBeInTheDocument();
    expect(screen.getByText('Replay Digest')).toBeInTheDocument();
    expect(screen.getByText('Snapshot Digest')).toBeInTheDocument();
    expect(screen.getByText('该样例用于验证回放校验面板的差异高亮。')).toBeInTheDocument();
  });
});
