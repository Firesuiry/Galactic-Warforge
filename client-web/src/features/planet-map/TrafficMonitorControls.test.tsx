import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Building } from '@shared/types';
import { TrafficMonitorControls } from './TrafficMonitorControls';
import { usePlanetCommandStore } from '@/features/planet-commands/store';
const { client } = vi.hoisted(() => ({ client: { cmdConfigureTrafficMonitor: vi.fn(), fetchEventSnapshot: vi.fn() } }));
vi.mock('@/hooks/use-api-client', () => ({ useApiClient: () => client }));
const monitor: Building = { hp: 100, max_hp: 100, level: 1, vision_range: 4, runtime: { params: { energy_consume: 1, energy_generate: 0, capacity: 0, maintenance_cost: { minerals: 0, energy: 0 }, footprint: { width: 1, height: 1 } }, functions: {}, state: 'running' }, id: 'monitor', type: 'traffic_monitor', owner_id: 'p1', position: { x: 5, y: 5, z: 0 },
  traffic_monitor: { target_belt_id: 'belt', window_ticks: 10, minimum_items_per_tick: .5, alerts_enabled: true,
    state: 'blocked', samples: [], sample_count: 10, window_items: 0, items_per_tick: 0, total_items: 24, last_sample_tick: 30, alert_active: true } };
const belt = { id: 'belt', type: 'conveyor_belt_mk1', owner_id: 'p1', position: { x: 6, y: 5, z: 0 } } as Building;
const buildings = [monitor, belt, { ...belt, id: 'enemy', owner_id: 'p2' }, { ...belt, id: 'far', position: { x: 8, y: 5, z: 0 } }];
function props(building = monitor, canControl = true) { return { building, buildings, faceSize: 16, planetId: 'planet-1-1', canControl }; }
beforeEach(() => {
  vi.clearAllMocks();
  client.cmdConfigureTrafficMonitor.mockResolvedValue({ request_id: 'monitor-config', accepted: false, enqueue_tick: 0, results: [] });
  usePlanetCommandStore.getState().resetForPlanet('planet-1-1');
});
it('shows measured blockage and only adjacent owned belt candidates', () => {
  render(<TrafficMonitorControls {...props()} />);
  expect(screen.getByRole('status')).toHaveTextContent('积货且无物料流出');
  expect(screen.getByText('0 / 24 件')).toBeInTheDocument();
  expect(screen.getAllByRole('option').map(o => (o as HTMLOptionElement).value)).toEqual(['', 'belt']);
});
it('submits complete config, keeps draft across samples and can unbind', async () => {
  const view = render(<TrafficMonitorControls {...props()} />);
  fireEvent.change(screen.getByLabelText('采样窗口'), { target: { value: '20' } });
  view.rerender(<TrafficMonitorControls {...props({ ...monitor, traffic_monitor: { ...monitor.traffic_monitor!, total_items: 35 } })} />);
  expect(screen.getByLabelText('采样窗口')).toHaveValue(20);
  fireEvent.change(screen.getByLabelText('监测传送带'), { target: { value: '' } });
  fireEvent.click(screen.getByLabelText('启用流量告警'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '应用监测设置' })); });
  expect(client.cmdConfigureTrafficMonitor).toHaveBeenCalledWith('monitor', { target_belt_id: '', window_ticks: 20, minimum_items_per_tick: .5, alerts_enabled: false });
  expect(usePlanetCommandStore.getState().journal[0].commandType).toBe('configure_traffic_monitor');
});
it('guards invalid windows, negative thresholds and foreign edits', async () => {
  const view = render(<TrafficMonitorControls {...props()} />);
  for (const [label, value] of [['采样窗口', '0'], ['采样窗口', '1.5'], ['采样窗口', '601'], ['最低流量', '-1'], ['最低流量', '61']]) {
    fireEvent.change(screen.getByLabelText('采样窗口'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const button = screen.getByRole('button', { name: '应用监测设置' });
    expect(button).toBeDisabled();
    await act(async () => { fireEvent.submit(button.closest('form')!); });
  }
  expect(client.cmdConfigureTrafficMonitor).not.toHaveBeenCalled();
  view.rerender(<TrafficMonitorControls {...props(monitor, false)} />);
  expect(screen.getByLabelText('监测传送带')).toBeDisabled();
  expect(screen.queryByRole('button', { name: '应用监测设置' })).toBeNull();
});
