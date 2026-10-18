import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getFixtureScenario } from '@/fixtures';
import { PlanetMapThree } from './PlanetMapThree';
import { resetPlanetViewStore, usePlanetViewStore } from './store';

// 捕获场景构造时注册的点击回调，让测试能直接喂 tile（jsdom 里没有 WebGL 拾取）。
let onClick: ((tile: { x: number; y: number }, meta: { offscreen: boolean; buildingId?: string }) => void) | undefined;
/** 拖拽铺带：测试直接喂 pickAt 的返回值与 setBeltDragPath 的入参。 */
let pickResult: { x: number; y: number } | null = null;
let dragPaths: ({ tile: { x: number; y: number }; direction: string; elevation: number }[] | null)[] = [];
let onHover: ((tile: { x: number; y: number }) => void) | undefined;
let onMiss: (() => void) | undefined;
/** +/- 缩放键：记录场景收到的 zoom 倍率。 */
let zoomCalls: number[] = [];

vi.mock('./planet-three-scene', () => ({
  PlanetThreeScene: class {
    constructor(
      _host: HTMLElement,
      click: (tile: { x: number; y: number }, meta: { offscreen: boolean; buildingId?: string }) => void,
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
    zoom(factor: number) { zoomCalls.push(factor); }
    getCenterTile() { return { x: 4, y: 4 }; }
    setTilt() {}
    pickAt() { return pickResult; }
    setBeltDragPath(path: ({ tile: { x: number; y: number }; direction: string; elevation: number }[] | null)) { dragPaths.push(path); }
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
  pickResult = null;
  dragPaths = [];
  zoomCalls = [];
});

/** 场景点击回调：默认「目标格在视野内」（offscreen=false），与真实画布点击一致。 */
function click(tile: { x: number; y: number }, meta: { offscreen: boolean; buildingId?: string } = { offscreen: false }) {
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


describe('3D 地图点选高架带（第 19 轮 §3.5）', () => {
  it('onPick 带 buildingId 时直接选中该建筑（优先于按格找地面建筑）', () => {
    const scenario = getFixtureScenario('baseline');
    const planet = scenario.planets['planet-1-1'];
    const ground = Object.values(planet.buildings ?? {})[0]!;
    // 在地面建筑同格放一条高架带（场景侧命中它时给 buildingId）。
    const high = {
      ...ground,
      id: 'belt-high',
      type: 'conveyor_belt_mk1',
      position: { x: ground.position.x, y: ground.position.y, z: 0 },
      conveyor: { input: 'west', output: 'east', elevation: 2 },
    };
    planet.buildings = { ...(planet.buildings ?? {}), 'belt-high': high as never };
    render(<PlanetMapThree planet={planet} />);
    act(() => click({ x: Math.round(ground.position.x), y: Math.round(ground.position.y) }, { offscreen: false, buildingId: 'belt-high' }));
    expect(usePlanetViewStore.getState().selected).toMatchObject({ kind: 'building', id: 'belt-high' });
  });

  it('buildingAtTile 只认地面层（高架带不覆盖地面占用）', async () => {
    const { buildingAtTile } = await import('./use-planet-interactions');
    const planet = getFixtureScenario('baseline').planets['planet-1-1'];
    const ground = Object.values(planet.buildings ?? {})[0]!;
    const tile = { x: Math.round(ground.position.x), y: Math.round(ground.position.y) };
    const high = { ...ground, id: 'belt-high', type: 'conveyor_belt_mk1', conveyor: { input: 'west', output: 'east', elevation: 2 } };
    // 只有高架带：按格找不到建筑
    expect(buildingAtTile({ ...planet, buildings: { 'belt-high': high as never } } as never, tile)).toBeUndefined();
    // 地面建筑 + 高架带：返回地面建筑
    expect(buildingAtTile({ ...planet, buildings: { ...(planet.buildings ?? {}), 'belt-high': high as never } } as never, tile)?.id).toBe(ground.id);
  });
});


describe('3D 拖拽铺带逐格高度（第 19 轮 §3.5）', () => {
  // jsdom 没有 PointerEvent：用 MouseEvent 补一个（fireEvent.pointer* 会优先用它，
  // 否则 button/clientX 都不会写进事件，React 处理器拿到的 button 是 undefined）。
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', PointerEventPolyfill);
  });

  function drag(host: HTMLElement, type: 'pointerDown' | 'pointerMove' | 'pointerUp', init: Record<string, unknown> = {}) {
    // jsdom 没有 Pointer Events 的捕获 API；拖拽处理器会调用它们。
    const target = host as HTMLElement & { setPointerCapture?: () => void; releasePointerCapture?: () => void; hasPointerCapture?: () => boolean };
    target.setPointerCapture = () => {};
    target.releasePointerCapture = () => {};
    target.hasPointerCapture = () => true;
    // jsdom 没有 PointerEvent 构造器：用 MouseEvent 派发 pointer* 事件并带上 pointerId。
    const fire = (fireEvent as unknown as Record<string, (el: HTMLElement, init: object) => void>)[type];
    fire(host, { button: 0, pointerId: 1, clientX: 0, clientY: 0, ...init });
  }

  it('第一格接现成上游带的高度；直行每格 ±1 走向目标；松手逐格带 elevation 下单', () => {
    const scenario = getFixtureScenario('baseline');
    const planet = scenario.planets['planet-1-1'];
    // 在 (3,3) 放一条地面带，输出方向 east → 拖拽起点 (4,3) 接 0 层。
    planet.buildings = {
      ...(planet.buildings ?? {}),
      'belt-up': {
        id: 'belt-up', type: 'conveyor_belt_mk1', owner_id: 'p1',
        position: { x: 3, y: 3, z: 0 }, hp: 100, max_hp: 100, level: 1, vision_range: 0,
        runtime: { params: { footprint: { width: 1, height: 1 } }, state: 'running' },
        conveyor: { input: 'west', output: 'east', elevation: 0 },
      } as never,
    };
    const onInteractTile = vi.fn();
    const { container } = render(<PlanetMapThree fog={scenario.fogByPlanet['planet-1-1']} onInteractTile={onInteractTile} planet={planet} />);
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'conveyor_belt_mk1', direction: 'east', elevation: 2 }));
    const host = container.querySelector('.planet-three') as HTMLElement;


    pickResult = { x: 4, y: 3 };
    drag(host, 'pointerDown');
    expect(dragPaths.at(-1)).toEqual([{ tile: { x: 4, y: 3 }, direction: 'east', elevation: 0 }]);

    // 拖到 (6,3)：中间经过 (5,3)，两格直行 → 0→1→2。
    pickResult = { x: 6, y: 3 };
    drag(host, 'pointerMove');
    const preview = dragPaths.at(-1)!;
    expect(preview.map(part => part.tile)).toEqual([{ x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 }]);
    expect(preview.map(part => part.elevation)).toEqual([0, 1, 2]);

    // 拖拽中把目标高度降回 0：整条路径重新结算（后续格子自动落坡）。
    act(() => {
      const mode = usePlanetViewStore.getState().interactionMode;
      if (mode.kind === 'build') usePlanetViewStore.getState().setInteractionMode({ ...mode, elevation: 0 });
    });
    // 松手时按当前目标高度结算：0, 0（直行每格 -1），第三格仍是 0。
    drag(host, 'pointerUp');
    const calls = onInteractTile.mock.calls.map(([tile, placement]) => ({ tile, ...placement }));
    expect(calls).toEqual([
      { tile: { x: 4, y: 3 }, direction: 'east', elevation: 0 },
      { tile: { x: 5, y: 3 }, direction: 'east', elevation: 0 },
      { tile: { x: 6, y: 3 }, direction: 'east', elevation: 0 },
    ]);
  });

  /** 造一条「己方地面带 output north，正对着 tile 输出」的 fixture 记录。 */
  function upstreamNorthBelt(tile: { x: number; y: number }, ownerId = 'p1') {
    return {
      id: 'belt-up',
      type: 'conveyor_belt_mk1',
      owner_id: ownerId,
      position: { x: tile.x, y: tile.y + 1, z: 0 },
      hp: 100,
      max_hp: 100,
      level: 1,
      vision_range: 0,
      runtime: { params: { footprint: { width: 1, height: 1 } }, state: 'running' },
      conveyor: { input: 'south', output: 'north', elevation: 0 },
    } as never;
  }

  it('B1 单击建带（未拖拽）用 interactionMode.direction，而不是硬编码 east', () => {
    const scenario = getFixtureScenario('baseline');
    const planet = scenario.planets['planet-1-1'];
    const onInteractTile = vi.fn();
    const { container } = render(<PlanetMapThree fog={scenario.fogByPlanet['planet-1-1']} onInteractTile={onInteractTile} planet={planet} />);
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'conveyor_belt_mk1', direction: 'north' }));
    const host = container.querySelector('.planet-three') as HTMLElement;

    pickResult = { x: 3, y: 3 };
    drag(host, 'pointerDown');
    drag(host, 'pointerUp');

    expect(onInteractTile).toHaveBeenCalledTimes(1);
    expect(onInteractTile.mock.calls[0]).toEqual([{ x: 3, y: 3 }, { direction: 'north', elevation: 0 }]);
  });

  it('B1 单击且朝向为 auto 时不覆盖 direction（保持原 placeBelt 口径：由建造模式决定）', () => {
    const scenario = getFixtureScenario('baseline');
    const planet = scenario.planets['planet-1-1'];
    const onInteractTile = vi.fn();
    const { container } = render(<PlanetMapThree fog={scenario.fogByPlanet['planet-1-1']} onInteractTile={onInteractTile} planet={planet} />);
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'conveyor_belt_mk1', direction: 'auto' }));
    const host = container.querySelector('.planet-three') as HTMLElement;

    pickResult = { x: 3, y: 3 };
    drag(host, 'pointerDown');
    drag(host, 'pointerUp');

    expect(onInteractTile).toHaveBeenCalledTimes(1);
    expect(onInteractTile.mock.calls[0]).toEqual([{ x: 3, y: 3 }, { elevation: 0 }]);
  });

  it('B1 北向拖拽：第一格取首段方向并接上游带，其后直行每格 +1（不推迟一格）', () => {
    const scenario = getFixtureScenario('baseline');
    const planet = scenario.planets['planet-1-1'];
    // 上游带在 (4,4) 朝北输出 → 起点 (4,3) 接它的 0 层。
    planet.buildings = { 'belt-up': upstreamNorthBelt({ x: 4, y: 3 }) };
    const onInteractTile = vi.fn();
    const { container } = render(<PlanetMapThree fog={scenario.fogByPlanet['planet-1-1']} onInteractTile={onInteractTile} planet={planet} />);
    // 建造模式朝向故意给 east：拖拽第一格必须取实际首段方向（north），否则高度会推迟一格。
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'conveyor_belt_mk1', direction: 'east', elevation: 2 }));
    const host = container.querySelector('.planet-three') as HTMLElement;

    pickResult = { x: 4, y: 3 };
    drag(host, 'pointerDown');
    pickResult = { x: 4, y: 1 };
    drag(host, 'pointerMove');

    const preview = dragPaths.at(-1)!;
    expect(preview.map(part => part.tile)).toEqual([{ x: 4, y: 3 }, { x: 4, y: 2 }, { x: 4, y: 1 }]);
    expect(preview.map(part => part.direction)).toEqual(['north', 'north', 'north']);
    // 第一格 0（接上游），之后直行每格 +1 走向目标 2 层。
    expect(preview.map(part => part.elevation)).toEqual([0, 1, 2]);

    drag(host, 'pointerUp');
    const calls = onInteractTile.mock.calls.map(([tile, placement]) => ({ tile, ...placement }));
    expect(calls).toEqual([
      { tile: { x: 4, y: 3 }, direction: 'north', elevation: 0 },
      { tile: { x: 4, y: 2 }, direction: 'north', elevation: 1 },
      { tile: { x: 4, y: 1 }, direction: 'north', elevation: 2 },
    ]);
  });

  it('B2 拖拽中按 Esc：清空预览且松手不下单', () => {
    const scenario = getFixtureScenario('baseline');
    const planet = scenario.planets['planet-1-1'];
    const onInteractTile = vi.fn();
    const { container } = render(<PlanetMapThree fog={scenario.fogByPlanet['planet-1-1']} onInteractTile={onInteractTile} planet={planet} />);
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'conveyor_belt_mk1', direction: 'east', elevation: 2 }));
    const host = container.querySelector('.planet-three') as HTMLElement;

    pickResult = { x: 3, y: 3 };
    drag(host, 'pointerDown');
    pickResult = { x: 6, y: 3 };
    drag(host, 'pointerMove');
    expect(dragPaths.at(-1)?.length).toBe(4);

    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    expect(dragPaths.at(-1)).toBeNull();

    drag(host, 'pointerUp');
    expect(onInteractTile).not.toHaveBeenCalled();
  });

  it('B2 拖拽中右键：清空预览且松手不下单', () => {
    const scenario = getFixtureScenario('baseline');
    const planet = scenario.planets['planet-1-1'];
    const onInteractTile = vi.fn();
    const { container } = render(<PlanetMapThree fog={scenario.fogByPlanet['planet-1-1']} onInteractTile={onInteractTile} planet={planet} />);
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'conveyor_belt_mk1', direction: 'east', elevation: 2 }));
    const host = container.querySelector('.planet-three') as HTMLElement;

    pickResult = { x: 3, y: 3 };
    drag(host, 'pointerDown');
    pickResult = { x: 6, y: 3 };
    drag(host, 'pointerMove');
    expect(dragPaths.at(-1)?.length).toBe(4);

    act(() => { fireEvent.contextMenu(host); });
    expect(dragPaths.at(-1)).toBeNull();

    // 右键抬起（button 2）不得下单：handleMarqueeUp 只响应左键。
    drag(host, 'pointerUp', { button: 2 });
    expect(onInteractTile).not.toHaveBeenCalled();
  });

  it('B2 拖拽中右键抬起（button 2）不下单，左键抬起才下单', () => {
    const scenario = getFixtureScenario('baseline');
    const planet = scenario.planets['planet-1-1'];
    const onInteractTile = vi.fn();
    const { container } = render(<PlanetMapThree fog={scenario.fogByPlanet['planet-1-1']} onInteractTile={onInteractTile} planet={planet} />);
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'conveyor_belt_mk1', direction: 'east' }));
    const host = container.querySelector('.planet-three') as HTMLElement;

    pickResult = { x: 3, y: 3 };
    drag(host, 'pointerDown');
    drag(host, 'pointerUp', { button: 2 });
    expect(onInteractTile).not.toHaveBeenCalled();

    drag(host, 'pointerUp');
    expect(onInteractTile).toHaveBeenCalledTimes(1);
  });

  it('B3 回拖到已有格：路径截断到该格，不追加反向格，每格只下一次单', () => {
    const scenario = getFixtureScenario('baseline');
    const planet = scenario.planets['planet-1-1'];
    const onInteractTile = vi.fn();
    const { container } = render(<PlanetMapThree fog={scenario.fogByPlanet['planet-1-1']} onInteractTile={onInteractTile} planet={planet} />);
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'conveyor_belt_mk1', direction: 'east' }));
    const host = container.querySelector('.planet-three') as HTMLElement;

    pickResult = { x: 3, y: 3 };
    drag(host, 'pointerDown');
    pickResult = { x: 6, y: 3 };
    drag(host, 'pointerMove');
    expect(dragPaths.at(-1)!.map(part => part.tile)).toEqual([{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 }]);

    // 往回拖到 (4,3)：截断到该格（DSP 拖带往回拖是缩短），不追加反向格。
    pickResult = { x: 4, y: 3 };
    drag(host, 'pointerMove');
    expect(dragPaths.at(-1)!.map(part => part.tile)).toEqual([{ x: 3, y: 3 }, { x: 4, y: 3 }]);
    // 截断处的方向 = 从上一格进入它的方向（仍是 east）：不能照抄回拖的反向笔迹，
    // 否则 (3,3) 与 (4,3) 会互相指向、带子在两格间打转。
    expect(dragPaths.at(-1)!.map(part => part.direction)).toEqual(['east', 'east']);

    // 再往前拖到 (5,3)：只补回新增格，路径按格去重。
    pickResult = { x: 5, y: 3 };
    drag(host, 'pointerMove');
    expect(dragPaths.at(-1)!.map(part => part.tile)).toEqual([{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }]);

    drag(host, 'pointerUp');
    const tiles = onInteractTile.mock.calls.map(([tile]) => `${tile.x},${tile.y}`);
    expect(tiles).toEqual(['3,3', '4,3', '5,3']);
    expect(new Set(tiles).size).toBe(tiles.length);
  });

  it('B3 回拖后转向：截断处方向刷新成实际前进方向，路径保持连通', () => {
    const scenario = getFixtureScenario('baseline');
    const planet = scenario.planets['planet-1-1'];
    const onInteractTile = vi.fn();
    const { container } = render(<PlanetMapThree fog={scenario.fogByPlanet['planet-1-1']} onInteractTile={onInteractTile} planet={planet} />);
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'conveyor_belt_mk1', direction: 'east' }));
    const host = container.querySelector('.planet-three') as HTMLElement;

    pickResult = { x: 3, y: 3 };
    drag(host, 'pointerDown');
    pickResult = { x: 6, y: 3 };
    drag(host, 'pointerMove');
    // 回拖到 (4,3) 再向北到 (4,1)：旧实现会把 (4,3) 留在 east，指向已截掉的 (5,3)。
    pickResult = { x: 4, y: 3 };
    drag(host, 'pointerMove');
    pickResult = { x: 4, y: 1 };
    drag(host, 'pointerMove');

    const preview = dragPaths.at(-1)!;
    expect(preview.map(part => part.tile)).toEqual([{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 2 }, { x: 4, y: 1 }]);
    expect(preview.map(part => part.direction)).toEqual(['east', 'north', 'north', 'north']);

    drag(host, 'pointerUp');
    const calls = onInteractTile.mock.calls.map(([tile, placement]) => ({ tile, ...placement }));
    expect(calls).toEqual([
      { tile: { x: 3, y: 3 }, direction: 'east', elevation: 0 },
      { tile: { x: 4, y: 3 }, direction: 'north', elevation: 0 },
      { tile: { x: 4, y: 2 }, direction: 'north', elevation: 0 },
      { tile: { x: 4, y: 1 }, direction: 'north', elevation: 0 },
    ]);
  });

  it('B5 单击 auto 方向 + 目标高度 > 0：用建造模式 rotation 推出明确方向（服务端要求）', () => {
    const scenario = getFixtureScenario('baseline');
    const planet = scenario.planets['planet-1-1'];
    const onInteractTile = vi.fn();
    const { container } = render(<PlanetMapThree fog={scenario.fogByPlanet['planet-1-1']} onInteractTile={onInteractTile} planet={planet} />);
    // rotation 90 = 东（ROTATION_FACING 锚点与服务端 SorterFacing 一致）。
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'conveyor_belt_mk1', direction: 'auto', rotation: 90, elevation: 2 }));
    const host = container.querySelector('.planet-three') as HTMLElement;

    pickResult = { x: 3, y: 3 };
    drag(host, 'pointerDown');
    drag(host, 'pointerUp');

    expect(onInteractTile).toHaveBeenCalledTimes(1);
    expect(onInteractTile.mock.calls[0]).toEqual([{ x: 3, y: 3 }, { direction: 'east', elevation: 2 }]);
  });

  it('L4 拖拽中改目标高度（PageUp/PageDown）：不移动指针也立刻按新目标重算预览', () => {
    const scenario = getFixtureScenario('baseline');
    const planet = scenario.planets['planet-1-1'];
    // (2,3) 的己方地面带向东输出 → 起点 (3,3) 从 0 层起（固定起始高度，断言才有确定值）。
    planet.buildings = {
      ...(planet.buildings ?? {}),
      'belt-up': {
        id: 'belt-up', type: 'conveyor_belt_mk1', owner_id: 'p1',
        position: { x: 2, y: 3, z: 0 }, hp: 100, max_hp: 100, level: 1, vision_range: 0,
        runtime: { params: { footprint: { width: 1, height: 1 } }, state: 'running' },
        conveyor: { input: 'west', output: 'east', elevation: 0 },
      } as never,
    };
    const onInteractTile = vi.fn();
    const { container } = render(<PlanetMapThree fog={scenario.fogByPlanet['planet-1-1']} onInteractTile={onInteractTile} planet={planet} />);
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'conveyor_belt_mk1', direction: 'east' }));
    const host = container.querySelector('.planet-three') as HTMLElement;

    pickResult = { x: 3, y: 3 };
    drag(host, 'pointerDown');
    pickResult = { x: 6, y: 3 };
    drag(host, 'pointerMove');
    expect(dragPaths.at(-1)!.map(part => part.elevation)).toEqual([0, 0, 0, 0]);

    // PageUp ×2（= adjustBuildElevation(+1)）：指针不动，预览整条立刻起坡。
    act(() => { usePlanetViewStore.getState().adjustBuildElevation(1); });
    act(() => { usePlanetViewStore.getState().adjustBuildElevation(1); });
    expect(dragPaths.at(-1)!.map(part => part.elevation)).toEqual([0, 1, 2, 2]);

    // PageDown：落坡同样立刻生效。
    act(() => { usePlanetViewStore.getState().adjustBuildElevation(-1); });
    expect(dragPaths.at(-1)!.map(part => part.elevation)).toEqual([0, 1, 1, 1]);

    // 松手仍按当前目标高度整条结算（预览与下单同口径）。
    drag(host, 'pointerUp');
    const calls = onInteractTile.mock.calls.map(([, placement]) => placement.elevation);
    expect(calls).toEqual([0, 1, 1, 1]);
  });
});

describe('3D 状态行（R20-A ②）', () => {
  const scenario = () => getFixtureScenario('baseline');

  it('选中建筑/单位/小队时显示与 2D 同一套选中文案', () => {
    const { container } = render(<PlanetMapThree planet={scenario().planets['planet-1-1']} />);
    act(() => usePlanetViewStore.getState().setSelected({ kind: 'building', id: 'smelter-1', position: { x: 3, y: 3, z: 0 } }));
    const status = container.querySelector('.planet-three__nav-status')!;
    expect(status).toHaveTextContent('建筑 smelter-1');
    act(() => usePlanetViewStore.getState().setSelected({ kind: 'unit', id: 'worker-1', position: { x: 0, y: 3, z: 0 } }));
    expect(status).toHaveTextContent('单位 worker-1');
    act(() => usePlanetViewStore.getState().setSelected({ kind: 'squad', id: 'squad-1', position: { x: 0, y: 3, z: 0 } }));
    expect(status).toHaveTextContent('小队 squad-1');
  });

  it('建造/战区模式提示与 2D 文案逐字一致；框选数与小队数各有提示', () => {
    const { container } = render(<PlanetMapThree planet={scenario().planets['planet-1-1']} />);
    const status = container.querySelector('.planet-three__nav-status')!;
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'build', buildingType: 'wind_turbine', direction: 'auto' }));
    expect(status).toHaveTextContent('建造模式：点击放置 · 右键/Esc 取消');
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'theater_zone', theaterId: 'th-1', zoneType: 'primary' }));
    expect(status).toHaveTextContent('战区划定：主战区 · 左键拖拽矩形画出区域 · 右键/Esc 退出');
    expect(status.querySelector('.planet-three__nav-status-line--zone')).not.toBeNull();
    act(() => usePlanetViewStore.getState().setSelectedUnits(['a', 'b']));
    expect(status).toHaveTextContent('已框选 2 个单位');
    act(() => usePlanetViewStore.getState().setSelectedSquads(['squad-1', 'squad-2']));
    expect(status).toHaveTextContent('已选 2 个小队');
  });

  it('没有悬停/选中/模式时状态行不留空壳', () => {
    const { container } = render(<PlanetMapThree planet={scenario().planets['planet-1-1']} />);
    expect(container.querySelector('.planet-three__nav-status')?.childElementCount).toBe(0);
  });
});

describe('3D 缩放快捷键与 Esc（R20-A ④）', () => {
  it('+ / = 放大，- 缩小；输入框聚焦时不抢按键', () => {
    render(<><input aria-label="聊天输入" /><PlanetMapThree planet={getFixtureScenario('baseline').planets['planet-1-1']} /></>);
    fireEvent.keyDown(window, { key: '+' });
    fireEvent.keyDown(window, { key: '=' });
    fireEvent.keyDown(window, { key: '-' });
    expect(zoomCalls).toEqual([1.4, 1.4, 1 / 1.4]);
    const input = screen.getByLabelText('聊天输入');
    input.focus();
    fireEvent.keyDown(input, { key: '+' });
    expect(zoomCalls).toHaveLength(3);
  });

  it('Esc 在 inspect 模式同时清空小队选择与单位/选中', () => {
    render(<PlanetMapThree planet={getFixtureScenario('baseline').planets['planet-1-1']} />);
    act(() => {
      const store = usePlanetViewStore.getState();
      store.setSelected({ kind: 'squad', id: 'squad-1', position: { x: 0, y: 3, z: 0 } });
      store.setSelectedSquads(['squad-1', 'squad-2']);
    });
    expect(usePlanetViewStore.getState().selectedSquads).toEqual(['squad-1', 'squad-2']);
    fireEvent.keyDown(window, { key: 'Escape' });
    const store = usePlanetViewStore.getState();
    expect(store.selectedSquads).toEqual([]);
    expect(store.selected).toBeNull();
  });
});

describe('3D 战区拖拽（R20-A ③）', () => {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', PointerEventPolyfill);
  });

  function drag(host: HTMLElement, type: 'pointerDown' | 'pointerMove' | 'pointerUp', init: Record<string, unknown> = {}) {
    const target = host as HTMLElement & { setPointerCapture?: () => void; releasePointerCapture?: () => void; hasPointerCapture?: () => boolean };
    target.setPointerCapture = () => {};
    target.releasePointerCapture = () => {};
    target.hasPointerCapture = () => true;
    const fire = (fireEvent as unknown as Record<string, (el: HTMLElement, init: object) => void>)[type];
    fire(host, { button: 0, pointerId: 1, clientX: 0, clientY: 0, ...init });
  }

  it('左键拖矩形：拖拽中出预览，松手按两角格子换算圆心+半径', () => {
    const onDefineZone = vi.fn();
    const { container } = render(<PlanetMapThree onDefineZone={onDefineZone} planet={getFixtureScenario('baseline').planets['planet-1-1']} />);
    const host = container.querySelector('.planet-three') as HTMLElement;
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'theater_zone', theaterId: 'th-1', zoneType: 'primary' }));

    pickResult = { x: 10, y: 20 };
    drag(host, 'pointerDown', { clientX: 100, clientY: 100 });
    pickResult = { x: 30, y: 40 };
    drag(host, 'pointerMove', { clientX: 200, clientY: 180 });
    expect(screen.getByTestId('planet-three-zone-rect')).toBeInTheDocument();
    drag(host, 'pointerUp', { clientX: 200, clientY: 180 });

    // 圆心 = 两角中点，半径 = 半宽/半高取大（theaterZoneFromDragRect 同口径）。
    expect(onDefineZone).toHaveBeenCalledWith({ position: { x: 20, y: 30, z: 0 }, radius: 10 });
    expect(screen.queryByTestId('planet-three-zone-rect')).not.toBeInTheDocument();
    // 划定模式保持（可连续画多个区域，与 2D 一致）。
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('theater_zone');
  });

  it('没拖动（单击）不定义战区；Esc 清预览并退出模式', () => {
    const onDefineZone = vi.fn();
    const { container } = render(<PlanetMapThree onDefineZone={onDefineZone} planet={getFixtureScenario('baseline').planets['planet-1-1']} />);
    const host = container.querySelector('.planet-three') as HTMLElement;
    act(() => usePlanetViewStore.getState().setInteractionMode({ kind: 'theater_zone', theaterId: 'th-1', zoneType: 'primary' }));
    pickResult = { x: 5, y: 5 };
    drag(host, 'pointerDown', { clientX: 10, clientY: 10 });
    drag(host, 'pointerUp', { clientX: 11, clientY: 11 });
    expect(onDefineZone).not.toHaveBeenCalled();

    drag(host, 'pointerDown', { clientX: 10, clientY: 10 });
    drag(host, 'pointerMove', { clientX: 90, clientY: 90 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');
    expect(screen.queryByTestId('planet-three-zone-rect')).not.toBeInTheDocument();
  });
});

describe('__planetThree 测试接口（R20-A ⑤）', () => {
  it('暴露 tileScreenPos/entityScreenPos/clickTile/dragTiles，坐标是页面 CSS 像素', async () => {
    const { getFixtureScenario } = await import('@/fixtures');
    const scenario = getFixtureScenario('baseline');
    render(<PlanetMapThree planet={scenario.planets['planet-1-1']} />);
    const api = (window as unknown as { __planetThree?: Record<string, unknown> }).__planetThree;
    // vitest 里 import.meta.env.DEV 为真 → 测试钩子暴露。
    expect(api).toBeTruthy();
    for (const name of ['tileScreenPos', 'entityScreenPos', 'clickTile', 'dragTiles']) {
      expect(typeof api![name]).toBe('function');
    }
    // 场景实例的方法经原型继承保留（对象展开会把类方法全丢掉，试玩 1020 实测）。
    expect(typeof api!.getCenterTile).toBe('function');
    expect(typeof api!.focus).toBe('function');
    expect(typeof api!.zoom).toBe('function');
    // 场景 mock 的 project 返回 null → 接口给 null（而不是抛错）。
    expect((api!.tileScreenPos as (t: { x: number; y: number }) => unknown)({ x: 1, y: 1 })).toBeNull();
  });
});
