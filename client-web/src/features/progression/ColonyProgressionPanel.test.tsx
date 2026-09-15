import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PlanetSceneView } from '@shared/types';
import { ColonyProgressionPanel } from './ColonyProgressionPanel';

describe('ColonyProgressionPanel', () => {
  it('lets players inspect distant goals and open their actual workbench', () => {
    const onNavigate = vi.fn();
    render(<MemoryRouter><ColonyProgressionPanel catalog={{}} planet={{ planet_id: 'home', buildings: {} } as PlanetSceneView} onNavigate={onNavigate} /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: /落地与供电/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: /星际工业/ }));
    expect(screen.getByRole('tab', { name: /星际工业/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('link', { name: /配置跨星球物流/ }));
    expect(onNavigate).toHaveBeenCalledWith('/planet/home?workflow=cross_planet');
    expect(screen.getByText(/设施仅核对当前载入区域/)).toBeInTheDocument();
    expect(screen.getByText('0 / 6 阶段')).toBeInTheDocument();
  });
});
