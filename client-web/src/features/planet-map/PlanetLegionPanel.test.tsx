import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CombatSquad, Unit } from '@shared/types';

import { PlanetLegionLayer } from '@/features/planet-map/PlanetLegionLayer';
import { PlanetLegionPanel } from '@/features/planet-map/PlanetLegionPanel';
import { resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';
import { useSessionStore } from '@/stores/session';

const { mockClient, submitMock } = vi.hoisted(() => ({
  mockClient: {
    cmdFormSquad: vi.fn(),
    cmdSquadOrder: vi.fn(),
    cmdDissolveSquad: vi.fn(),
    fetchEventSnapshot: vi.fn(),
  },
  submitMock: vi.fn((input: { execute: () => Promise<unknown> }) => input.execute()),
}));
vi.mock('@/hooks/use-api-client', () => ({ useApiClient: () => mockClient }));
vi.mock('@/features/planet-commands/executor', () => ({
  submitPlanetCommand: (input: { execute: () => Promise<unknown> }) => submitMock(input),
}));

const unit = (id: string, extra: Partial<Unit> = {}) =>
  ({ id, type: 'soldier', owner_id: 'p1', position: { x: 2, y: 2, z: 0 }, hp: 10, max_hp: 10, ...extra }) as Unit;
const units = { s1: unit('s1'), s2: unit('s2', { combat_state: 'no_ammunition' }), s3: unit('s3') };
const legion = {
  id: 'sq-1', owner_id: 'p1', planet_id: 'pl', name: '先锋', member_ids: ['s2', 's3'], state: 'idle',
  order: 'attack', target: { x: 8, y: 8, z: 0 }, position: { x: 2, y: 2, z: 0 },
} as CombatSquad;

describe('PlanetLegionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPlanetViewStore();
    useSessionStore.getState().setSession({ serverUrl: 'http://x', playerId: 'p1', playerKey: 'k' });
    for (const fn of [mockClient.cmdFormSquad, mockClient.cmdSquadOrder, mockClient.cmdDissolveSquad]) {
      fn.mockResolvedValue({ accepted: true });
    }
  });

  it('无军团且无可编队单位时不渲染', () => {
    const { container } = render(<PlanetLegionPanel planetId="pl" squads={[]} units={units} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('选中未编队单位 → 编成军团（form_squad，含名称）', async () => {
    const user = userEvent.setup();
    usePlanetViewStore.getState().setSelectedUnits(['s1']);
    render(<PlanetLegionPanel planetId="pl" squads={[]} units={units} />);
    await user.type(screen.getByLabelText('军团名称'), '突击队');
    await user.click(screen.getByRole('button', { name: /编成军团/ }));
    expect(mockClient.cmdFormSquad).toHaveBeenCalledWith(['s1'], '突击队', 'pl');
  });

  it('军团列表：一键选中成员、缺弹提示、补给优先、解散、进攻进入选点模式', async () => {
    const user = userEvent.setup();
    render(<PlanetLegionPanel planetId="pl" squads={[legion]} units={units} />);
    expect(screen.getByRole('alert')).toHaveTextContent('1 个单位弹药耗尽');

    await user.click(screen.getByRole('button', { name: /先锋/ }));
    expect(usePlanetViewStore.getState().selectedUnits).toEqual(['s2', 's3']);

    await user.click(screen.getByRole('button', { name: '进攻' }));
    expect(usePlanetViewStore.getState().interactionMode).toEqual({ kind: 'squad_order', squadId: 'sq-1', order: 'attack' });

    await user.click(screen.getByRole('button', { name: '补给优先' }));
    expect(mockClient.cmdSquadOrder).toHaveBeenCalledWith('sq-1', 'resupply', undefined, 'pl');

    await user.click(screen.getByRole('button', { name: '解散' }));
    expect(mockClient.cmdDissolveSquad).toHaveBeenCalledWith('sq-1', 'pl');
  });
});

describe('PlanetLegionLayer', () => {
  it('画军团标记与进攻箭头，点击选中军团', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = render(
      <PlanetLegionLayer offsetX={0} offsetY={0} onSelectLegion={onSelect} playerId="p1" squads={[legion]} tileSize={10} units={units} />,
    );
    await user.click(screen.getByRole('button', { name: '军团 先锋' }));
    expect(onSelect).toHaveBeenCalledWith(legion);
    const arrow = container.querySelector('[data-legion-arrow="sq-1"]');
    expect(arrow).toHaveAttribute('data-order', 'attack');
    expect(arrow).toHaveAttribute('x2', '85');
  });

  it('军团标签不拦截指针：标签条自身不吞事件，只有图标按钮可点', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = render(
      <PlanetLegionLayer offsetX={0} offsetY={0} onSelectLegion={onSelect} playerId="p1" squads={[legion]} tileSize={10} units={units} />,
    );
    const marker = container.querySelector('.planet-legion-marker')!;
    // 标签文字不参与命中测试（aria-hidden），点标签 = 点到标签下面的单位
    const label = marker.querySelector('.planet-legion-marker__label')!;
    expect(label).toHaveAttribute('aria-hidden', 'true');
    expect(label.textContent).toBe('先锋 · 进攻');
    // 图标按钮是唯一的可点区域：点它才选中军团
    await user.click(marker.querySelector('.planet-legion-marker__hit')!);
    expect(onSelect).toHaveBeenCalledWith(legion);
  });
});
