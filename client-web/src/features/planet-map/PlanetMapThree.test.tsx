import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getFixtureScenario } from '@/fixtures';
import { PlanetMapThree } from './PlanetMapThree';
import { resetPlanetViewStore, usePlanetViewStore } from './store';

// 捕获场景构造时注册的点击回调，让测试能直接喂 tile（jsdom 里没有 WebGL 拾取）。
let onClick: ((tile: { x: number; y: number }) => void) | undefined;
let onHover: ((tile: { x: number; y: number }) => void) | undefined;

vi.mock('./planet-three-scene', () => ({
  PlanetThreeScene: class {
    constructor(
      _host: HTMLElement,
      click: (tile: { x: number; y: number }) => void,
      hover: (tile: { x: number; y: number }) => void,
    ) {
      onClick = click;
      onHover = hover;
    }
    setData() {}
    setQuality() {}
    setInteraction() {}
    focus() {}
    orbit() {}
    zoom() {}
    setTilt() {}
    pickAt() { return null; }
    getCenterTile() { return null; }
    project() { return null; }
    capture() { return null; }
    handleBattleEvent() {}
    destroy() {}
  },
}));

afterEach(() => {
  cleanup();
  resetPlanetViewStore();
  onClick = undefined;
  onHover = undefined;
});

describe('3D 地图降级与交互退出', () => {
  it('WebGL 不可用时显示降级说明，焦点在地图外时 Escape 仍退出建造', () => {
    render(<><button>地图外工作台</button><PlanetMapThree planet={getFixtureScenario('baseline').planets['planet-1-1']} /></>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'wind_turbine', direction: 'auto' }));
    const external = screen.getByRole('button', { name: '地图外工作台' });
    external.focus();
    fireEvent.keyDown(external, { key: 'Escape' });
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');
    expect(screen.queryByRole('button', { name: '取消建造 · Esc' })).not.toBeInTheDocument();
  });

  it('右键地图退出移动模式', () => {
    render(<PlanetMapThree planet={getFixtureScenario('baseline').planets['planet-1-1']} />);
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'move' }));
    fireEvent.contextMenu(screen.getByRole('application', { name: '3D 行星地图' }));
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');
  });
});

describe('3D 地图点击语义（迷雾/资源）', () => {
  const renderMap = (onInteractTile?: (tile: { x: number; y: number }) => void) => {
    const scenario = getFixtureScenario('baseline');
    render(<PlanetMapThree fog={scenario.fogByPlanet['planet-1-1']} onInteractTile={onInteractTile} planet={scenario.planets['planet-1-1']} />);
    return scenario.planets['planet-1-1'];
  };

  it('点矿石：选中资源并显示信息，不把镜头推进未探索区', () => {
    renderMap();
    act(() => onClick?.({ x: 5, y: 4 }));
    expect(usePlanetViewStore.getState().selected).toMatchObject({ kind: 'resource', id: 'copper-1' });
    expect(usePlanetViewStore.getState().focusRequest).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('点未探索空格：不移动镜头，改为提示未探索', () => {
    renderMap();
    act(() => onClick?.({ x: 12, y: 12 }));
    expect(usePlanetViewStore.getState().selected).toBeNull();
    expect(usePlanetViewStore.getState().focusRequest).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('该区域尚未探索');
  });

  it('不可见格子上有实体时优先选中实体（不聚焦镜头）', () => {
    renderMap();
    // baseline 里 (6,4) 是 explored 但不可见，上面有敌方单位 enemy-1
    act(() => onClick?.({ x: 6, y: 4 }));
    expect(usePlanetViewStore.getState().focusRequest).toBeNull();
    expect(usePlanetViewStore.getState().selected).toMatchObject({ kind: 'unit', id: 'enemy-1' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('已探索但当前不可见的空格：(1,5) 只提示未探索', () => {
    renderMap();
    act(() => onClick?.({ x: 1, y: 5 }));
    expect(usePlanetViewStore.getState().focusRequest).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('该区域尚未探索');
  });

  it('建造模式下点未探索格：不聚焦镜头，照常下达建造命令（由服务端判定，试玩 1009 F）', () => {
    const onInteractTile = vi.fn();
    renderMap(onInteractTile);
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'wind_turbine', direction: 'auto' }));
    act(() => onClick?.({ x: 12, y: 12 }));
    expect(onInteractTile).toHaveBeenCalledWith({ x: 12, y: 12 });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(usePlanetViewStore.getState().focusRequest).toBeNull();
  });
});
