import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Building, LogisticsStationState, PlanetRuntimeView } from '@shared/types';
import { LogisticsStationControls } from './LogisticsStationControls';

const api = vi.hoisted(() => ({ cmdInstallLogisticsVehicle: vi.fn(), cmdConfigureLogisticsStation: vi.fn(), cmdConfigureLogisticsSlot: vi.fn(), fetchEventSnapshot: vi.fn() }));
vi.mock('@/hooks/use-api-client', () => ({ useApiClient: () => api }));
vi.mock('@/features/planet-commands/executor', () => ({ submitPlanetCommand: ({ execute }: { execute: () => Promise<unknown> }) => execute() }));
const building = { id: 'station', type: 'planetary_logistics_station' } as Building;
const state: LogisticsStationState = { energy: 350, energy_capacity: 1000, charge_per_tick: 10, last_charge_tick: 3, last_charge_amount: 7,
  slot_capacity: 3, item_capacity: 200, drone_capacity: 10, priority: { input: 0, output: 0 },
  interstellar: { enabled: false, warp_enabled: false, ship_slots: 0, ship_capacity: 1000, ship_speed: 10, warp_speed: 100, warp_distance: 100, energy_per_distance: 1, warp_energy_multiplier: 3, warp_item_cost: 1 },
  settings: { iron_ore: { item_id: 'iron_ore', mode: 'supply', local_storage: 0 } }, belt_ports: { west: { mode: 'input', item_id: 'iron_ore' } } };
const props = { building, state, planetId: 'planet', canControl: true, inventory: { logistics_drone: 3 } };
beforeEach(() => { vi.clearAllMocks(); });
describe('logistics station controls', () => {
  it('shows real charge and retained cargo while waiting, with pickup return direction', () => {
    const runtime = { logistics_drones: [{ id: 'd1', station_id: 'station', status: 'waiting_unload', returning: true, trip_kind: 'pickup', cargo: { iron_ore: 40 }, remaining_ticks: 0 }] } as unknown as PlanetRuntimeView;
    render(<LogisticsStationControls {...props} runtime={runtime} />);
    expect(screen.getByText('350 / 1000')).toBeInTheDocument();
    expect(screen.getByText('7 / 10 能量/tick')).toBeInTheDocument();
    expect(screen.getByLabelText('运输器航程')).toHaveTextContent('取货 · 返航 · 等待卸货');
    expect(screen.getByLabelText('运输器航程')).toHaveTextContent('×40');
  });
  it('installs an explicit inventory quantity and rejects fractions and slot overflow', async () => {
    const user = userEvent.setup(); render(<LogisticsStationControls {...props} />);
    const input = screen.getByLabelText('安装数量');
    for (const value of ['1.5', '11', '0']) {
      await user.clear(input); await user.type(input, value);
      expect(screen.getByRole('button', { name: '安装运输器' })).toBeDisabled();
    }
    await user.clear(input); await user.type(input, '2');
    await user.click(screen.getByRole('button', { name: '安装运输器' }));
    expect(api.cmdInstallLogisticsVehicle).toHaveBeenCalledWith('station', 'logistics_drone', 2, 'player');
  });
  it('installs manufactured cargo from the station instead of requiring backpack transfer', async () => {
    const user = userEvent.setup(); render(<LogisticsStationControls {...props} state={{ ...state, inventory: { logistics_drone: 2 } }} />);
    await user.selectOptions(screen.getByLabelText('安装来源'), 'station');
    expect(screen.getByText(/站内可用：2/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '安装运输器' }));
    expect(api.cmdInstallLogisticsVehicle).toHaveBeenCalledWith('station', 'logistics_drone', 1, 'station');
  });
  it('preserves a port draft during inventory refresh, sends a full replacement and explicit empty clearing', async () => {
    const user = userEvent.setup(); const view = render(<LogisticsStationControls {...props} />);
    await user.selectOptions(screen.getByLabelText('东侧物流端口'), 'output');
    view.rerender(<LogisticsStationControls {...props} state={{ ...state, energy: 360, inventory: { iron_ore: 20 } }} />);
    expect(screen.getByLabelText('东侧物流端口')).toHaveValue('output');
    await user.click(screen.getByRole('button', { name: '应用物流接线' }));
    expect(api.cmdConfigureLogisticsStation).toHaveBeenLastCalledWith('station', { beltPorts: { west: { mode: 'input', item_id: 'iron_ore' }, east: { mode: 'output', item_id: 'iron_ore' } } });
    await user.selectOptions(screen.getByLabelText('西侧物流端口'), 'closed');
    await user.selectOptions(screen.getByLabelText('东侧物流端口'), 'closed');
    await user.click(screen.getByRole('button', { name: '应用物流接线' }));
    expect(api.cmdConfigureLogisticsStation).toHaveBeenLastCalledWith('station', { beltPorts: {} });
    await user.click(screen.getByText('移除空槽'));
    await user.click(screen.getByRole('button', { name: /移除行星空槽/ }));
    expect(api.cmdConfigureLogisticsSlot).toHaveBeenCalledWith('station', { scope: 'planetary', itemId: 'iron_ore', mode: 'none', localStorage: 0, remove: true });
  });
  it('prevents commands for other owners and while a request is pending', async () => {
    const user = userEvent.setup(); const view = render(<LogisticsStationControls {...props} canControl={false} />);
    expect(screen.queryByRole('button', { name: '安装运输器' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('西侧物流端口')).toBeDisabled();
    view.rerender(<LogisticsStationControls {...props} />);
    let resolve!: () => void;
    api.cmdInstallLogisticsVehicle.mockReturnValueOnce(new Promise<void>(r => { resolve = r; }));
    await user.click(screen.getByRole('button', { name: '安装运输器' }));
    expect(screen.getByRole('button', { name: '安装运输器' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '应用物流接线' })).toBeDisabled();
    resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: '安装运输器' })).toBeEnabled());
  });
});
