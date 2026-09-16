import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Building, BuildingFractionationState, BuildingSprayCoaterState } from '@shared/types';
import { ProcessingStatus } from './ProcessingStatus';

const fractionation: BuildingFractionationState = {
  input_buffer: [{ item_id: 'hydrogen', quantity: 6 }], hydrogen_buffer: null, deuterium_buffer: 2,
  buffer_capacity: 24, throughput: 6, input_direction: 'west', hydrogen_direction: 'east', deuterium_direction: 'south',
  state: 'running', attempts: 121, converted: 2, returned_hydrogen: 119, last_process_tick: 40, last_probability: .02, last_spray_level: 3, rng_state: 123,
};
const coater: BuildingSprayCoaterState = {
  input_buffer: null, output_buffer: [{ item_id: 'hydrogen', quantity: 4, spray: { level: 3, remaining_uses: 1 } }],
  buffer_capacity: 24, throughput: 6, input_direction: 'west', output_direction: 'east', reagent_direction: 'north',
  state: 'running', coated_items: 7, consumed_proliferator: 1, last_spray_tick: 40, spray_item_id: 'proliferator_mk3', spray_units: 53, spray_effect: { level: 3, remaining_uses: 1 },
};

describe('processing machine status', () => {
  it('shows authoritative per-attempt probability and changes to blocked without pretending production continues', () => {
    const { rerender } = render(<ProcessingStatus building={{ fractionation } as Building} />);
    expect(screen.getByRole('region', { name: '分馏运行状态' })).toHaveTextContent('2.00% · 喷涂 3 级');
    expect(screen.getByText('6 / 24')).toBeInTheDocument();
    expect(screen.getByText('西进氢 · 东出氢 · 南出重氢')).toBeInTheDocument();
    rerender(<ProcessingStatus building={{ fractionation: { ...fractionation, state: 'blocked', hydrogen_buffer: [{ item_id: 'hydrogen', quantity: 24 }] } } as Building} />);
    expect(screen.getByText('出口堵塞')).toBeInTheDocument();
    expect(screen.queryByText('正在分馏')).not.toBeInTheDocument();
    expect(screen.getByText('24 / 24')).toBeInTheDocument();
  });
  it('shows real coater dose remainder, and distinguishes reagent exhaustion from loss of power', () => {
    const { rerender } = render(<ProcessingStatus building={{ spray_coater: coater } as Building} />);
    expect(screen.getByText('53 · 3 级')).toBeInTheDocument();
    expect(screen.getByText('西进物料 · 东出物料 · 北进增产剂')).toBeInTheDocument();
    rerender(<ProcessingStatus building={{ spray_coater: { ...coater, state: 'no_proliferator', spray_units: 0 } } as Building} />);
    expect(screen.getByText('无增产剂 · 物料直通')).toBeInTheDocument();
    rerender(<ProcessingStatus building={{ spray_coater: { ...coater, state: 'no_power' } } as Building} />);
    expect(screen.getByText('供电不足')).toBeInTheDocument();
    expect(screen.queryByText('无增产剂 · 物料直通')).not.toBeInTheDocument();
  });
});
