import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Building, DistributorState, PlanetRuntimeView } from '@shared/types';
import { DistributorControls } from './DistributorControls';
vi.mock('@/hooks/use-api-client', () => ({ useApiClient: () => ({}) }));
const state: DistributorState = {
  host_building_id: 'warehouse', item_id: 'motor', mode: 'supply', local_storage: 0,
  player_delivery_enabled: false, player_collection_enabled: false,
  energy: 0, energy_capacity: 1000, charge_per_tick: 10, last_charge_tick: 0, last_charge_amount: 0, range: 12, bot_capacity: 10,
};
const building = { id: 'dock', distributor: state } as Building;
function runtime(quantity: number, energy: number): PlanetRuntimeView {
  return { planet_id: 'planet', discovered: true, available: true, tick: 1, threat_level: 0, logistics_distributors: [{ building_id: 'dock', owner_id: 'p1', position: { x: 1, y: 1, z: 1 },
    host_building_id: 'warehouse', host_available: true, state: { ...state, energy }, inventory: { motor: quantity } }] } as PlanetRuntimeView;
}
it('refreshes warehouse total and charging from runtime while preserving an unsaved configuration', () => {
  const props = { building, planetId: 'planet', canControl: true };
  const { rerender } = render(<DistributorControls {...props} runtime={runtime(30, 80)} />);
  expect(screen.getByText(/· 30/)).toBeInTheDocument();
  expect(screen.getByText('80 / 1000')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('仓库保有量'), { target: { value: '7' } });
  rerender(<DistributorControls {...props} runtime={runtime(27, 90)} />);
  expect(screen.getByText(/· 27/)).toBeInTheDocument();
  expect(screen.getByText('90 / 1000')).toBeInTheDocument();
  expect(screen.getByLabelText('仓库保有量')).toHaveValue(7);
  fireEvent.change(screen.getByLabelText('机器人数量'), { target: { value: '1.5' } });
  expect(screen.getByRole('button', { name: '安装机器人' })).toBeDisabled();
});
