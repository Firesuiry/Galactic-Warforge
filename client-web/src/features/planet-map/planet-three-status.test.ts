import { describe, expect, it } from 'vitest';

import { bindSceneMethods, buildPlanetThreeStatus, cameraZoomLabel, groundViewAtAltitude, interactionModeStatusText, isTypingTarget, parseTiltParam, readPlanetThreeCameraState, toPagePoint, unitsInScreenRect, zoomFactorForKey } from './planet-three-status';

describe('interactionModeStatusText（与 2D 状态行逐字一致）', () => {
  it.each([
    [{ kind: 'build', buildingType: 'wind_turbine', direction: 'auto' } as const, '建造模式：点击放置 · 右键/Esc 取消'],
    [{ kind: 'move' } as const, '移动模式：点击目标点 · 右键/Esc 取消'],
    [{ kind: 'attack' } as const, '攻击模式：点击目标 · 右键/Esc 取消'],
    [{ kind: 'unit_order', order: 'attack_move' } as const, '攻击移动：点击目标点（沿途交战） · 右键/Esc 取消'],
    [{ kind: 'unit_order', order: 'patrol' } as const, '巡逻：点击巡逻目标点 · 右键/Esc 取消'],
    [{ kind: 'unit_order', order: 'guard' } as const, '守卫：点击要守卫的目标 · 右键/Esc 取消'],
    [{ kind: 'theater_zone', theaterId: 'th', zoneType: 'no_entry' } as const, '战区划定：禁入区 · 左键拖拽矩形画出区域 · 右键/Esc 退出'],
    [{ kind: 'haul' } as const, '设置运输：点击起点建筑 · 右键/Esc 取消'],
    [{ kind: 'haul', fromBuildingId: 'b1' } as const, '设置运输：已选起点，点击终点建筑 · 右键/Esc 取消'],
  ])('%j → %s', (mode, text) => {
    expect(interactionModeStatusText(mode)?.text).toBe(text);
  });

  it('inspect 没有模式提示；攻击/单位指令/战区带语义色调', () => {
    expect(interactionModeStatusText({ kind: 'inspect' })).toBeNull();
    expect(interactionModeStatusText({ kind: 'attack' })?.tone).toBe('attack');
    expect(interactionModeStatusText({ kind: 'unit_order', order: 'patrol' })?.tone).toBe('attack');
    expect(interactionModeStatusText({ kind: 'theater_zone', theaterId: 't', zoneType: 'rally' })?.tone).toBe('zone');
    expect(interactionModeStatusText({ kind: 'build', buildingType: 'x', direction: 'auto' })?.tone).toBeUndefined();
  });
});

describe('buildPlanetThreeStatus', () => {
  const base = {
    hoveredTile: null,
    selected: null,
    selectedUnits: [],
    selectedSquads: [],
    interactionMode: { kind: 'inspect' } as const,
  };

  it('顺序与 2D 一致：缩放 → 悬停 → 选中 → 模式 → 框选 → 小队', () => {
    const lines = buildPlanetThreeStatus({
      ...base,
      zoomLabel: '缩放 16px/cell',
      hoveredTile: { x: 7, y: 9 },
      selected: { kind: 'building', id: 'b-1', position: { x: 7, y: 9, z: 0 } },
      interactionMode: { kind: 'build', buildingType: 'wind_turbine', direction: 'auto' },
      selectedUnits: ['u1', 'u2'],
      selectedSquads: ['s1'],
    });
    expect(lines.map(line => line.key)).toEqual(['zoom', 'hover', 'selection', 'mode', 'units', 'squads']);
    expect(lines.map(line => line.text)).toEqual([
      '缩放 16px/cell',
      'Hover (7, 9)',
      '建筑 b-1',
      '建造模式：点击放置 · 右键/Esc 取消',
      '已框选 2 个单位 · Shift+拖动框选 · 右键移动/攻击',
      '已选 1 个小队 · 右键点地部署任务群',
    ]);
  });

  it('空状态（无悬停/选中/模式）返回空数组，状态行不留空壳', () => {
    expect(buildPlanetThreeStatus(base)).toEqual([]);
  });

  it('单单位选择只显示选中文案，不显示框选数（与 2D 的 >1 口径一致）', () => {
    const lines = buildPlanetThreeStatus({
      ...base,
      selected: { kind: 'unit', id: 'u1', position: { x: 1, y: 2, z: 0 } },
      selectedUnits: ['u1'],
    });
    expect(lines.map(line => line.key)).toEqual(['selection']);
  });
});

describe('isTypingTarget / zoomFactorForKey', () => {
  it('输入框、文本域、下拉与可编辑元素都不抢键', () => {
    const make = (tag: string, editable = false) => {
      const element = document.createElement(tag);
      Object.defineProperty(element, 'isContentEditable', { value: editable });
      return element;
    };
    expect(isTypingTarget(make('input'))).toBe(true);
    expect(isTypingTarget(make('textarea'))).toBe(true);
    expect(isTypingTarget(make('select'))).toBe(true);
    expect(isTypingTarget(make('div', true))).toBe(true);
    expect(isTypingTarget(make('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('+ / = 放大 1.4 倍，- / _ 缩小 1/1.4，其它键返回 null', () => {
    expect(zoomFactorForKey('+')).toBe(1.4);
    expect(zoomFactorForKey('=')).toBe(1.4);
    expect(zoomFactorForKey('-')).toBeCloseTo(1 / 1.4);
    expect(zoomFactorForKey('_')).toBeCloseTo(1 / 1.4);
    expect(zoomFactorForKey('PageUp')).toBeNull();
  });

  it('Ctrl/Meta/Alt 组合键不抢缩放（留给浏览器/系统快捷键）', () => {
    expect(zoomFactorForKey('+', { ctrlKey: true, metaKey: false, altKey: false })).toBeNull();
    expect(zoomFactorForKey('-', { ctrlKey: false, metaKey: true, altKey: false })).toBeNull();
    expect(zoomFactorForKey('=', { ctrlKey: false, metaKey: false, altKey: true })).toBeNull();
    expect(zoomFactorForKey('+', { ctrlKey: false, metaKey: false, altKey: false })).toBe(1.4);
  });
});

describe('3D 相机状态读取（R20-A ⑥）', () => {
  it('读取 scene.getCameraState（中心格/高度/俯仰/地面视角）', () => {
    const state = readPlanetThreeCameraState({
      getCameraState: () => ({ center: { x: 12, y: 30 }, altitude: 8.5, zoom: 8.5, tilt: 0.4, groundView: true }),
    });
    expect(state).toEqual({ center: { x: 12, y: 30 }, altitude: 8.5, tilt: 0.4, groundView: true });
  });

  it('groundViewAtAltitude：>190 全球、<130 贴地、中间保持原状态（与 zoom 同一套阈值）', () => {
    expect(groundViewAtAltitude(300, true)).toBe(false);
    expect(groundViewAtAltitude(8, false)).toBe(true);
    expect(groundViewAtAltitude(160, true)).toBe(true);
    expect(groundViewAtAltitude(160, false)).toBe(false);
    expect(groundViewAtAltitude(190, true)).toBe(true);
    expect(groundViewAtAltitude(130, false)).toBe(false);
  });

  it('zoomLabel 档位；深链 tilt 解析做范围夹取', () => {
    expect(cameraZoomLabel(8.46)).toBe('缩放 贴地 · 高度 8.5');
    expect(cameraZoomLabel(80)).toContain('近景');
    expect(cameraZoomLabel(220)).toContain('全球');
    expect(parseTiltParam(null, 0.65)).toBe(0.65);
    expect(parseTiltParam('abc', 0.65)).toBe(0.65);
    expect(parseTiltParam('0.4', 0.65)).toBe(0.4);
    expect(parseTiltParam('9', 0.65)).toBe(1.1);
  });
});

describe('bindSceneMethods（R20-A ①）', () => {
  it('原型方法绑定到真实实例：focus/zoom 改的是 target 的字段', () => {
    class Fake {
      ground = false;
      altitude = 100;
      focus() { this.ground = true; }
      zoom(f: number) { this.altitude /= f; }
    }
    const target = new Fake();
    const bound = bindSceneMethods(target);
    (bound.focus as () => void)();
    (bound.zoom as (f: number) => void)(4);
    expect(target.ground).toBe(true);
    expect(target.altitude).toBe(25);
  });
});

describe('测试接口换算（R20-A ⑤）', () => {
  it('toPagePoint 把画布内坐标补上宿主元素偏移', () => {
    expect(toPagePoint({ left: 40, top: 120 }, { x: 10, y: 5 })).toEqual({ x: 50, y: 125 });
  });

  it('unitsInScreenRect 只收屏幕矩形内、投影可见的单位，按 id 排序', () => {
    const units = [
      { id: 'b', ownerId: 'p1', screen: { x: 50, y: 50 } },
      { id: 'a', ownerId: 'p1', screen: { x: 60, y: 40 } },
      { id: 'out', ownerId: 'p1', screen: { x: 500, y: 500 } },
      { id: 'hidden', ownerId: 'p1', screen: null },
    ];
    expect(unitsInScreenRect(units, { minX: 0, minY: 0, maxX: 100, maxY: 100 })).toEqual(['a', 'b']);
    // 边界包含（与框选判定一致）。
    expect(unitsInScreenRect(units, { minX: 50, minY: 50, maxX: 50, maxY: 50 })).toEqual(['b']);
    expect(unitsInScreenRect(units, { minX: 0, minY: 0, maxX: 10, maxY: 10 })).toEqual([]);
  });
});
