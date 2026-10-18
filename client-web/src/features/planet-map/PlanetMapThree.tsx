import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bug, Crosshair, Globe2, House, Layers, Minus, Plus, Settings2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { AlertEntry, CatalogView, ItemInventory, CombatSquad, FogMapView, PlanetNetworksView, PlanetOverviewView, PlanetRuntimeView, PlanetSceneView, WarTheaterView } from '@shared/types';
import type { PlanetMapCapture } from './planet-map-capture';
import { getFogState, isTileUncharted, resolveHomeTile, resolveSelectionAtTile, type PlanetRenderView, type TilePoint } from './model';
import { applyBeltStrokeStep, assignBeltElevations, isCardinalDirection, resolveBeltStartElevation, type BeltElevationPlacement } from './belt-stroke';
import { DEFAULT_BELT_DIRECTION, isConveyorBeltBuilding } from './build-workflow';
import { ROTATION_FACING, rotationTurns } from './logistics-direction';
import { sameTypeOwnUnitsInView } from './rts-commands';
import { usePlanetViewStore } from './store';
import { PlanetLegionLayer } from './PlanetLegionLayer';
import { legionAliveMemberIds } from './legion-model';
import { PlanetSquadLayer } from './PlanetSquadLayer';
import { PlanetTheaterLayer } from './PlanetTheaterLayer';
import { PlanetThreeScene, type PickMeta } from './planet-three-scene';
import { theaterZoneFromDragRect, type TheaterZoneGeometry } from './squad-commands';
import { describePickNotice, offscreenPickNotice, PICK_MISS_NOTICE, type PickNotice } from './pick-feedback';
import { buildPlanetThreeStatus, isTypingTarget, toPagePoint, unitsInScreenRect, zoomFactorForKey, type DragModifiers } from './planet-three-status';
import { PlanetHoverTip } from './PlanetHoverTip';
import { useHudRailTop } from './use-hud-rail-top';
import { describeHover } from './hover-info';
import type { PlanetRenderQuality } from './three/render-quality';
import { sfx } from '@/engine/audio';
import { subscribeBattleEvents } from '@/engine/battle-events';
import { useSessionSnapshot } from '@/hooks/use-session';
import { exposeTestHook } from '@/test-hooks';

const QUALITY_STORAGE_KEY = 'siliconworld-planet-quality';
/** 点选落空提示的停留时长（ms）：一次点击的回执，不是常驻状态。 */
const PICK_NOTICE_TTL_MS = 2400;

function readQuality(): PlanetRenderQuality {
  const query = new URLSearchParams(window.location.search).get('quality');
  if (query === 'low' || query === 'balanced' || query === 'high') return query;
  try {
    const saved = localStorage.getItem(QUALITY_STORAGE_KEY);
    if (saved === 'low' || saved === 'balanced' || saved === 'high') return saved;
  } catch { /* Storage can be disabled; rendering still works. */ }
  return 'balanced';
}

interface Props {
  planet: PlanetRenderView;
  catalog?: CatalogView;
  inventory?: ItemInventory;
  /** 服务端当前仍成立的产线告警：`belt_blocked` 指向带格，画红色短杠（试玩 1016 B1）。 */
  alerts?: AlertEntry[];
  fog?: FogMapView | PlanetSceneView;
  overview?: PlanetOverviewView;
  networks?: PlanetNetworksView;
  runtime?: PlanetRuntimeView;
  theaters?: WarTheaterView[];
  onCanvasReady?: (capture: PlanetMapCapture | null) => void;
  /** 建造/指令点击；拖拽铺带时带上每格的 direction/elevation（§3.5）。 */
  onInteractTile?: (tile: TilePoint, placement?: { direction?: 'north' | 'east' | 'south' | 'west'; elevation?: number }) => void;
  /** inspect 模式右键情境指令（有批量命令下达时返回 true）。 */
  onContextTile?: (tile: TilePoint) => boolean;
  /** C4 / R20-A ③：theater_zone 模式拖拽矩形松手 → 战区圆几何（圆心+半径）。 */
  onDefineZone?: (zone: TheaterZoneGeometry) => void;
  /** 打开右侧抽屉的「选中对象」页签（与 2D 工具条的同一入口）。 */
  onSelectEntity?: () => void;
  /** 图层与视角浮层的内容（由 PlanetPage 复用 PlanetLayerPanel：与 2D 同一份勾选项）。
      传 `null` = 本视图不提供「图层与视角」入口（例如战争图之外的简化场景）。 */
  layerPanel?: ReactNode;
  /** 战区划定控件（PlanetTheaterControls）：2D 工具条在 3D 下整条不渲染，
      这个按钮改挂在 3D 自己的图标列末尾（R20-A ③，与 2D 工具条同一视觉位置）。 */
  theaterControls?: ReactNode;
  /** 黑雾是否对当前玩家敌对（summary 玩家 dark_fog.hostile）。 */
  darkFogHostile?: boolean;
}

export function PlanetMapThree(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<PlanetThreeScene | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const session = useSessionSnapshot();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [tilt, setTilt] = useState(0.65);
  const [quality, setQuality] = useState<PlanetRenderQuality>(readQuality);
  // 迷雾格点击提示：不移动镜头（移动会把场景窗口带到没有己方实体的窗口，画面变空）。
  const [fogNotice, setFogNotice] = useState<TilePoint | null>(null);
  // 点选落空提示（试玩 1016 B4）：目标格不在视野内（已聚焦过去）/ 点击处不在星球表面，
  // 都不能静默丢弃——旧实现在这两种情况下什么都没发生，玩家与驱动脚本都以为点成功了。
  const [pickNotice, setPickNotice] = useState<PickNotice | null>(null);
  // 镜头中心落在未探索区：地表只有测绘网格，给一条「回到基地」的出路（试玩 1010 D / 1011 A）。
  const [centerUncharted, setCenterUncharted] = useState(false);
  // §3.2：镜头设置（俯仰/画质）与图层收进竖排图标栏的弹出层。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const layersRef = useRef<HTMLDivElement | null>(null);
  // 底部状态行浮在这一列**上方**（与 2D 的 PlanetMapToolbar 同一变量口径）。
  const railRef = useRef<HTMLDivElement | null>(null);
  useHudRailTop(railRef, [props.layerPanel, props.onSelectEntity]);
  // Shift+左键拖动 = 屏幕矩形框选（左键拖动保持球面旋转）。
  // 拖拽铺带（第 19 轮 §3.5）：path 逐格带 direction/elevation；拖拽中按 PageUp/PageDown
  // 改目标高度时整条路径重新结算（后面的格子自动起坡/落坡），松手时一次性逐格下单。
  // 不在拖拽过程中下单：高度是「目标高度」的函数，中途下发会先在旧高度上落一批带子。
  const beltDrag = useRef<{
    tile: TilePoint;
    path: BeltElevationPlacement[];
    /** 第一格高度（接现成上游带时是上游带的高度，否则取拖拽开始时的目标高度）。 */
    startElevation: number;
    /**
     * 建造模式没给明确四向朝向（direction === 'auto'）时为 true。
     * 单格点击（没拖拽过）时方向交回建造模式——interactTile 用 `mode.direction` 兜底，
     * 与旧的 placeBelt 口径一致（试玩 1015 §6-4：auto 带子不带货，不能偷偷替玩家定方向）；
     * 目标高度 > 0 时除外（服务端要求明确方向，按 rotation 推出朝向下发）。
     */
    autoDirection: boolean;
  } | null>(null);

  /** 按当前目标高度重算整条拖拽路径（第一格高度固定，之后直行 ±1、转弯保持）。 */
  function resolveBeltDragPath(drag: NonNullable<typeof beltDrag.current>): BeltElevationPlacement[] {
    const mode = usePlanetViewStore.getState().interactionMode;
    const targetElevation = mode.kind === 'build' ? (mode.elevation ?? 0) : 0;
    return assignBeltElevations(drag.path, drag.startElevation, targetElevation);
  }
  const marqueeRef = useRef<{ startX: number; startY: number; active: boolean } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // D2 战区划定：theater_zone 模式下左键在球面拖出矩形（与 Shift 框选同一套屏幕矩形判定），
  // 松手时把两个角点拾取成格子再换算圆心+半径（与 2D 的 PlanetMapPixi 同一口径）。
  const zoneDragRef = useRef<{
    startX: number; startY: number; active: boolean;
    startTile: TilePoint | null; endTile: TilePoint | null;
  } | null>(null);
  const [zoneDragRect, setZoneDragRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const { selected, selectedUnits, selectedSquads, hoveredTile, interactionMode, layers, focusRequest, debugMode, debugOpen } = usePlanetViewStore(useShallow(s => ({
    selected: s.selected, selectedUnits: s.selectedUnits, selectedSquads: s.selectedSquads, hoveredTile: s.hoveredTile, interactionMode: s.interactionMode,
    layers: s.layers, focusRequest: s.focusRequest, debugMode: s.debugMode, debugOpen: s.debugOpen,
  })));
  // 拖拽中按 PageUp/PageDown 改目标高度：整条路径立刻按新目标重算（后面的格子自动起坡/落坡，
  // §3.5 的「拖带时调高度」手感）。结算仍然只在松手时发生，这里只刷新预览。
  const buildHeight = interactionMode.kind === 'build' ? (interactionMode.elevation ?? 0) : 0;
  useEffect(() => {
    const drag = beltDrag.current;
    if (!drag) return;
    scene.current?.setBeltDragPath(resolveBeltDragPath(drag));
    // 依赖只留 buildHeight：resolveBeltDragPath 自己从 store 读当前目标高度，beltDrag 是 ref。
  }, [buildHeight]);
  // 悬停提示：hoveredTile 已由场景节流（格子变化才更新），这里只在格子/数据变化时重算文案。
  const hoverInfo = useMemo(() => (
    hoveredTile && interactionMode.kind !== 'build'
      ? describeHover({ planet: props.planet, runtime: props.runtime, catalog: props.catalog, playerId: session.playerId, darkFogHostile: props.darkFogHostile ?? false }, hoveredTile)
      : null
  ), [hoveredTile, interactionMode.kind, props.planet, props.runtime, props.catalog, props.darkFogHostile, session.playerId]);
  const root = useRef<HTMLDivElement>(null);
  const projectTile = useCallback((tile: { x: number; y: number }) => {
    return scene.current?.project({ x: Math.round(tile.x), y: Math.round(tile.y) }) ?? null;
  }, []);
  function handleSelectSquad(squad: CombatSquad, additive: boolean) {
    const store = usePlanetViewStore.getState();
    if (squad.owner_id !== session.playerId) {
      store.setSelectedSquads([]);
      store.setSelected({ kind: 'squad', id: squad.id, position: squad.position });
      return;
    }
    if (additive) {
      const next = selectedSquads.includes(squad.id)
        ? selectedSquads.filter((id) => id !== squad.id)
        : [...selectedSquads, squad.id];
      store.setSelectedSquads(next);
      const remaining = next.length === 1
        ? props.runtime?.combat_squads?.find((candidate) => candidate.id === next[0])
        : undefined;
      store.setSelected(remaining ? { kind: 'squad', id: remaining.id, position: remaining.position } : null);
      return;
    }
    store.setSelectedSquads([squad.id]);
    store.setSelected({ kind: 'squad', id: squad.id, position: squad.position });
  }

  /** 放弃当前拖拽铺带（Esc / 右键 / 指针被取消）：清预览，不产生任何订单（B2）。 */
  const cancelBeltDrag = useCallback(() => {
    beltDrag.current = null;
    scene.current?.setBeltDragPath(null);
  }, []);

  /** 放弃战区拖拽（Esc / 右键 / 指针取消）：只清预览，不定义战区。 */
  const cancelZoneDrag = useCallback(() => {
    zoneDragRef.current = null;
    setZoneDragRect(null);
  }, []);

  useEffect(() => {
    const cancelInteraction = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // 拖拽铺带中按 Esc：先丢掉这条预览（否则松手还会按旧路径逐格下单）。
      cancelBeltDrag();
      // 战区拖拽中按 Esc：丢掉矩形预览（模式本身由下面的 exitInteractionMode 退出）。
      cancelZoneDrag();
      const store = usePlanetViewStore.getState();
      if (store.interactionMode.kind !== 'inspect') {
        store.exitInteractionMode();
        return;
      }
      // inspect 模式 Esc = 清空选择（R20-A ④：小队选择也一起清，2D 退役后不再有两套口径）
      if (store.selectedUnits.length > 0 || store.selected || store.selectedSquads.length > 0) {
        store.setSelectedUnits([]);
        store.setSelectedSquads([]);
        store.setSelected(null);
      }
    };
    window.addEventListener('keydown', cancelInteraction);
    return () => window.removeEventListener('keydown', cancelInteraction);
  }, [cancelBeltDrag, cancelZoneDrag]);

  // 缩放快捷键（R20-A ④）：+/- 走场景已有的 zoom 入口（以画面中心为锚），
  // 与导航列的 3D 放大/缩小按钮同一口径。输入框聚焦时不抢按键（与 2D 一致）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const factor = zoomFactorForKey(event.key);
      if (factor !== null) scene.current?.zoom(factor);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /** 多选落库：单选时同步 selected，多选/清空时 selected 置空（与 2D 一致）。 */
  function applyUnitSelection(ids: string[]) {
    const store = usePlanetViewStore.getState();
    store.setSelectedUnits(ids);
    if (ids.length === 1) {
      const unit = latest.current.planet.units?.[ids[0]];
      store.setSelected(unit ? { kind: 'unit', id: unit.id, position: unit.position } : null);
    } else {
      store.setSelected(null);
    }
    if (ids.length > 0) sfx.uiClick();
  }

  // 点选落空提示是「一次性回执」，2.4s 后自动消失（与迷雾提示的常驻语义不同）。
  useEffect(() => {
    if (!pickNotice) return undefined;
    const timer = window.setTimeout(() => setPickNotice(null), PICK_NOTICE_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [pickNotice]);

  useEffect(() => {
    if (!host.current) return;
    let renderer: PlanetThreeScene;
    try {
      renderer = new PlanetThreeScene(host.current, (tile, meta: PickMeta) => {
        const current = latest.current;
        const store = usePlanetViewStore.getState();
        const fog = current.fog;
        const kind = store.interactionMode.kind;
        // 测试接口 clickTile(tile, 2)（R20-A ⑤）：与右键情境指令同一条路径——
        // 非 inspect 模式先退出模式（右键语义），inspect 模式交给 onContextTile。
        if (meta.button === 2) {
          if (kind !== 'inspect') {
            store.exitInteractionMode();
            return;
          }
          current.onContextTile?.(tile);
          return;
        }
        // §3.5：命中高架带时场景给 buildingId——inspect 直接选它（地面按格兜底会选中脚下的建筑）。
        if (kind === 'inspect' && meta.buildingId) {
          const building = current.planet.buildings?.[meta.buildingId];
          store.setSelected({ kind: 'building', id: meta.buildingId, position: building?.position ?? { ...tile, z: 0 } });
          store.setSelectedUnits([]);
          store.setSelectedSquads([]);
          setFogNotice(null);
          setPickNotice(meta.offscreen ? offscreenPickNotice(tile) : null);
          return;
        }
        // 视口外目标格：场景已把镜头聚焦过去，这里补一条可见提示（试玩 1016 B4）。
        setPickNotice(meta.offscreen ? offscreenPickNotice(tile) : null);
        // 迷雾格只用于「看」和「建」，但即使不可见也要先尝试选中格上的实体（资源/建筑/单位），
        // 再决定是否聚焦——早期实现直接 requestFocus，把镜头推进未探索区，
        // 那里没有地形浮雕也没有实体，画面变成一片空白，玩家还会以为游戏崩了。
        if (kind === 'build' && fog && !getFogState(fog, tile.x, tile.y).visible) {
          // 未探索区不本地拦截：客户端没有该格地形，是否可建由服务端判定（试玩 1009 F）。
          // 照常下发建造命令，以服务端回执为准。
          setFogNotice(null);
          current.onInteractTile?.(tile);
          return;
        }
        if (kind === 'inspect' && fog && !getFogState(fog, tile.x, tile.y).visible) {
          const hidden = resolveSelectionAtTile(current.planet, tile.x, tile.y);
          if (hidden && hidden.kind !== 'tile') {
            store.setSelected(hidden);
            store.setSelectedUnits(hidden.kind === 'unit' ? [hidden.id] : []);
            store.setSelectedSquads([]);
            setFogNotice(null);
            return;
          }
          // 未探索的空格：只提示、不移动镜头，但「点空地清空选区」仍要生效——
          // 否则玩家没法用「点空地 + 框选」做部分重选（试玩 1014 层 13 问题 1：
          // 想切出 6/8 个兵，旧选区一直留着，marquee 结果总被旧选区放大成全选）。
          store.setSelected(null);
          store.setSelectedUnits([]);
          store.setSelectedSquads([]);
          setFogNotice(tile);
          return;
        }
        setFogNotice(null);
        if (store.interactionMode.kind !== 'inspect') current.onInteractTile?.(tile);
        else {
          const selection = resolveSelectionAtTile(current.planet, tile.x, tile.y, store.selected)
            ?? { kind: 'tile', position: { ...tile, z: 0 } } as const;
          store.setSelected(selection);
          // 单选单位进入多选集合（右键情境指令/快捷键的命令目标）；
          // 点空地/建筑/资源时清空单位与小队选择（与 2D 的 handleClick 同口径）。
          store.setSelectedUnits(selection.kind === 'unit' ? [selection.id] : []);
          store.setSelectedSquads([]);
        }
      }, tile => usePlanetViewStore.getState().setHoveredTile(tile), () => setPickNotice(PICK_MISS_NOTICE));
    } catch {
      setError('无法启动 3D 画面，请启用浏览器硬件加速，或切换到平面战术视图。');
      return;
    }
    scene.current = renderer;
    setReady(true);
    // Projection helper for browser tests (dev build, or a production build made with VITE_E2E=1).
    const exposeHook = exposeTestHook();
    if (exposeHook) installTestApi(renderer);
    // 战斗事件总线 → 3D 战斗演出（弹道/命中/爆炸/残骸）；卸载退订防重复演出
    const unsubscribeBattle = subscribeBattleEvents((event) => renderer.handleBattleEvent(event));
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const tile = renderer.getCenterTile();
      if (!tile) return;
      const { planet, fog } = latest.current;
      setCenterUncharted(renderer.isGroundView() && isTileUncharted(fog, tile.x, tile.y));
      const width = Math.min(96, planet.map_width);
      const height = Math.min(96, planet.map_height);
      const next = {
        x: Math.max(0, Math.min(planet.map_width - width, Math.floor(tile.x - width / 2))),
        y: Math.max(0, Math.min(planet.map_height - height, Math.floor(tile.y - height / 2))), width, height,
      };
      const store = usePlanetViewStore.getState();
      if (Math.abs(next.x - store.sceneWindow.x) >= 24 || Math.abs(next.y - store.sceneWindow.y) >= 24
        || width !== store.sceneWindow.width || height !== store.sceneWindow.height) store.setSceneWindow(next);
    }, 500);
    return () => {
      clearInterval(timer);
      unsubscribeBattle();
      renderer.destroy();
      scene.current = null;
      latest.current.onCanvasReady?.(null);
      if (exposeHook) delete (window as unknown as { __planetThree?: unknown }).__planetThree;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    scene.current?.setData({ ...props, playerId: session.playerId });
  }, [ready, props.planet, props.fog, props.overview, props.catalog, props.inventory, props.runtime, props.networks, props.darkFogHostile, props.alerts, session.playerId]);

  useEffect(() => {
    if (ready) scene.current?.setQuality(quality);
  }, [ready, quality]);

  useEffect(() => {
    if (!ready || !scene.current || !host.current) return;
    const element = host.current;
    props.onCanvasReady?.({
      get clientWidth() { return element.clientWidth; },
      get clientHeight() { return element.clientHeight; },
      captureScreenshot: () => scene.current?.capture() ?? null,
    });
  }, [ready, props.onCanvasReady]);

  useEffect(() => {
    scene.current?.setInteraction({ selected, selectedUnits, hoveredTile, interactionMode, layers });
  }, [ready, selected, selectedUnits, hoveredTile, interactionMode, layers]);

  const initiallyFocused = useRef(false);
  useEffect(() => {
    if (!ready || !focusRequest) return;
    scene.current?.focus(focusRequest.position, initiallyFocused.current);
    initiallyFocused.current = true;
    usePlanetViewStore.getState().consumeFocusRequest(focusRequest.nonce);
  }, [ready, focusRequest]);

  // 镜头设置弹出层：点外面关掉（与顶栏设置弹层同一模式）。
  useEffect(() => {
    if (!settingsOpen) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [settingsOpen]);

  useEffect(() => {
    if (!layersOpen) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!layersRef.current?.contains(event.target as Node)) {
        setLayersOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [layersOpen]);

  const home = () => {
    const tile = usePlanetViewStore.getState().homeTile ?? resolveHomeTile(props.planet, session.playerId);
    if (tile) scene.current?.focus(tile);
  };

  // Shift+左键框选：capture 阶段拦截，阻止球面旋转；抬起时按屏幕投影选中矩形内己方单位。
  function handleMarqueeDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button === 0 && interactionMode.kind === 'build' && isConveyorBeltBuilding(interactionMode.buildingType)) {
      const tile = scene.current?.pickAt(event.clientX, event.clientY);
      if (tile) {
        // 第一格高度：相邻有**己方**现成带子正对着它输出时接那条带的高度，否则取目标高度（§3.5）。
        const startElevation = resolveBeltStartElevation(
          tile,
          interactionMode.elevation ?? 0,
          Object.values(latest.current.planet.buildings ?? {}),
          props.planet.surface.face_size,
          session.playerId,
        );
        const modeDirection = interactionMode.direction;
        const first: BeltElevationPlacement = {
          tile,
          // 第一格方向：建造模式给了明确四向朝向就用它，否则先用默认方向占位——
          // auto 时真正的走向要等第一次指针移动才能从笔迹回填（见 handleMarqueeMove）。
          direction: isCardinalDirection(modeDirection) ? modeDirection : DEFAULT_BELT_DIRECTION,
          elevation: startElevation,
        };
        beltDrag.current = { tile, path: [first], startElevation, autoDirection: !isCardinalDirection(modeDirection) };
        scene.current?.setBeltDragPath([first]);
        event.currentTarget.setPointerCapture(event.pointerId);
        event.stopPropagation(); event.preventDefault();
      }
      return;
    }
    // D2 战区划定：theater_zone 模式下左键拖动出区域矩形（优先于 Shift 框选与球面旋转）。
    if (event.button === 0 && interactionMode.kind === 'theater_zone') {
      zoneDragRef.current = {
        startX: event.clientX, startY: event.clientY, active: false,
        startTile: scene.current?.pickAt(event.clientX, event.clientY) ?? null,
        endTile: null,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    if (event.button !== 0 || !event.shiftKey || interactionMode.kind !== 'inspect') return;
    marqueeRef.current = { startX: event.clientX, startY: event.clientY, active: false };
    // 捕获指针：松开时光标即使落在建造栏等 HUD 上，抬起事件也归框选，选框不会卡住。
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  }

  function handleMarqueeMove(event: React.PointerEvent<HTMLDivElement>) {
    if (beltDrag.current) {
      event.stopPropagation();
      const tile = scene.current?.pickAt(event.clientX, event.clientY);
      if (tile) {
        const drag = beltDrag.current;
        // 逐格处理从上一格到当前格的笔迹（§3.5 / B3–B5）：回拖跨过已有格时截断到该格、
        // 刷新截断处的方向，追加时把末端格与新格的方向都设成实际步进方向，
        // 结果始终是相邻格首尾相接的连通路径。高度由 resolveBeltDragPath 统一重算。
        const nextPath = applyBeltStrokeStep(drag.path, drag.tile, tile, props.planet.surface.face_size);
        if (nextPath) {
          drag.path = nextPath;
          drag.tile = drag.path.at(-1)?.tile ?? tile;
          scene.current?.setBeltDragPath(resolveBeltDragPath(drag));
          // 建造模式朝向跟随实际步进方向（下一次单击/ghost 用它）。
          const tail = drag.path.at(-1)!;
          const mode = usePlanetViewStore.getState().interactionMode;
          if (mode.kind === 'build') usePlanetViewStore.getState().setInteractionMode({ ...mode, direction: tail.direction });
        }
      }
      return;
    }
    const zoneDrag = zoneDragRef.current;
    if (zoneDrag) {
      event.stopPropagation();
      zoneDrag.endTile = scene.current?.pickAt(event.clientX, event.clientY) ?? zoneDrag.endTile;
      if (!zoneDrag.active && Math.abs(event.clientX - zoneDrag.startX) + Math.abs(event.clientY - zoneDrag.startY) > 4) {
        zoneDrag.active = true;
      }
      if (zoneDrag.active) {
        setZoneDragRect({
          x0: Math.min(zoneDrag.startX, event.clientX),
          y0: Math.min(zoneDrag.startY, event.clientY),
          x1: Math.max(zoneDrag.startX, event.clientX),
          y1: Math.max(zoneDrag.startY, event.clientY),
        });
      }
      return;
    }
    const marquee = marqueeRef.current;
    if (!marquee) return;
    event.stopPropagation();
    if (!marquee.active && Math.abs(event.clientX - marquee.startX) + Math.abs(event.clientY - marquee.startY) > 4) {
      marquee.active = true;
    }
    if (marquee.active) {
      setMarqueeRect({
        x0: Math.min(marquee.startX, event.clientX),
        y0: Math.min(marquee.startY, event.clientY),
        x1: Math.max(marquee.startX, event.clientX),
        y1: Math.max(marquee.startY, event.clientY),
      });
    }
  }

  function handleMarqueeUp(event: React.PointerEvent<HTMLDivElement>) {
    if (beltDrag.current) {
      event.stopPropagation();
      // 拖拽是用**左键**开始的，抬起带的 button 不是 0 说明结束的不是这次拖拽
      //（真实浏览器里右键按下已由 contextmenu 取消拖拽）。不下单、也不清预览，
      // 等真正对应的左键抬起再结算（B2：右键抬起不得下单）。
      if (event.button !== 0) return;
      const drag = beltDrag.current;
      // 松手：按当前目标高度整条结算，逐格下单（每格自带 direction/elevation）。
      // 单格点击（没拖拽过）且建造模式朝向为 auto：把朝向留空交回 interactTile 的
      // `mode.direction` 兜底——与旧的单格 placeBelt 口径一致（B1）。
      // 例外：目标高度 > 0 时服务端要求明确方向（INVALID_ELEVATION「高架传送带必须有明确的
      // 输出方向」），这里用建造模式的 rotation 推出四向朝向（ROTATION_FACING）下发。
      const singleClick = drag.path.length === 1 && drag.autoDirection;
      if (singleClick) {
        const mode = usePlanetViewStore.getState().interactionMode;
        const rotation = mode.kind === 'build' ? mode.rotation : undefined;
        const placement = drag.path[0].elevation > 0
          ? { direction: ROTATION_FACING[rotationTurns(rotation)], elevation: drag.path[0].elevation }
          : { elevation: drag.path[0].elevation };
        latest.current.onInteractTile?.(drag.path[0].tile, placement);
      } else {
        // 提交前再按格去重（拖拽预览已经保证不重复，这里是最后一道防线：
        // 同一格下两次单会让服务端第二次回 POSITION_OCCUPIED）。
        const seen = new Set<string>();
        for (const part of resolveBeltDragPath(drag)) {
          const key = `${part.tile.x},${part.tile.y}`;
          if (seen.has(key)) continue;
          seen.add(key);
          latest.current.onInteractTile?.(part.tile, { direction: part.direction, elevation: part.elevation });
        }
      }
      beltDrag.current = null;
      scene.current?.setBeltDragPath(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const zoneDrag = zoneDragRef.current;
    if (zoneDrag) {
      event.stopPropagation();
      zoneDragRef.current = null;
      setZoneDragRect(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (!zoneDrag.active) return;
      // 两个角点都拾取成格子（指针离开球面时沿用上一次命中的格子）。
      const start = zoneDrag.startTile ?? scene.current?.pickAt(zoneDrag.startX, zoneDrag.startY);
      const end = zoneDrag.endTile ?? scene.current?.pickAt(event.clientX, event.clientY);
      if (!start || !end) return;
      latest.current.onDefineZone?.(theaterZoneFromDragRect(
        { x: start.x, y: start.y },
        { x: end.x, y: end.y },
      ));
      return;
    }
    const marquee = marqueeRef.current;
    marqueeRef.current = null;
    if (!marquee) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setMarqueeRect(null);
    if (!marquee.active || !scene.current) return;
    const rect = {
      minX: Math.min(marquee.startX, event.clientX),
      maxX: Math.max(marquee.startX, event.clientX),
      minY: Math.min(marquee.startY, event.clientY),
      maxY: Math.max(marquee.startY, event.clientY),
    };
    const hostRect = host.current?.getBoundingClientRect();
    if (!hostRect) return;
    // 屏幕矩形 → 单位集合：与测试接口 dragTiles(…, {shift:true}) 同一套判定（纯函数）。
    const projectedUnits = Object.values(latest.current.planet.units ?? {})
      .filter(unit => unit.owner_id === session.playerId)
      .map(unit => {
        const projected = scene.current?.project({ x: Math.round(unit.position.x), y: Math.round(unit.position.y) });
        return {
          id: unit.id,
          ownerId: unit.owner_id,
          screen: projected?.visible ? { x: hostRect.left + projected.x, y: hostRect.top + projected.y } : null,
        };
      });
    applyUnitSelection(unitsInScreenRect(projectedUnits, rect));
  }

  /**
   * 浏览器测试接口（R20-A ⑤）：D1 决定不重建 DOM 实体层，Playwright 改为经
   * `window.__planetThree` 用投影 + 派发。返回值一律是**页面 CSS 像素**（相对页面左上角），
   * 供 `page.mouse.*` 直接使用；`locator.click` 用 `tileScreenPos` 减去画布位置即可。
   *
   * 全部内部调用场景已有方法（project/focus/pickAt/clickTile），不复制拾取逻辑：
   * - tileScreenPos(tile)：不在视野内先聚焦，再返回投影点；
   * - entityScreenPos(id)：建筑/单位按位置投影（高架带与地面同格，按格投影即可）；
   * - clickTile(tile, button?)：button=2 走右键情境指令（场景 clickTile 的同一条 onPick）；
   * - dragTiles(from, to, modifiers?)：两个格子的屏幕点之间拖一次（Shift=框选，Ctrl=加选）。
   */
  function installTestApi(target: PlanetThreeScene) {
    const hostRect = () => host.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const pagePos = (tile: TilePoint) => {
      const rounded = { x: Math.round(tile.x), y: Math.round(tile.y) };
      let projected = target.project(rounded);
      if (!projected?.visible) {
        target.focus(rounded);
        projected = target.project(rounded);
      }
      return projected ? toPagePoint(hostRect(), projected) : null;
    };
    const api = {
      ...target,
      // 覆盖场景原方法：场景的 project 是相对画布的，测试接口要求页面坐标。
      project: (tile: TilePoint) => target.project(tile),
      tileScreenPos: pagePos,
      entityScreenPos: (id: string) => {
        const current = latest.current;
        const entity = current.planet.buildings?.[id] ?? current.planet.units?.[id];
        return entity ? pagePos(entity.position) : null;
      },
      clickTile: (tile: TilePoint, button: 0 | 2 = 0) => target.clickTile(tile, { button }),
      dragTiles: (from: TilePoint, to: TilePoint, modifiers: DragModifiers = {}) => {
        const start = pagePos(from);
        const end = pagePos(to);
        if (!start || !end) return false;
        const element = host.current;
        if (!element) return false;
        const canvasRect = element.getBoundingClientRect();
        const local = (point: { x: number; y: number }) => ({ x: point.x - canvasRect.left, y: point.y - canvasRect.top });
        const init = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0,
          shiftKey: Boolean(modifiers.shift), ctrlKey: Boolean(modifiers.ctrl), metaKey: Boolean(modifiers.ctrl) };
        const dispatch = (type: string, point: { x: number; y: number }) => {
          const localPoint = local(point);
          element.dispatchEvent(new PointerEvent(type, { ...init, clientX: localPoint.x, clientY: localPoint.y }));
        };
        dispatch('pointerdown', start);
        // 分几步移动：框选阈值是 4px，一次跳到终点也算拖动，但分段更接近真实指针轨迹。
        for (let step = 1; step <= 4; step++) {
          dispatch('pointermove', { x: start.x + (end.x - start.x) * step / 4, y: start.y + (end.y - start.y) * step / 4 });
        }
        dispatch('pointerup', end);
        return true;
      },
    };
    (window as unknown as { __planetThree?: typeof api }).__planetThree = api;
  }

  const statusLines = buildPlanetThreeStatus({ hoveredTile, selected, selectedUnits, selectedSquads, interactionMode });

  return <div className="planet-three" ref={root}
    onPointerDownCapture={handleMarqueeDown}
    onPointerMoveCapture={handleMarqueeMove}
    onPointerUpCapture={handleMarqueeUp}
    onPointerCancelCapture={() => { cancelBeltDrag(); cancelZoneDrag(); }}
    onDoubleClick={event => {
      // 双击单位 = 选中屏幕内全部同类己方单位（投影可见即"同屏"）
      const tile = scene.current?.pickAt(event.clientX, event.clientY);
      if (!tile) return;
      const hit = resolveSelectionAtTile(latest.current.planet, tile.x, tile.y);
      if (hit?.kind !== 'unit') return;
      const unit = latest.current.planet.units?.[hit.id];
      if (!unit || unit.owner_id !== session.playerId || !scene.current || !host.current) return;
      const hostRect = host.current.getBoundingClientRect();
      const ids = sameTypeOwnUnitsInView(latest.current.planet, session.playerId, hit.id, null).filter(id => {
        const candidate = latest.current.planet.units?.[id];
        if (!candidate) return false;
        const projected = scene.current?.project({ x: Math.round(candidate.position.x), y: Math.round(candidate.position.y) });
        if (!projected?.visible) return false;
        const sx = hostRect.left + projected.x;
        const sy = hostRect.top + projected.y;
        return sx >= hostRect.left && sx <= hostRect.right && sy >= hostRect.top && sy <= hostRect.bottom;
      });
      applyUnitSelection(ids);
    }}
    onContextMenu={event => {
    event.preventDefault();
    // 拖拽铺带中按右键 = 取消这条预览（与 Esc 同一口径，B2），不进入情境指令分支。
    cancelBeltDrag();
    // D2：战区划定模式右键 = 退出模式（拖拽中的矩形一并丢弃）。
    cancelZoneDrag();
    const store = usePlanetViewStore.getState();
    if (store.interactionMode.kind !== 'inspect') {
      store.exitInteractionMode();
      return;
    }
    // inspect 模式右键 = 情境指令（点敌攻击/点地移动，由 onContextTile 判定）
    const tile = scene.current?.pickAt(event.clientX, event.clientY);
    if (tile) latest.current.onContextTile?.(tile);
  }}>
    <div ref={host} className="planet-three__surface" tabIndex={0} role="application" aria-label="3D 行星地图" />
    <PlanetTheaterLayer
      offsetX={0}
      offsetY={0}
      planetId={props.planet.planet_id}
      projectTile={projectTile}
      theaters={props.theaters}
      tileSize={1}
    />
    <PlanetLegionLayer
      offsetX={0}
      offsetY={0}
      onSelectLegion={legion => usePlanetViewStore.getState().setSelectedUnits(legionAliveMemberIds(legion, props.planet.units))}
      playerId={session.playerId}
      projectTile={projectTile}
      squads={props.runtime?.combat_squads}
      tileSize={1}
      units={props.planet.units}
    />
    <PlanetSquadLayer
      offsetX={0}
      offsetY={0}
      onSelectSquad={handleSelectSquad}
      playerId={session.playerId}
      projectTile={projectTile}
      selectedSquads={selectedSquads}
      squads={props.runtime?.combat_squads}
      tileSize={1}
    />
    {marqueeRect && host.current ? (
      <div
        aria-hidden="true"
        className="planet-three__marquee"
        style={{
          left: marqueeRect.x0 - host.current.getBoundingClientRect().left,
          top: marqueeRect.y0 - host.current.getBoundingClientRect().top,
          width: marqueeRect.x1 - marqueeRect.x0,
          height: marqueeRect.y1 - marqueeRect.y0,
        }}
      />
    ) : null}
    {zoneDragRect && host.current ? (
      <div
        aria-hidden="true"
        className="planet-three__marquee planet-three__zone-rect"
        data-testid="planet-three-zone-rect"
        style={{
          left: zoneDragRect.x0 - host.current.getBoundingClientRect().left,
          top: zoneDragRect.y0 - host.current.getBoundingClientRect().top,
          width: zoneDragRect.x1 - zoneDragRect.x0,
          height: zoneDragRect.y1 - zoneDragRect.y0,
        }}
      />
    ) : null}
    {!marqueeRect && <PlanetHoverTip containerRef={root} info={hoverInfo} />}
    {error && <div role="alert" className="planet-three__error">{error}</div>}
    {pickNotice && !error ? (
      <div className="planet-three__pick-notice" role="status" data-testid="planet-three-pick-notice">
        {describePickNotice(pickNotice)}
      </div>
    ) : null}
    {fogNotice && !error ? (
      <div className="planet-three__fog-notice" role="status">
        该区域尚未探索（{fogNotice.x}, {fogNotice.y}）：不能查看详情或建造，可派单位移动/进攻过去开视野
      </div>
    ) : null}
    {centerUncharted && !error ? (
      <div className="planet-three__uncharted" role="status">
        <span className="planet-three__uncharted-title">未探索区域</span>
        <span className="planet-three__uncharted-text">派单位前往可揭开地形</span>
        <button className="secondary-button" onClick={home} type="button">回到基地</button>
      </div>
    ) : null}
    <div className="planet-three__navigation" aria-label="3D 视角控制">
      {/* §3.2：镜头控制收成**一列**竖排小图标（全球视角 / 聚焦基地 / 放大 / 缩小 / 图层与视角 /
          选中对象 / 视角设置），设置项（俯仰/画质/图层）走弹出层。按钮文案保持「全球视角 / 聚焦基地 /
          3D 放大 / 3D 缩小」不变（测试契约）。
          3D 不再另起一列：过去左下同时存在「3D 自带控件列」与「2D 工具条列」，两列图标重复且互相压住。
          图层勾选与 2D 的「图层与视角」是**同一份内容**（PlanetPage 传同一组件进来），
          免得两个视图各维护一套图层开关。 */}
      <div className="planet-three__nav-rail" ref={railRef}>
        <button className="secondary-button planet-three__nav-btn" title="全球视角" aria-label="全球视角" onClick={() => scene.current?.orbit()}>
          <Globe2 size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button className="secondary-button planet-three__nav-btn" title="聚焦基地" aria-label="聚焦基地" onClick={home}>
          <House size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button className="secondary-button planet-three__nav-btn" title="3D 放大" aria-label="3D 放大" onClick={() => scene.current?.zoom(1.4)}>
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button className="secondary-button planet-three__nav-btn" title="3D 缩小" aria-label="3D 缩小" onClick={() => scene.current?.zoom(1 / 1.4)}>
          <Minus size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        {props.layerPanel !== undefined ? (
          <div className="planet-three__nav-settings" ref={layersRef}>
            <button
              aria-expanded={layersOpen}
              aria-label="图层与视角"
              className="secondary-button planet-three__nav-btn"
              onClick={() => setLayersOpen(open => !open)}
              title="图层与视角"
              type="button"
            >
              <Layers size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            {layersOpen ? (
              <div className="panel planet-three__nav-pop" role="dialog" aria-label="图层与视角">
                {props.layerPanel}
              </div>
            ) : null}
          </div>
        ) : null}
        {props.onSelectEntity ? (
          <button
            aria-label="选中对象"
            className="secondary-button planet-three__nav-btn"
            onClick={props.onSelectEntity}
            title="选中对象"
            type="button"
          >
            <Crosshair size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
        <div className="planet-three__nav-settings" ref={settingsRef}>
          <button
            aria-expanded={settingsOpen}
            aria-label="视角设置"
            className="secondary-button planet-three__nav-btn"
            onClick={() => setSettingsOpen(open => !open)}
            title="视角设置"
            type="button"
          >
            <Settings2 size={16} strokeWidth={2} aria-hidden="true" />
          </button>
          {settingsOpen ? (
            <div className="panel planet-three__nav-pop" role="dialog" aria-label="视角设置">
              {/* 俯仰/画质只有 3D 场景能消费（scene.current 是本组件的 ref），
                  所以这一层留在组件内，不通过 props 注入。 */}
              <label className="planet-three__tilt">镜头俯仰
                <input aria-label="镜头俯仰" type="range" min="0" max="1.1" step="0.05" value={tilt}
                  onChange={event => { const value = Number(event.target.value); setTilt(value); scene.current?.setTilt(value); }} />
              </label>
              <label className="planet-three__quality">画面质量
                <select aria-label="画面质量" value={quality} onChange={event => {
                  const next = event.target.value as PlanetRenderQuality;
                  setQuality(next);
                  try { localStorage.setItem(QUALITY_STORAGE_KEY, next); } catch { /* Optional preference. */ }
                }}>
                  <option value="low">流畅</option>
                  <option value="balanced">均衡</option>
                  <option value="high">精细</option>
                </select>
              </label>
            </div>
          ) : null}
        </div>
        {/* 调试入口（§3.2 复核）：2D 的那条工具条在 3D 下整条不渲染，
            所以 3D 的调试开关放在这一列的最后，面板同样浮在列上方。
            默认隐藏（debugMode 关闭时不渲染），Ctrl+Shift+D 与 2D 同口径。 */}
        {props.theaterControls}
        {debugMode ? (
          <button
            aria-expanded={debugOpen}
            aria-label={debugOpen ? "收起调试" : "展开调试"}
            className="secondary-button planet-three__nav-btn"
            onClick={() => usePlanetViewStore.getState().toggleDebugOpen()}
            title={debugOpen ? "收起调试" : "展开调试（Ctrl+Shift+D 隐藏）"}
            type="button"
          >
            <Bug size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {/* 取消按钮与坐标/框选状态行叠在图标列上方（试玩 1017 K4-01 后复核）：
          两者原来各自绝对定位到同一位置，取消按钮压住「60,14」坐标徽标。
          收进同一条纵向栈（取消在上、状态行在下）后由 flex 排版，不再互相重叠。 */}
      <div className="planet-three__nav-stack">
        {interactionMode.kind !== 'inspect' ? (
          <button className="secondary-button planet-three__nav-cancel" onClick={() => usePlanetViewStore.getState().exitInteractionMode()}>
            取消{interactionMode.kind === 'build' ? '建造' : interactionMode.kind === 'move' ? '移动' : interactionMode.kind === 'attack' ? '攻击' : interactionMode.kind === 'haul' ? '运输设置' : '指令'} · Esc
          </button>
        ) : null}
        {/* 状态行（R20-A ②）：文案与 2D 的 .planet-map-canvas__status 逐字对齐——
            悬停坐标、选中文案（selectionLabel）、模式提示、框选数、小队数。
            2D 退役后这些是玩家判断「当前模式/选了什么」的唯一可见反馈。 */}
        <div className="planet-three__nav-status">
          {statusLines.map(line => (
            <small
              className={line.tone ? `planet-three__nav-status-line planet-three__nav-status-line--${line.tone}` : 'planet-three__nav-status-line'}
              key={line.key}
            >
              {line.text}
            </small>
          ))}
        </div>
      </div>
    </div>
  </div>;
}
