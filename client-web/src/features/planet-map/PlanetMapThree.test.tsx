import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getFixtureScenario } from '@/fixtures';
import { PlanetMapThree } from './PlanetMapThree';
import { resetPlanetViewStore, usePlanetViewStore } from './store';

vi.mock('./planet-three-scene', () => ({
  PlanetThreeScene: class {
    constructor() { throw new Error('WebGL unavailable'); }
  },
}));

afterEach(() => { cleanup(); resetPlanetViewStore(); });

describe('3D 地图降级与交互退出', () => {
  it('WebGL 不可用时显示降级说明，焦点在地图外时 Escape 仍退出建造', () => {
    render(<><button>地图外工作台</button><PlanetMapThree planet={getFixtureScenario('baseline').planets['planet-1-1']} /></>);
    expect(screen.getByRole('alert')).toHaveTextContent('切换到平面战术');
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'wind_turbine', direction: 'auto' }));
    const external = screen.getByRole('button', { name: '地图外工作台' });
    external.focus();
    fireEvent.keyDown(external, { key: 'Escape' });
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');
    expect(screen.queryByRole('button', { name: '取消建造 · Esc' })).not.toBeInTheDocument();
  });

  it('右键地图退出移动模式', () => {
    render(<PlanetMapThree planet={getFixtureScenario('baseline').planets['planet-1-1']} />);
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'move', unitId: 'u-6' }));
    fireEvent.contextMenu(screen.getByRole('application', { name: '3D 行星地图' }));
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');
  });
});
