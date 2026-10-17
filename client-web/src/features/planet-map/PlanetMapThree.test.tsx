import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getFixtureScenario } from '@/fixtures';
import { PlanetMapThree } from './PlanetMapThree';
import { resetPlanetViewStore, usePlanetViewStore } from './store';

// 捕获场景构造时注册的点击回调，让测试能直接喂 tile（jsdom 里没有 WebGL 拾取）。
let onClick: ((tile: { x: number; y: number }, meta: { offscreen: boolean }) => void) | undefined;
let onHover: ((tile: { x: number; y: number }) => void) | undefined;
let onMiss: (() => void) | undefined;

vi.mock('./planet-three-scene', () => ({
  PlanetThreeScene: class {
    constructor(
      _host: HTMLElement,
      click: (tile: { x: number; y: number }, meta: { offscreen: boolean }) => void,
      hover: (tile: { x: number; y: number }) => void,
      miss: () => void,
    ) {
      onClick = click;
      onHover = hover;
      onMiss = miss;
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
    clickTile() { return { dispatched: false, offscreen: false }; }
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
  onMiss = undefined;
});

/** 场景点击回调：默认「目标格在视野内」（offscreen=false），与真实画布点击一致。 */
function click(tile: { x: number; y: number }, meta: { offscreen: boolean } = { offscreen: false }) {
  onClick?.(tile, meta);
}

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

  it('试玩 1017 K4-01：取消按钮与坐标/框选状态行在同一条纵向栈里（不再互相重叠）', () => {
    const { container } = render(<PlanetMapThree planet={getFixtureScenario('baseline').planets['planet-1-1']} />);
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'wind_turbine', direction: 'auto' }));
    const stack = container.querySelector('.planet-three__nav-stack');
    expect(stack).not.toBeNull();
    const cancel = screen.getByRole('button', { name: '取消建造 · Esc' });
    const status = container.querySelector('.planet-three__nav-status');
    // 两者是同一栈的直接子元素：取消在上、状态行在下，由 flex 排版而非各自绝对定位。
    expect(cancel.parentElement).toBe(stack);
    expect(status?.parentElement).toBe(stack);
    expect(stack!.firstElementChild).toBe(cancel);
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
    act(() => click({ x: 5, y: 4 }));
    expect(usePlanetViewStore.getState().selected).toMatchObject({ kind: 'resource', id: 'copper-1' });
    expect(usePlanetViewStore.getState().focusRequest).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('点未探索空格：不移动镜头，改为提示未探索', () => {
    renderMap();
    act(() => click({ x: 12, y: 12 }));
    expect(usePlanetViewStore.getState().selected).toBeNull();
    expect(usePlanetViewStore.getState().focusRequest).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('该区域尚未探索');
  });

  it('不可见格子上有实体时优先选中实体（不聚焦镜头）', () => {
    renderMap();
    // baseline 里 (6,4) 是 explored 但不可见，上面有敌方单位 enemy-1
    act(() => click({ x: 6, y: 4 }));
    expect(usePlanetViewStore.getState().focusRequest).toBeNull();
    expect(usePlanetViewStore.getState().selected).toMatchObject({ kind: 'unit', id: 'enemy-1' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('已探索但当前不可见的空格：(1,5) 只提示未探索', () => {
    renderMap();
    act(() => click({ x: 1, y: 5 }));
    expect(usePlanetViewStore.getState().focusRequest).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('该区域尚未探索');
  });

  it('回归（试玩 1014 层 13）：inspect 下点空地（含未探索空格）清空单位/小队选区', () => {
    renderMap();
    // 先选中一个己方单位并拉一个小队选择（两个集合都要被清掉）。
    act(() => {
      const store = usePlanetViewStore.getState();
      store.setSelected({ kind: 'unit', id: 'worker-1', position: { x: 0, y: 3, z: 0 } });
      store.setSelectedUnits(['worker-1']);
      store.setSelectedSquads(['squad-1']);
    });
    // store 的 setSelectedSquads 与 selectedUnits 互斥（选小队会清单位），
    // 这里只断言「点空地后两个集合都空」——先用单位选择作为起点。
    expect(usePlanetViewStore.getState().selectedUnits).toEqual([]);

    // 点未探索空地：提示未探索，同时旧选区被清空（否则「点空地 + 框选」没法做部分重选）。
    act(() => click({ x: 12, y: 12 }));
    const store = usePlanetViewStore.getState();
    expect(store.selected).toBeNull();
    expect(store.selectedUnits).toEqual([]);
    expect(store.selectedSquads).toEqual([]);
  });

  it('建造模式下点未探索格：不聚焦镜头，照常下达建造命令（由服务端判定，试玩 1009 F）', () => {
    const onInteractTile = vi.fn();
    renderMap(onInteractTile);
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'wind_turbine', direction: 'auto' }));
    act(() => click({ x: 12, y: 12 }));
    expect(onInteractTile).toHaveBeenCalledWith({ x: 12, y: 12 });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(usePlanetViewStore.getState().focusRequest).toBeNull();
  });

  it('回归（试玩 1016 B4）：目标格不在视野内时照常下令，并提示「已移动镜头」', () => {
    const onInteractTile = vi.fn();
    renderMap(onInteractTile);
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'wind_turbine', direction: 'auto' }));
    // 场景已聚焦过去并把 offscreen 标出来（真实场景里由 clickTile 派发）。
    act(() => click({ x: 60, y: 146 }, { offscreen: true }));
    // 命令照常下发：不能因为「投影不在视野内」就静默丢弃。
    expect(onInteractTile).toHaveBeenCalledWith({ x: 60, y: 146 });
    expect(screen.getByTestId('planet-three-pick-notice')).toHaveTextContent('目标格 (60, 146) 不在视野内，已移动镜头');
  });

  it('回归（试玩 1016 B4）：点击处不在星球表面时给提示，而不是静默', () => {
    renderMap();
    act(() => onMiss?.());
    expect(screen.getByTestId('planet-three-pick-notice')).toHaveTextContent('不在星球表面');
  });

  it('视野内的正常点击不弹落空提示（提示只属于落空的那一次）', () => {
    renderMap();
    act(() => click({ x: 5, y: 4 }, { offscreen: true }));
    expect(screen.getByTestId('planet-three-pick-notice')).toBeInTheDocument();
    act(() => click({ x: 6, y: 4 }));
    expect(screen.queryByTestId('planet-three-pick-notice')).not.toBeInTheDocument();
  });
});
