/**
 * 3D 行星地图状态行与键位（第 20 轮 R20-A ②④）的纯逻辑。
 *
 * 文案与 2D 的 `.planet-map-canvas__status`（PlanetMapPixi.tsx）逐字对齐：
 * 2D 退役后玩家只看到 3D，状态行必须补回选中文案、小队/战区/建造等模式提示，
 * 否则「现在是什么模式、选了什么」在 3D 下没有任何可见反馈。
 * 放在纯函数里便于单测（jsdom 里渲染整个 3D 组件只能看到 DOM，不好逐条断言）。
 */

import { selectionLabel, type SelectedEntity } from './model';
import { theaterZoneTypeLabel } from './squad-commands';
import type { PlanetLayerVisibility } from './model';
import type { PlanetInteractionMode } from './store';

export interface PlanetThreeStatusInput {
  /** 悬停格坐标（无悬停时为 null）。 */
  hoveredTile: { x: number; y: number } | null;
  selected: SelectedEntity | null;
  selectedUnits: readonly string[];
  selectedSquads: readonly string[];
  interactionMode: PlanetInteractionMode;
  /** 地面视角下的缩放档文案（`缩放 16px/cell` 一类）。 */
  zoomLabel?: string;
}

export interface PlanetThreeStatusLine {
  /** 稳定 key（React 列表/测试用），同时对应 2D 的 CSS 类语义。 */
  key: 'hover' | 'zoom' | 'selection' | 'mode' | 'units' | 'squads';
  text: string;
  /** 与 2D 相同的语义色调修饰：attack 红、zone 青。 */
  tone?: 'attack' | 'zone';
}

/**
 * 交互模式提示：与 2D 状态行同一套文案（建造/移动/攻击/单位指令/战区/运输）。
 * inspect 模式没有提示行。
 */
export function interactionModeStatusText(mode: PlanetInteractionMode): { text: string; tone?: 'attack' | 'zone' } | null {
  switch (mode.kind) {
    case 'build':
      return { text: '建造模式：点击放置 · 右键/Esc 取消' };
    case 'move':
      return { text: '移动模式：点击目标点 · 右键/Esc 取消' };
    case 'attack':
      return { text: '攻击模式：点击目标 · 右键/Esc 取消', tone: 'attack' };
    case 'unit_order':
      return {
        text: `${mode.order === 'attack_move' ? '攻击移动：点击目标点（沿途交战）' : mode.order === 'patrol' ? '巡逻：点击巡逻目标点' : '守卫：点击要守卫的目标'} · 右键/Esc 取消`,
        tone: 'attack',
      };
    case 'theater_zone':
      return {
        text: `战区划定：${theaterZoneTypeLabel(mode.zoneType)} · 左键拖拽矩形画出区域 · 右键/Esc 退出`,
        tone: 'zone',
      };
    case 'haul':
      return { text: `设置运输：${mode.fromBuildingId ? '已选起点，点击终点建筑' : '点击起点建筑'} · 右键/Esc 取消` };
    case 'squad_order':
      return { text: `小队指令：${mode.order === 'attack' ? '攻击' : mode.order === 'defend' ? '防守' : '撤退'} · 点击目标点 · 右键/Esc 取消` };
    case 'inspect':
    default:
      return null;
  }
}

/**
 * 状态行的全部条目（顺序与 2D 一致：缩放 → 悬停 → 选中 → 模式 → 框选 → 小队）。
 * 空条目（没有悬停、没有选中且没进入任何模式）不返回，状态行不留空壳。
 */
export function buildPlanetThreeStatus(input: PlanetThreeStatusInput): PlanetThreeStatusLine[] {
  const lines: PlanetThreeStatusLine[] = [];
  if (input.zoomLabel) lines.push({ key: 'zoom', text: input.zoomLabel });
  if (input.hoveredTile) lines.push({ key: 'hover', text: `Hover (${input.hoveredTile.x}, ${input.hoveredTile.y})` });
  // 选中文案：2D 无条件显示（「未选中对象」也是信息），3D 只在真有选中时显示，
  // 否则一行「未选中对象」常驻在左下角，反而盖住坐标/提示。
  if (input.selected) lines.push({ key: 'selection', text: selectionLabel(input.selected) });
  const mode = interactionModeStatusText(input.interactionMode);
  if (mode) lines.push({ key: 'mode', text: mode.text, tone: mode.tone });
  if (input.selectedUnits.length > 1) {
    lines.push({ key: 'units', text: `已框选 ${input.selectedUnits.length} 个单位 · Shift+拖动框选 · 右键移动/攻击` });
  }
  if (input.selectedSquads.length > 0) {
    lines.push({ key: 'squads', text: `已选 ${input.selectedSquads.length} 个小队 · 右键点地部署任务群` });
  }
  return lines;
}

/** 缩放快捷键（+/-）：输入框/文本域/下拉/可编辑元素聚焦时不抢按键。 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable;
}

/** +/- 键 → 3D 缩放倍率（null = 不是缩放键）。`=` 与 `+` 同键（US 键盘 Shift+=）。
 *  带 Ctrl/Meta/Alt 的组合键不抢（浏览器缩放 / 系统快捷键优先）。 */
export function zoomFactorForKey(key: string, event?: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>): number | null {
  if (event && (event.ctrlKey || event.metaKey || event.altKey)) return null;
  if (key === '+' || key === '=') return 1.4;
  if (key === '-' || key === '_') return 1 / 1.4;
  return null;
}

/**
 * 测试接口的屏幕坐标换算（R20-A ⑤）：场景的 `project` 返回相对宿主画布左上角的
 * CSS 像素，测试要的是**页面**坐标（Playwright 的 `locator.click({position})`
 * 也是相对元素）。这里把宿主元素的位置补上。
 */
export function toPagePoint(
  offset: { left: number; top: number },
  point: { x: number; y: number },
): { x: number; y: number } {
  return { x: offset.left + point.x, y: offset.top + point.y };
}

/** 拖动修饰键：Shift 框选 / Ctrl（元键）加选。 */
export interface DragModifiers {
  shift?: boolean;
  ctrl?: boolean;
}

/**
 * 测试接口的方法绑定（R20-A ①）：`Object.create(target)` 会让外部调用 `focus()/zoom()/setTilt()`
 * 时 this 指向包装对象，真实场景状态不变。这里遍历场景原型链，把函数 `.bind(target)` 挂到返回对象上。
 */
export function bindSceneMethods<T extends object>(target: T): Record<string, unknown> {
  const bound: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (
    let proto: object | null = Object.getPrototypeOf(target);
    proto && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto)
  ) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || seen.has(name)) continue;
      seen.add(name);
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (descriptor && typeof descriptor.value === 'function') {
        bound[name] = descriptor.value.bind(target);
      }
    }
  }
  return bound;
}

/**
 * 3D 相机状态（R20-A ④ / ⑥）：scene 的 `getCameraState()` 由 R20-B 提供；
 * 本分支按「有就调用、没有就退化」写——没有时用 `getCenterTile()` + 组件自己的 tilt 兜底。
 */
export interface PlanetThreeCameraState {
  center: { x: number; y: number } | null;
  /** 相机高度（zoom 量纲）；scene 没有该接口时为 null（不是 0，避免伪造）。 */
  altitude: number | null;
  tilt: number;
  /** 是否地面视角；scene 没暴露时按 altitude 推断，再退化到 true。 */
  groundView: boolean;
}

interface CameraStateSource {
  getCameraState?: () => {
    center?: { x: number; y: number } | null;
    altitude?: number;
    zoom?: number;
    tilt?: number;
    groundView?: boolean;
  } | null;
  getCenterTile?: () => { x: number; y: number } | null;
  isGroundView?: () => boolean;
}

/**
 * 读取相机状态：优先 `scene.getCameraState()`；没有该方法时退化为
 * `getCenterTile()` + 当前 tilt（altitude 记 null）。
 */
export function readPlanetThreeCameraState(
  scene: CameraStateSource | null | undefined,
  tiltFallback: number,
): PlanetThreeCameraState {
  const state = typeof scene?.getCameraState === 'function' ? scene.getCameraState() : null;
  const center = state?.center
    ?? (typeof scene?.getCenterTile === 'function' ? scene.getCenterTile() : null)
    ?? null;
  const altitudeRaw = state?.altitude ?? state?.zoom;
  const altitude = typeof altitudeRaw === 'number' && Number.isFinite(altitudeRaw) ? altitudeRaw : null;
  const tilt = typeof state?.tilt === 'number' && Number.isFinite(state.tilt) ? state.tilt : tiltFallback;
  const groundView = typeof state?.groundView === 'boolean'
    ? state.groundView
    : typeof scene?.isGroundView === 'function'
      ? scene.isGroundView()
      : altitude === null || altitude < 130;
  return {
    center: center ? { x: center.x, y: center.y } : null,
    altitude,
    tilt,
    groundView,
  };
}

/**
 * 状态行缩放档文案：只有拿到相机高度（scene 有 `getCameraState`）时显示，
 * 否则省略（null）。档位与导航列一致：贴地 / 近景 / 全球。
 */
export function cameraZoomLabel(altitude: number | null | undefined): string | null {
  if (typeof altitude !== 'number' || !Number.isFinite(altitude)) return null;
  const level = altitude >= 190 ? '全球' : altitude >= 60 ? '近景' : '贴地';
  return `缩放 ${level} · 高度 ${altitude.toFixed(1)}`;
}

/** 深链 `tilt` 参数解析：非法/缺失时回落到当前值（分享链接再打开要回到同一俯仰）。 */
export function parseTiltParam(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1.1, Math.max(0, value));
}

/**
 * 拖动矩形松手时，Shift 框选要选中的单位：投影落在屏幕矩形内、且属于当前玩家的单位。
 * 纯函数（输入投影结果），jsdom 单测可直接覆盖；与真实场景同一套判定
 * （PlanetMapThree 的 handleMarqueeUp 用的就是它）。
 */
export function unitsInScreenRect(
  units: ReadonlyArray<{ id: string; ownerId: string; screen: { x: number; y: number } | null }>,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
): string[] {
  return units
    .filter((unit) => unit.screen
      && unit.screen.x >= rect.minX && unit.screen.x <= rect.maxX
      && unit.screen.y >= rect.minY && unit.screen.y <= rect.maxY)
    .map((unit) => unit.id)
    .sort();
}

/**
 * 3D 图层可见性 → 场景 setInteraction 的入参（R20-A ④，scene 只读）。
 *
 * 3D 里不是独立图层的项在这里收敛：
 * - `terrain` 在 3D 与测绘面纱同一张贴图（面板在 3D 下不显示这个开关）；
 * - `fog` 的测绘面纱由 `three/terrain.ts` 着色器负责，scene 目前没有面纱开关方法
 *   （已列为需要 R20-B/主代理协调的接口，见报告）；这里先原样透传，不伪造效果。
 * - `selection`/`grid` 等其余键直接透传（scene 的 groupByLayer 会按同名分组消费）。
 */
export function sceneLayerVisibility(layers: PlanetLayerVisibility): PlanetLayerVisibility {
  return { ...layers, terrain: true };
}
