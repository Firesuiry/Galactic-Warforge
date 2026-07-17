/**
 * 星图 Pixi 场景：银河层（恒星+航线）与恒星系层（恒星+轨道行星）共用一台相机。
 * 交互：拖拽平移、滚轮连续缩放、点击选中、双击/缩放下钻恒星系、系内缩小返回银河。
 * 舰队覆盖层（setFleets）：有舰队驻留的星系旁画徽标（菱形+glow+数量角标，
 * attacking 红色脉冲）；attacking 星系的相连航线做战火流动（frozen 冻结）。
 */

import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  TilingSprite,
  type FederatedPointerEvent,
} from 'pixi.js';

import { Camera2D, type ViewportSize } from '@/engine/camera';
import {
  getGlowTexture,
  getNebulaTexture,
  getPlanetTexture,
  getStarTexture,
  getStarfieldTexture,
} from '@/engine/textures';
import {
  computeSystemLanes,
  galaxyWorldRect,
  layoutSystemOrbits,
  planetColorOf,
  selectWarLanes,
  starColorOf,
  summarizeFleetsBySystem,
  systemGlyphScale,
  type FleetSystemPresence,
  type PlanetOrbitLayout,
  type SystemLane,
} from '@/features/starmap/model';
import type { FleetRuntimeView, GalaxyView, PlanetRef, SystemRef, SystemView } from '@shared/types';

/** 银河层放大到该倍数且指针附近有恒星系时，自动进入该系。 */
const ENTER_SYSTEM_ZOOM = 2.6;
/** 进入恒星系时吸附判定：指针距恒星系的世界距离上限（随缩放放宽）。 */
const ENTER_SYSTEM_SNAP_WORLD = 60;
/** 恒星系层缩放到 fit 值的该比例以下时返回银河。 */
const EXIT_SYSTEM_ZOOM_RATIO = 0.85;
/** 双击判定间隔（ms）。 */
const DOUBLE_TAP_MS = 350;
/** 点击/拖拽判定的位移阈值（屏幕 px）。 */
const DRAG_THRESHOLD_PX = 6;

const STAR_CORE_RADIUS = 9;
const SYSTEM_STAR_RADIUS = 46;

/** 舰队徽标配色：attacking 红 / 驻留蓝（对齐战场图舰队标记色调）。 */
const COLOR_FLEET_IDLE = 0x38bdf8;
const COLOR_FLEET_ATTACKING = 0xf87171;
/** 战火航线：流动亮点遍历整条航线的周期（秒）与每条航线亮点数。 */
const WAR_LANE_TRAVEL_SECONDS = 1.8;
const WAR_LANE_DOT_COUNT = 2;
/** 徽标脉冲相位差个数（确定性，不用随机，保证 frozen 截图稳定）。 */
const FLEET_PULSE_PHASE_STEP = (Math.PI * 2) / 7;

export interface StarmapSceneCallbacks {
  onSelectSystem: (systemId: string | null) => void;
  onSelectPlanet: (planetId: string | null) => void;
  onEnterSystem: (systemId: string) => void;
  onExitToGalaxy: () => void;
  onOpenPlanet: (planetId: string) => void;
}

export interface StarmapSceneOptions {
  /** 冻结动画（脉冲/公转/飞行），供截图测试与确定性渲染。 */
  frozen?: boolean;
}

interface SystemNode {
  system: SystemRef;
  container: Container;
  glow: Sprite;
  core: Sprite;
  ring: Graphics;
  label: Text;
  pulsePhase: number;
}

interface PlanetNode {
  layout: PlanetOrbitLayout;
  container: Container;
  sprite: Sprite;
  label: Text;
}

interface FleetBadgeNode {
  presence: FleetSystemPresence;
  container: Container;
  /** 脉冲部分（glow + 菱形），数量角标不参与脉冲。 */
  pulseTarget: Container;
  glow: Sprite;
  pulsePhase: number;
}

/** 战火航线流动亮点：沿定向航线 from→to 循环。 */
interface WarLaneDot {
  lane: SystemLane;
  sprite: Sprite;
  phase: number;
}

export class StarmapScene {
  private readonly app: Application;
  private readonly callbacks: StarmapSceneCallbacks;
  private readonly camera: Camera2D;
  private readonly frozen: boolean;

  private readonly background: Container;
  private readonly world: Container;
  private readonly lanesLayer: Graphics;
  private readonly warLanesLayer: Container;
  private readonly galaxyLayer: Container;
  private readonly fleetBadgeLayer: Container;
  private readonly systemLayer: Container;

  private galaxy: GalaxyView | null = null;
  private systemNodes = new Map<string, SystemNode>();
  private planetNodes: PlanetNode[] = [];
  private orbitRings: Graphics[] = [];
  private systemStar: Sprite | null = null;
  private systemSelectionRing: Graphics | null = null;
  private currentLanes: SystemLane[] = [];
  private fleetSummary: FleetSystemPresence[] = [];
  private fleetBadgeNodes: FleetBadgeNode[] = [];
  private warLaneDots: WarLaneDot[] = [];

  private focusedSystemId: string | null = null;
  private selectedSystemId: string | null = null;
  private selectedPlanetId: string | null = null;
  private discoveredOnly = false;
  private systemFitZoom = 1;
  private galaxyFitZoom = 1;
  private elapsedMs = 0;
  private lastTapAt = 0;
  private lastTapTarget = '';
  private disposed = false;

  private dragState: {
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null = null;

  constructor(app: Application, callbacks: StarmapSceneCallbacks, options: StarmapSceneOptions = {}) {
    this.app = app;
    this.callbacks = callbacks;
    this.frozen = options.frozen ?? false;
    this.camera = new Camera2D({ x: 0, y: 0, zoom: 1 }, { minZoom: 0.05, maxZoom: 60 });

    this.background = new Container();
    this.world = new Container();
    this.lanesLayer = new Graphics();
    this.warLanesLayer = new Container();
    this.galaxyLayer = new Container();
    this.fleetBadgeLayer = new Container();
    this.systemLayer = new Container();

    this.app.stage.addChild(this.background);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.lanesLayer);
    this.world.addChild(this.warLanesLayer);
    this.world.addChild(this.galaxyLayer);
    this.world.addChild(this.fleetBadgeLayer);
    this.world.addChild(this.systemLayer);

    this.buildBackground();
    this.bindPointerEvents();
    this.app.ticker.add(this.tick);
  }

  destroy() {
    this.disposed = true;
    this.app.ticker.remove(this.tick);
    this.unbindPointerEvents();
  }

  // ---------- 数据输入 ----------

  setGalaxy(galaxy: GalaxyView | null) {
    const firstData = !this.galaxy && galaxy;
    this.galaxy = galaxy;
    this.rebuildGalaxyLayer();
    if (firstData && galaxy) {
      const rect = galaxyWorldRect(galaxy);
      this.galaxyFitZoom = this.fitZoom(rect.width, rect.height, 0.9);
      this.camera.jumpTo({
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        zoom: this.galaxyFitZoom,
      });
    }
  }

  setDiscoveredOnly(value: boolean) {
    this.discoveredOnly = value;
    this.rebuildGalaxyLayer();
  }

  setSelectedSystem(systemId: string | null) {
    this.selectedSystemId = systemId;
    this.updateSelectionRings();
  }

  setSelectedPlanet(planetId: string | null) {
    this.selectedPlanetId = planetId;
    this.updateSelectionRings();
  }

  /** 进入/离开恒星系。system 数据可能尚在加载（传 null 先画中心恒星占位）。 */
  showSystem(systemId: string, system: SystemView | null) {
    this.focusedSystemId = systemId;
    this.rebuildSystemLayer(system);
    this.galaxyLayer.visible = false;
    this.lanesLayer.visible = false;
    this.warLanesLayer.visible = false;
    this.fleetBadgeLayer.visible = false;
    this.systemLayer.visible = true;

    const worldPos = this.systemWorldPosition(systemId, system);
    const maxOrbit = Math.max(
      ...this.planetNodes.map((node) => node.layout.orbitRadius),
      200,
    );
    this.systemFitZoom = this.fitZoom(maxOrbit * 2.4, maxOrbit * 2.4, 1);
    if (this.frozen) {
      this.camera.jumpTo({ x: worldPos.x, y: worldPos.y, zoom: this.systemFitZoom });
    } else {
      this.camera.flyTo({ x: worldPos.x, y: worldPos.y, zoom: this.systemFitZoom }, 520);
    }
  }

  /** 恒星系数据到达后刷新系内布局（不重复飞行）。 */
  updateSystem(system: SystemView | null) {
    if (!this.focusedSystemId) {
      return;
    }
    this.rebuildSystemLayer(system);
  }

  showGalaxy() {
    this.focusedSystemId = null;
    this.systemLayer.visible = false;
    this.galaxyLayer.visible = true;
    this.lanesLayer.visible = true;
    this.warLanesLayer.visible = true;
    this.fleetBadgeLayer.visible = true;
    if (this.galaxy) {
      const rect = galaxyWorldRect(this.galaxy);
      const pose = {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        zoom: this.galaxyFitZoom,
      };
      if (this.frozen) {
        this.camera.jumpTo(pose);
      } else {
        this.camera.flyTo(pose, 520);
      }
    }
  }

  // ---------- 场景构建 ----------

  private buildBackground() {
    const far = new TilingSprite({
      texture: getStarfieldTexture(1337, 220),
      width: this.app.screen.width,
      height: this.app.screen.height,
    });
    far.alpha = 0.5;
    const near = new TilingSprite({
      texture: getStarfieldTexture(4242, 110),
      width: this.app.screen.width,
      height: this.app.screen.height,
    });
    near.alpha = 0.9;
    far.label = 'starfield-far';
    near.label = 'starfield-near';
    this.background.addChild(far);
    this.background.addChild(near);

    const nebulaColors = [0x3f5cff, 0x39e6d0, 0xb04dff];
    nebulaColors.forEach((color, i) => {
      const nebula = new Sprite(getNebulaTexture(color, 9000 + i * 77));
      nebula.anchor.set(0.5);
      nebula.position.set(200 + i * 420, 160 + (i % 2) * 480);
      nebula.scale.set(2.2);
      this.background.addChild(nebula);
    });

    this.app.renderer.on('resize', (width: number, height: number) => {
      far.width = width;
      far.height = height;
      near.width = width;
      near.height = height;
    });
  }

  private rebuildGalaxyLayer() {
    this.galaxyLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.systemNodes.clear();
    this.lanesLayer.clear();
    this.currentLanes = [];
    if (!this.galaxy || this.focusedSystemId) {
      this.rebuildFleetOverlay();
      return;
    }

    const systems = (this.galaxy.systems ?? []).filter((system) => (
      system.position && (!this.discoveredOnly || system.discovered)
    ));

    this.currentLanes = computeSystemLanes(systems);
    this.currentLanes.forEach((lane) => {
      this.lanesLayer
        .moveTo(lane.from.x, lane.from.y)
        .lineTo(lane.to.x, lane.to.y)
        .stroke({ width: 1.2, color: 0x5fb0ff, alpha: 0.14 });
    });

    systems.forEach((system) => {
      const node = this.createSystemNode(system);
      this.systemNodes.set(system.system_id, node);
      this.galaxyLayer.addChild(node.container);
    });
    this.updateSelectionRings();
    this.rebuildFleetOverlay();
  }

  // ---------- 舰队徽标 + 战火航线 ----------

  /**
   * 舰队数据输入（war-fleets 查询结果）：按 system_id 聚合成徽标，
   * attacking 星系的相连航线做战火流动。规模小，数据变化时全量重建覆盖层。
   */
  setFleets(fleets: FleetRuntimeView[] | null) {
    this.fleetSummary = summarizeFleetsBySystem(fleets ?? []);
    this.rebuildFleetOverlay();
  }

  private rebuildFleetOverlay() {
    this.fleetBadgeLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.warLanesLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.fleetBadgeNodes = [];
    this.warLaneDots = [];
    if (!this.galaxy || this.focusedSystemId || this.fleetSummary.length === 0) {
      return;
    }

    let pulseIndex = 0;
    this.fleetSummary.forEach((presence) => {
      const systemNode = this.systemNodes.get(presence.systemId);
      if (!systemNode) {
        return; // 星系当前不可见（仅看已发现过滤/无坐标）
      }
      const badge = this.createFleetBadge(presence, pulseIndex * FLEET_PULSE_PHASE_STEP);
      badge.container.position.set(
        systemNode.container.position.x + 15,
        systemNode.container.position.y - 15,
      );
      if (presence.attacking > 0) {
        pulseIndex += 1;
      }
      this.fleetBadgeNodes.push(badge);
      this.fleetBadgeLayer.addChild(badge.container);
    });

    const attackingIds = new Set(
      this.fleetSummary
        .filter((presence) => presence.attacking > 0 && this.systemNodes.has(presence.systemId))
        .map((presence) => presence.systemId),
    );
    if (attackingIds.size === 0) {
      return;
    }

    const base = new Graphics();
    this.warLanesLayer.addChild(base);
    selectWarLanes(this.currentLanes, attackingIds).forEach((lane) => {
      base
        .moveTo(lane.from.x, lane.from.y)
        .lineTo(lane.to.x, lane.to.y)
        .stroke({ width: 1.6, color: COLOR_FLEET_ATTACKING, alpha: 0.3 });
      for (let i = 0; i < WAR_LANE_DOT_COUNT; i += 1) {
        const dot = new Sprite(getGlowTexture(0xffc0b8));
        dot.anchor.set(0.5);
        dot.scale.set(0.09);
        dot.position.set(lane.from.x, lane.from.y);
        this.warLanesLayer.addChild(dot);
        this.warLaneDots.push({ lane, sprite: dot, phase: i / WAR_LANE_DOT_COUNT });
      }
    });
  }

  /** 舰队徽标：小菱形 + 微 glow（对齐战场图舰队标记），多艘聚合成数量角标。 */
  private createFleetBadge(presence: FleetSystemPresence, pulsePhase: number): FleetBadgeNode {
    const attacking = presence.attacking > 0;
    const color = attacking ? COLOR_FLEET_ATTACKING : COLOR_FLEET_IDLE;

    const container = new Container();
    const pulseTarget = new Container();
    container.addChild(pulseTarget);

    const glow = new Sprite(getGlowTexture(color));
    glow.anchor.set(0.5);
    glow.scale.set(0.3);
    glow.alpha = attacking ? 0.75 : 0.5;
    pulseTarget.addChild(glow);

    const diamond = new Graphics();
    diamond
      .poly([0, -6, 8, 0, 0, 6, -8, 0], true)
      .fill({ color, alpha: 0.95 })
      .stroke({ width: 1.1, color: 0xffffff, alpha: 0.55 });
    pulseTarget.addChild(diamond);

    if (presence.total > 1) {
      const count = new Text({
        text: String(presence.total),
        style: {
          fontFamily: 'Inter, "PingFang SC", sans-serif',
          fontSize: 10,
          fontWeight: '700',
          fill: 0xe2e8f0,
          stroke: { color: 0x0b1220, width: 2 },
        },
      });
      count.anchor.set(0, 0.5);
      count.position.set(9, 0);
      container.addChild(count);
    }

    return { presence, container, pulseTarget, glow, pulsePhase };
  }

  private createSystemNode(system: SystemRef): SystemNode {
    const color = starColorOf(typeof system.star?.type === 'string' ? system.star.type : undefined);
    const scale = systemGlyphScale(system);
    const container = new Container();
    container.position.set(system.position!.x, system.position!.y);
    container.eventMode = 'static';
    container.cursor = 'pointer';
    container.hitArea = {
      contains: (x: number, y: number) => x * x + y * y <= 30 * 30,
    };

    const glow = new Sprite(getGlowTexture(color));
    glow.anchor.set(0.5);
    glow.scale.set((STAR_CORE_RADIUS * 6 * scale) / 64);

    const core = new Sprite(getStarTexture(color));
    core.anchor.set(0.5);
    core.scale.set((STAR_CORE_RADIUS * 2.6 * scale) / 64);
    if (!system.discovered) {
      glow.alpha = 0.45;
      core.alpha = 0.5;
    }

    const ring = new Graphics();
    this.drawRing(ring, 0xffe08a, STAR_CORE_RADIUS * 2.1);
    ring.visible = false;

    const label = new Text({
      text: system.discovered ? (system.name || system.system_id) : '未探明星系',
      style: {
        fontFamily: 'Inter, "PingFang SC", sans-serif',
        fontSize: 13,
        fill: system.discovered ? 0xdcebff : 0x5e7191,
      },
    });
    label.anchor.set(0.5, 0);
    label.position.set(0, STAR_CORE_RADIUS * 1.7);
    label.alpha = system.discovered ? 0.95 : 0.55;

    container.addChild(glow);
    container.addChild(core);
    container.addChild(ring);
    container.addChild(label);

    container.on('pointertap', (event: FederatedPointerEvent) => {
      if (this.dragState?.moved) {
        return;
      }
      const now = performance.now();
      const isDouble = this.lastTapTarget === system.system_id && now - this.lastTapAt < DOUBLE_TAP_MS;
      this.lastTapAt = now;
      this.lastTapTarget = system.system_id;
      if (isDouble) {
        this.callbacks.onEnterSystem(system.system_id);
      } else {
        this.callbacks.onSelectSystem(system.system_id);
      }
      event.stopPropagation();
    });

    return {
      system,
      container,
      glow,
      core,
      ring,
      label,
      pulsePhase: Math.random() * Math.PI * 2,
    };
  }

  private rebuildSystemLayer(system: SystemView | null) {
    this.systemLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.planetNodes = [];
    this.orbitRings = [];
    this.systemStar = null;
    this.systemSelectionRing = null;
    if (!this.focusedSystemId) {
      return;
    }

    const origin = this.systemWorldPosition(this.focusedSystemId, system);
    const starType = typeof system?.star?.type === 'string' ? system.star.type : undefined;
    const color = starColorOf(starType);

    const star = new Sprite(getStarTexture(color));
    star.anchor.set(0.5);
    star.position.copyFrom(origin);
    star.scale.set((SYSTEM_STAR_RADIUS * 2.2) / 64);
    this.systemStar = star;
    this.systemLayer.addChild(star);

    const planets: PlanetRef[] = system?.planets ?? [];
    layoutSystemOrbits(planets).forEach((layout) => {
      const ringGraphics = new Graphics();
      ringGraphics
        .circle(origin.x, origin.y, layout.orbitRadius)
        .stroke({ width: 1, color: 0x8fa3c8, alpha: 0.18 });
      this.orbitRings.push(ringGraphics);
      this.systemLayer.addChild(ringGraphics);

      const planet = layout.planet;
      const [baseColor, bandColor] = planetColorOf(planet.kind);
      const container = new Container();
      container.eventMode = 'static';
      container.cursor = 'pointer';
      container.hitArea = {
        contains: (x: number, y: number) => (
          (x - layout.radius) ** 2 + (y - layout.radius) ** 2 <= (layout.radius * 2.2) ** 2
        ),
      };

      const sprite = new Sprite(getPlanetTexture(planet.discovered ? baseColor : 0x3a4358, 64, bandColor));
      sprite.anchor.set(0.5);
      sprite.position.set(layout.radius, layout.radius);
      sprite.scale.set((layout.radius * 2) / 64);
      if (!planet.discovered) {
        sprite.alpha = 0.6;
      }
      container.addChild(sprite);

      const label = new Text({
        text: planet.discovered ? (planet.name || planet.planet_id) : '未探明',
        style: {
          fontFamily: 'Inter, "PingFang SC", sans-serif',
          fontSize: 12,
          fill: planet.discovered ? 0xdcebff : 0x5e7191,
        },
      });
      label.anchor.set(0.5, 0);
      label.position.set(layout.radius, layout.radius * 2 + 4);
      container.addChild(label);

      container.on('pointertap', () => {
        if (this.dragState?.moved) {
          return;
        }
        const now = performance.now();
        const isDouble = this.lastTapTarget === planet.planet_id && now - this.lastTapAt < DOUBLE_TAP_MS;
        this.lastTapAt = now;
        this.lastTapTarget = planet.planet_id;
        if (isDouble && planet.discovered) {
          this.callbacks.onOpenPlanet(planet.planet_id);
        } else {
          this.callbacks.onSelectPlanet(planet.planet_id);
        }
      });

      this.planetNodes.push({ layout, container, sprite, label });
      this.systemLayer.addChild(container);
    });

    const selectionRing = new Graphics();
    selectionRing.visible = false;
    this.systemSelectionRing = selectionRing;
    this.systemLayer.addChild(selectionRing);
    this.updateSelectionRings();
  }

  // ---------- 选中态 ----------

  private drawRing(target: Graphics, color: number, radius: number) {
    target.clear();
    target.circle(0, 0, radius).stroke({ width: 1.6, color, alpha: 0.9 });
    target.circle(0, 0, radius + 4).stroke({ width: 0.8, color, alpha: 0.35 });
  }

  private updateSelectionRings() {
    this.systemNodes.forEach((node) => {
      const selected = node.system.system_id === this.selectedSystemId;
      node.ring.visible = selected;
    });
    if (this.systemSelectionRing) {
      const selectedNode = this.planetNodes.find(
        (node) => node.layout.planet.planet_id === this.selectedPlanetId,
      );
      this.systemSelectionRing.clear();
      if (selectedNode) {
        const { layout } = selectedNode;
        this.systemSelectionRing
          .circle(layout.radius, layout.radius, layout.radius * 1.8)
          .stroke({ width: 1.4, color: 0xffe08a, alpha: 0.9 });
        this.systemSelectionRing.position.copyFrom(selectedNode.container.position);
        this.systemSelectionRing.visible = true;
      } else {
        this.systemSelectionRing.visible = false;
      }
    }
  }

  // ---------- 交互 ----------

  private readonly onPointerDown = (event: FederatedPointerEvent) => {
    this.dragState = {
      pointerId: event.pointerId,
      startX: event.global.x,
      startY: event.global.y,
      lastX: event.global.x,
      lastY: event.global.y,
      moved: false,
    };
  };

  private readonly onPointerMove = (event: FederatedPointerEvent) => {
    const drag = this.dragState;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.global.x - drag.lastX;
    const dy = event.global.y - drag.lastY;
    if (!drag.moved
      && Math.hypot(event.global.x - drag.startX, event.global.y - drag.startY) > DRAG_THRESHOLD_PX) {
      drag.moved = true;
    }
    if (drag.moved) {
      this.camera.panBy(dx, dy);
    }
    drag.lastX = event.global.x;
    drag.lastY = event.global.y;
  };

  private readonly onPointerUp = (event: FederatedPointerEvent) => {
    const drag = this.dragState;
    this.dragState = null;
    if (drag && !drag.moved && event.target === this.app.stage) {
      // 点击空白：取消选中；恒星系层双击空白返回银河。
      this.callbacks.onSelectSystem(null);
      this.callbacks.onSelectPlanet(null);
      if (this.focusedSystemId) {
        const now = performance.now();
        if (this.lastTapTarget === '__space__' && now - this.lastTapAt < DOUBLE_TAP_MS) {
          this.callbacks.onExitToGalaxy();
        }
        this.lastTapAt = now;
        this.lastTapTarget = '__space__';
      }
    }
  };

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0016);
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const viewport = this.viewport();

    if (this.focusedSystemId) {
      // 恒星系层：缩小越过阈值返回银河。
      if (this.camera.zoom * factor < this.systemFitZoom * EXIT_SYSTEM_ZOOM_RATIO && factor < 1) {
        this.callbacks.onExitToGalaxy();
        return;
      }
      this.camera.zoomAt(sx, sy, factor, viewport);
      return;
    }

    this.camera.zoomAt(sx, sy, factor, viewport);
    // 银河层：放大越过阈值且指针靠近某恒星系 → 进入该系。
    if (this.camera.zoom >= ENTER_SYSTEM_ZOOM && factor > 1) {
      const worldPoint = this.camera.screenToWorld(sx, sy, viewport);
      const snapDistance = ENTER_SYSTEM_SNAP_WORLD * (1 / this.camera.zoom) * 3;
      let best: { id: string; d: number } | null = null;
      this.systemNodes.forEach((node, id) => {
        const d = Math.hypot(
          node.container.position.x - worldPoint.x,
          node.container.position.y - worldPoint.y,
        );
        if (d < snapDistance && (!best || d < best.d)) {
          best = { id, d };
        }
      });
      if (best) {
        this.callbacks.onEnterSystem((best as { id: string }).id);
      }
    }
  };

  private bindPointerEvents() {
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointerdown', this.onPointerDown);
    this.app.stage.on('pointermove', this.onPointerMove);
    this.app.stage.on('pointerup', this.onPointerUp);
    this.app.stage.on('pointerupoutside', this.onPointerUp);
    this.app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private unbindPointerEvents() {
    this.app.stage.off('pointerdown', this.onPointerDown);
    this.app.stage.off('pointermove', this.onPointerMove);
    this.app.stage.off('pointerup', this.onPointerUp);
    this.app.stage.off('pointerupoutside', this.onPointerUp);
    this.app.canvas.removeEventListener('wheel', this.onWheel);
  }

  // ---------- 帧循环 ----------

  private readonly tick = (ticker: { deltaMS: number }) => {
    if (this.disposed) {
      return;
    }
    const dt = ticker.deltaMS;
    if (!this.frozen) {
      this.elapsedMs += dt;
      this.camera.update(dt);
    }

    // 相机 → 世界变换
    this.world.position.set(
      -this.camera.x * this.camera.zoom + this.app.screen.width / 2,
      -this.camera.y * this.camera.zoom + this.app.screen.height / 2,
    );
    this.world.scale.set(this.camera.zoom);

    // 背景视差
    const [far, near] = this.background.children;
    if (far instanceof TilingSprite && near instanceof TilingSprite) {
      far.tilePosition.set(-this.camera.x * 0.12, -this.camera.y * 0.12);
      near.tilePosition.set(-this.camera.x * 0.3, -this.camera.y * 0.3);
    }

    // 恒星呼吸
    const t = this.elapsedMs / 1000;
    if (this.galaxyLayer.visible) {
      this.systemNodes.forEach((node) => {
        const pulse = 1 + 0.08 * Math.sin(t * 1.6 + node.pulsePhase);
        node.glow.scale.set((STAR_CORE_RADIUS * 6 * systemGlyphScale(node.system) * pulse) / 64);
        // 文字保持屏幕空间大小（随缩放反向缩放），缩得过小则隐藏
        node.label.visible = this.camera.zoom > 0.45;
        const inv = 1 / Math.max(this.camera.zoom, 0.2);
        node.label.scale.set(inv);
      });

      // 舰队徽标：attacking 红色脉冲（alpha/缩放 sin），idle 静止微光
      this.fleetBadgeNodes.forEach((node) => {
        if (node.presence.attacking === 0) {
          return;
        }
        const pulse = 1 + 0.16 * Math.sin(t * 4 + node.pulsePhase);
        node.pulseTarget.scale.set(pulse);
        node.glow.alpha = 0.5 + 0.3 * Math.sin(t * 4 + node.pulsePhase);
      });

      // 战火航线：亮点沿定向航线循环流动（两端渐隐），frozen 时 t 冻结保持静止
      this.warLaneDots.forEach((dot) => {
        const p = ((t / WAR_LANE_TRAVEL_SECONDS) + dot.phase) % 1;
        dot.sprite.position.set(
          dot.lane.from.x + (dot.lane.to.x - dot.lane.from.x) * p,
          dot.lane.from.y + (dot.lane.to.y - dot.lane.from.y) * p,
        );
        dot.sprite.alpha = Math.sin(Math.PI * p) * 0.9;
      });
    }

    // 行星公转（系内层）
    if (this.systemLayer.visible && this.focusedSystemId) {
      const origin = this.systemWorldPosition(this.focusedSystemId, null);
      const inv = 1 / Math.max(this.camera.zoom, 0.2);
      this.planetNodes.forEach((node) => {
        const periodDays = node.layout.planet.orbit?.period_days;
        // period_days 以"天"为单位太大，映射为 40~120s 一圈的观赏速度。
        const secondsPerOrbit = typeof periodDays === 'number' && periodDays > 0
          ? Math.min(Math.max(periodDays / 3, 40), 180)
          : 60 + node.layout.orbitRadius * 0.35;
        if (!this.frozen) {
          node.layout.angle += (dt / 1000) * ((Math.PI * 2) / secondsPerOrbit);
        }
        const px = origin.x + Math.cos(node.layout.angle) * node.layout.orbitRadius;
        const py = origin.y + Math.sin(node.layout.angle) * node.layout.orbitRadius * 0.98;
        node.container.position.set(px, py);
        // 标签保持屏幕空间大小
        node.label.scale.set(inv);
      });
      if (this.systemSelectionRing && this.selectedPlanetId) {
        const selectedNode = this.planetNodes.find(
          (node) => node.layout.planet.planet_id === this.selectedPlanetId,
        );
        if (selectedNode) {
          this.systemSelectionRing.position.copyFrom(selectedNode.container.position);
        }
      }
    }
  };

  // ---------- 工具 ----------

  /** 调试/自动化测试：恒星系当前屏幕坐标（银河层）。 */
  systemScreenPosition(systemId: string) {
    const node = this.systemNodes.get(systemId);
    if (!node) {
      return null;
    }
    return this.camera.worldToScreen(
      node.container.position.x,
      node.container.position.y,
      this.viewport(),
    );
  }

  /** 调试/自动化测试：行星当前屏幕坐标（恒星系层）。 */
  planetScreenPosition(planetId: string) {
    const node = this.planetNodes.find((n) => n.layout.planet.planet_id === planetId);
    if (!node) {
      return null;
    }
    return this.camera.worldToScreen(
      node.container.position.x,
      node.container.position.y,
      this.viewport(),
    );
  }

  private viewport(): ViewportSize {
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

  private fitZoom(worldWidth: number, worldHeight: number, fill: number) {
    const { width, height } = this.viewport();
    return Math.min(width / Math.max(worldWidth, 1), height / Math.max(worldHeight, 1)) * fill;
  }

  private systemWorldPosition(systemId: string, system: SystemView | null) {
    if (system?.position) {
      return { x: system.position.x, y: system.position.y };
    }
    const fromGalaxy = this.galaxy?.systems?.find((s) => s.system_id === systemId)?.position;
    if (fromGalaxy) {
      return { x: fromGalaxy.x, y: fromGalaxy.y };
    }
    return { x: this.camera.x, y: this.camera.y };
  }
}
