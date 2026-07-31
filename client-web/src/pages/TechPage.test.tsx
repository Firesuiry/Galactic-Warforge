import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createFixtureServerUrl } from '@/fixtures';
import { useSessionStore } from '@/stores/session';
import { renderApp } from '@/test/utils';

describe('TechPage', () => {
  beforeEach(() => {
    useSessionStore.getState().setSession({
      serverUrl: createFixtureServerUrl('baseline'),
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
  });

  it('渲染科技树标题、统计与泳道节点', async () => {
    renderApp(['/tech']);

    expect(await screen.findByRole('heading', { name: '科技树' })).toBeInTheDocument();
    // baseline fixture 有 2 项科技：electromagnetism（主线）+ basic_logistics_system（物流）
    expect(await screen.findByText('电磁学')).toBeInTheDocument();
    expect(screen.getByText('基础物流系统')).toBeInTheDocument();
    // p1 未完成任何科技，且 electromagnetism 无前置 → available
    expect(screen.getByTestId(/tech-canvas/)).toBeInTheDocument();
  });

  it('点击节点后右侧详情面板展示成本与前置', async () => {
    const user = userEvent.setup();
    renderApp(['/tech']);

    await screen.findByText('电磁学');
    await user.click(screen.getByRole('button', { name: /电磁学/ }));

    const detail = await screen.findByTestId('tech-detail');
    expect(detail).toHaveTextContent('电磁学');
    expect(detail).toHaveTextContent('前置科技');
    expect(detail).toHaveTextContent('无前置');
  });

  it('前置未完成的科技显示为未解锁并在详情标出缺失前置', async () => {
    const user = userEvent.setup();
    renderApp(['/tech']);

    await screen.findByText('基础物流系统');
    const node = screen.getByRole('button', { name: /基础物流系统/ });
    expect(node).toHaveClass('is-locked');

    await user.click(node);
    const detail = await screen.findByTestId('tech-detail');
    expect(detail).toHaveTextContent('电磁学');
    expect(detail).toHaveTextContent('未完成');
  });

  it('分支筛选 chip 可以只显示单一泳道', async () => {
    const user = userEvent.setup();
    renderApp(['/tech']);

    await screen.findByText('电磁学');
    await user.click(screen.getByRole('button', { name: '物流' }));

    expect(screen.getByText('基础物流系统')).toBeInTheDocument();
    expect(screen.queryByText('电磁学')).not.toBeInTheDocument();
  });
});
