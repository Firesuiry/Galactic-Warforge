import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProviderManagerView } from './ProviderManagerView';

describe('ProviderManagerView', () => {
  it('默认可视化完整命令白名单，并允许编辑研究/管理类命令', async () => {
    const user = userEvent.setup();
    const onCreateProvider = vi.fn();

    render(
      <ProviderManagerView
        fixtureMode={false}
        providers={[]}
        onCreateProvider={onCreateProvider}
        onClose={() => {}}
      />,
    );

    await user.type(screen.getByLabelText('模型 Provider 名称'), '研究 Provider');

    expect(screen.getByText('命令白名单')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /start_research/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /build_dyson_node/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /launch_rocket/ })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: /build_dyson_node/ }));
    await user.click(screen.getByRole('button', { name: '保存模型 Provider' }));

    expect(onCreateProvider).toHaveBeenCalledTimes(1);
    const payload = onCreateProvider.mock.calls[0]?.[0];
    expect(payload.toolPolicy.commandWhitelist).toEqual(
      expect.arrayContaining(['start_research', 'launch_rocket']),
    );
    expect(payload.toolPolicy.commandWhitelist).not.toContain('build_dyson_node');
  });
});
