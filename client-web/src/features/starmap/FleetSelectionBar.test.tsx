import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FleetDetailView } from '@shared/types';

import { FleetSelectionBar } from '@/features/starmap/FleetSelectionBar';
import { resetStarmapViewStore, useStarmapViewStore } from '@/features/starmap/store';
import type { WarCommandInput } from '@/features/war/war-query-keys';

const { mockClient, runCommandMock } = vi.hoisted(() => ({
  mockClient: {
    cmdFleetAssign: vi.fn(),
    cmdFleetDisband: vi.fn(),
  },
  // 透传执行 execute，使指令客户端调用可被断言
  runCommandMock: vi.fn((input: WarCommandInput) => void input.execute()),
}));

vi.mock('@/hooks/use-api-client', () => ({
  useApiClient: () => mockClient,
}));

function makeFleet(): FleetDetailView {
  return {
    fleet_id: 'fleet-1',
    owner_id: 'p1',
    system_id: 'sys-1',
    formation: 'line',
    state: 'idle',
    weapons: {},
    sustainment: {},
    armor: { level: 40, max_level: 60 },
    structure: { level: 90, max_level: 120 },
    subsystems: {},
    weapon: {},
    shield: {},
  } as unknown as FleetDetailView;
}

const scope = { serverUrl: 'http://localhost:5173', playerId: 'p1' };

function renderBar(fleet: FleetDetailView = makeFleet()) {
  return render(
    <FleetSelectionBar
      fleet={fleet}
      systemName="Helios"
      scope={scope}
      runCommand={runCommandMock}
      feedbacks={{}}
      isPending={false}
    />,
  );
}

describe('FleetSelectionBar', () => {
  beforeEach(() => {
    resetStarmapViewStore();
    vi.clearAllMocks();
    mockClient.cmdFleetAssign.mockResolvedValue({ results: [{ status: 'executed' }] });
    mockClient.cmdFleetDisband.mockResolvedValue({ results: [{ status: 'executed' }] });
  });

  it('显示舰队状态/阵型/装甲结构/所在星系', () => {
    renderBar();
    const bar = screen.getByTestId('starmap-fleet-bar');
    expect(bar).toHaveTextContent('fleet-1');
    expect(bar).toHaveTextContent('待命');
    expect(bar).toHaveTextContent('阵型 line');
    expect(bar).toHaveTextContent('装甲 40/60');
    expect(bar).toHaveTextContent('结构 90/120');
    expect(bar).toHaveTextContent('@Helios');
  });

  it('调整编队：提交 fleet_assign（fleet_id + formation）', async () => {
    const user = userEvent.setup();
    renderBar();

    // 阵型未变时按钮禁用，先切换阵型
    expect(screen.getByRole('button', { name: '调整编队' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('舰队阵型'), 'vee');
    await user.click(screen.getByRole('button', { name: '调整编队' }));

    expect(mockClient.cmdFleetAssign).toHaveBeenCalledWith('fleet-1', 'vee');
    expect(runCommandMock).toHaveBeenCalled();
  });

  it('攻击目标：进入 attack 模式并聚焦舰队所在星系', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole('button', { name: '攻击目标' }));
    expect(useStarmapViewStore.getState().interactionMode).toEqual({ kind: 'attack', fleetId: 'fleet-1' });
    expect(useStarmapViewStore.getState().focusedSystemId).toBe('sys-1');

    await user.click(screen.getByRole('button', { name: '取消攻击' }));
    expect(useStarmapViewStore.getState().interactionMode.kind).toBe('inspect');
  });

  it('解散舰队：提交 fleet_disband 并取消选中', async () => {
    const user = userEvent.setup();
    useStarmapViewStore.getState().selectFleet('fleet-1');
    renderBar();

    await user.click(screen.getByRole('button', { name: '解散舰队' }));
    expect(mockClient.cmdFleetDisband).toHaveBeenCalledWith('fleet-1');
    expect(useStarmapViewStore.getState().selectedFleetId).toBeNull();
  });
});
