/**
 * 行星地图 Pixi 场景：底图纹理精灵 + 实体节点树 + 轻量动效 ticker。
 *
 * 场景结构（除 backdrop 外全部挂在 world 容器下，相机 = world.position）：
 * - 底图：terrain/fog/overview 由 planet-base-map 生成 1px/tile（overview 1px/cell）离屏 canvas
 *   → Texture → Sprite；地形/overview 用 nearest 放大保硬边，迷雾用 linear 得软边界。
 *   数据变化时重生成纹理并销毁旧纹理（emoji 纹理由全局缓存管理，不在此销毁）。
 * - 实体：建筑（footprint 描边盒 + emoji 图标）/单位（圆点）/资源（emoji）走逐节点 Container
 *   （增量同步）；物流/电网/管道/工地/敌情各一个 Graphics，sync 时整体重绘。
 * - 交互叠加：选中黄框 / hover 白框 / 建造幽灵 / move/attack 准星（单个 Graphics，数据变化重绘）。
 *
 * ticker 只做轻量动效：单位显示位置向数据位置指数趋近（k≈8/s）+ 选中环透明度脉冲，
 * 不做任何数据重建。视觉契约与旧 entity-draw.ts / PlanetMapCanvas 对齐。
 *
 * 战斗特效：组件侧订阅战斗事件总线（battle-events）调 handleBattleEvent，
 * damage_applied 映射为开火闪光/伤害飘字/受击闪白（planet-effects 纯逻辑 + 池化视图），
 * frozen 模式不演出。
 */

import { Application, Container, Graphics, Sprite, Text, Texture, type Ticker } from 'pixi.js';

import type {
  Building,
  CatalogView,
  FogMapView,
  PlanetOverviewView,
  PlanetResource,
  PlanetSceneView,
  Unit,
} from '@shared/types';

import type { BattleEvent } from '@/engine/battle-events';
import { resolveIconGlyph } from '@/common/Icon';
import { getEmojiTexture, getGlowTexture } from '@/engine/textures';
import type { BuildTileAssessment } from '@/features/planet-map/build-workflow';
import {
  PlanetEffectPool,
  specsFromPlanetBattleEvent,
  type FireFlashEffectSpec,
  type HitFlashEffectSpec,
  type PlanetDamageFloatEffectSpec,
  type PlanetEffect,
  type PlanetEffectKind,
  type PlanetEffectPoint,
  type PlanetEffectSpec,
} from '@/features/planet-map/planet-effects';
import {
  getBuildingCatalogEntry,
  getBuildingFootprint,
  toTilePoint,
  type PlanetRenderView,
  type SelectedEntity,
  type TilePoint,
  type ViewportTileBounds,
} from '@/features/planet-map/model';
import {
  renderPlanetFogCanvas,
  renderPlanetOverviewCanvas,
  renderPlanetTerrainCanvas,
} from '@/features/planet-map/planet-base-map';
import { isTilePointVisible, type SceneRenderDetailPolicy } from '@/features/planet-map/render';
import type { PlanetInteractionMode, PlanetLayerState } from '@/features/planet-map/store';
import { getResourceColorValue, type VisibleEntities } from '@/features/planet-map/visible-entities';

/** 单位平滑移动的指数趋近速率（1/s）：pos += (target - pos) * (1 - exp(-dt * k))。 */
export const UNIT_SMOOTHING_RATE = 8;

/** 指数趋近的每帧混合系数；dt 越大越接近 1（帧率无关）。 */
export function smoothingBlend(dtSeconds: number, rate = UNIT_SMOOTHING_RATE) {
  if (dtSeconds <= 0) {
    return 0;
  }
  return 1 - Math.exp(-dtSeconds * rate);
}

/**
 * 把一条线段按 dash  pattern（如画 8 空 6）切成若干"画"段，供 Graphics 模拟虚线
 * （Pixi Graphics 无原生 setLineDash）。pattern 为空时退化为整条线段。
 */
export function buildDashSegments(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  pattern: readonly number[],
): Array<readonly [number, number, number, number]> {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy);
  if (length <= 0) {
    return [];
  }
  if (pattern.length === 0) {
    return [[fromX, fromY, toX, toY]];
  }
  const ux = dx / length;
  const uy = dy / length;
  const segments: Array<readonly [number, number, number, number]> = [];
  let cursor = 0;
  let index = 0;
  let drawing = true;
  while (cursor < length) {
    const step = Math.max(pattern[index % pattern.length], 0);
    const next = Math.min(cursor + step, length);
    if (drawing && next > cursor) {
      segments.push([
        fromX + ux * cursor,
        fromY + uy * cursor,
        fromX + ux * next,
        fromY + uy * next,
      ]);
    }
    cursor = next;
    index += 1;
    drawing = !drawing;
    if (step <= 0 && !drawing) {
      break; // 防御：pattern 含 0 时避免死循环
    }
  }
  return segments;
}

export interface PlanetSceneBaseInput {
  planet: PlanetRenderView;
  fog?: FogMapView | PlanetSceneView;
  overview?: PlanetOverviewView;
  overviewMode: boolean;
  layers: PlanetLayerState;
}

export interface PlanetSceneCameraInput {
  offsetX: number;
  offsetY: number;
  tileSize: number;
}

export interface PlanetSceneEntitiesInput {
  visible: VisibleEntities;
  catalog?: CatalogView;
  playerId: string;
  detailPolicy: SceneRenderDetailPolicy;
  layers: PlanetLayerState;
  overviewMode: boolean;
}

export interface PlanetSceneInteractionInput {
  hoveredTile: TilePoint | null;
  selected: SelectedEntity | null;
  mode: PlanetInteractionMode;
  /** build 模式幽灵预览的评估结果（由组件用 assessBuildTiles 预先算好）。 */
  buildAssessment?: BuildTileAssessment;
  selectionVisible: boolean;
  overview?: PlanetOverviewView;
  overviewMode: boolean;
  viewportBounds: ViewportTileBounds;
}

export interface PlanetSceneOptions {
  /** 冻结动效（单位直接落位、无选中环脉冲），供截图测试与确定性渲染。 */
  frozen?: boolean;
}

interface SceneNode {
  container: Container;
}

interface BuildingNode extends SceneNode {
  box: Graphics;
  icon: Sprite;
  data: Building;
}

interface UnitNode extends SceneNode {
  dot: Graphics;
  data: Unit;
  targetX: number;
  targetY: number;
  posX: number;
  posY: number;
}

interface ResourceNode extends SceneNode {
  icon: Sprite;
  data: PlanetResource;
}

/** 特效视图：池化复用（restart 重置状态），update 按 progress 逐帧推进。 */
interface PlanetEffectView {
  kind: PlanetEffectKind;
  container: Container;
  restart(spec: PlanetEffectSpec): void;
  update(effect: PlanetEffect): void;
  /** 回收时的收尾（受击闪白恢复节点 alpha）。 */
  release?(): void;
}

const COLOR_BACKDROP = 0x07101d;
const COLOR_GRID = 0xd2e2ff;
const COLOR_BUILDING_STROKE_OWN = 0x57efe0;
const COLOR_BUILDING_STROKE_ENEMY = 0xff7b7b;
const COLOR_UNIT_OWN = 0x91ff70;
const COLOR_UNIT_ENEMY = 0xff6262;
const COLOR_DRONE = 0x2dd4bf;
const COLOR_SHIP = 0xffe066;
const COLOR_POWER_WIRELESS = 0xffd43b;
const COLOR_POWER_WIRED = 0x74c0fc;
const COLOR_POWER_DOWN = 0xff6b6b;
const COLOR_PIPELINE = 0x63e6be;
const COLOR_ENEMY = 0xff6b6b;
const COLOR_DETECTION = 0xffd43b;
const COLOR_SELECTED = 0xffd166;
const COLOR_GHOST_OK = 0x6ee7b7;
const COLOR_GHOST_BLOCKED = 0xff5757;

/** 开火闪光配色：普通单位青白 / 防御塔黄白（克制，短亮线一过即隐）。 */
const COLOR_FIRE_UNIT = 0xa5f3fc;
const COLOR_FIRE_DEFENSE = 0xfde68a;
/** 伤害飘字配色：敌方受击红色系 / 己方受击橙色系（与既有己敌配色一致）。 */
const COLOR_FLOAT_ENEMY_HIT = 0xf87171;
const COLOR_FLOAT_OWN_HIT = 0xfbbf24;
/** 受击闪白的 alpha 下探幅度（1 → 1-DEPTH → 1 的正弦脉冲）。 */
const HIT_FLASH_ALPHA_DEPTH = 0.55;

const tileCenter = (tile: number, tileSize: number) => (tile + 0.5) * tileSize;

function constructionStateColor(state: string): number {
  if (state === 'in_progress') {
    return 0xffe066;
  }
  if (state === 'paused') {
    return 0xff922b;
  }
  if (state === 'cancelled') {
    return 0xff6b6b;
  }
  return 0x94d82d;
}

export class PlanetScene {
  private readonly app: Application;
  private readonly frozen: boolean;

  private readonly backdrop: Graphics;
  private readonly world: Container;
  private readonly terrainSprite: Sprite;
  private readonly fogSprite: Sprite;
  private readonly overviewSprite: Sprite;
  private readonly gridGraphics: Graphics;
  private readonly pipelinesGraphics: Graphics;
  private readonly powerGraphics: Graphics;
  private readonly resourcesLayer: Container;
  private readonly constructionGraphics: Graphics;
  private readonly buildingsLayer: Container;
  private readonly logisticsGraphics: Graphics;
  private readonly unitsLayer: Container;
  private readonly threatGraphics: Graphics;
  private readonly selectionGraphics: Graphics;
  private readonly effectsLayer: Container;

  private terrainTexture: Texture | null = null;
  private fogTexture: Texture | null = null;
  private overviewTexture: Texture | null = null;

  private baseInput: PlanetSceneBaseInput | null = null;
  private textureSource: {
    planet: PlanetRenderView;
    fog?: FogMapView | PlanetSceneView;
    overview?: PlanetOverviewView;
    overviewMode: boolean;
    bakedFlags: string;
  } | null = null;
  private entitiesInput: PlanetSceneEntitiesInput | null = null;
  private interactionInput: PlanetSceneInteractionInput | null = null;

  private offsetX = 0;
  private offsetY = 0;
  private tileSize = 12;
  private layers: PlanetLayerState | null = null;
  private detailPolicy: SceneRenderDetailPolicy | null = null;
  private overviewMode = false;

  private buildingNodes = new Map<string, BuildingNode>();
  private unitNodes = new Map<string, UnitNode>();
  private resourceNodes = new Map<string, ResourceNode>();

  private pulsePhase = 0;
  private disposed = false;

  private readonly effectPool = new PlanetEffectPool();
  private readonly effectViews = new Map<number, PlanetEffectView>();
  private readonly freeEffectViews = new Map<PlanetEffectKind, PlanetEffectView[]>();
  private lastHandledSeq = 0;

  constructor(app: Application, options: PlanetSceneOptions = {}) {
    this.app = app;
    this.frozen = options.frozen ?? false;

    this.backdrop = new Graphics();
    this.world = new Container();
    this.terrainSprite = new Sprite();
    this.fogSprite = new Sprite();
    this.overviewSprite = new Sprite();
    this.gridGraphics = new Graphics();
    this.pipelinesGraphics = new Graphics();
    this.powerGraphics = new Graphics();
    this.resourcesLayer = new Container();
    this.constructionGraphics = new Graphics();
    this.buildingsLayer = new Container();
    this.logisticsGraphics = new Graphics();
    this.unitsLayer = new Container();
    this.threatGraphics = new Graphics();
    this.selectionGraphics = new Graphics();
    this.effectsLayer = new Container();

    // z 序对齐旧实现：地形 < 网格 < 迷雾 < 管网/电网 < 资源 < 工地 < 建筑 < 物流 < 单位 < 敌情 < 选中叠加 < 战斗特效
    this.app.stage.addChild(this.backdrop);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.terrainSprite);
    this.world.addChild(this.overviewSprite);
    this.world.addChild(this.gridGraphics);
    this.world.addChild(this.fogSprite);
    this.world.addChild(this.pipelinesGraphics);
    this.world.addChild(this.powerGraphics);
    this.world.addChild(this.resourcesLayer);
    this.world.addChild(this.constructionGraphics);
    this.world.addChild(this.buildingsLayer);
    this.world.addChild(this.logisticsGraphics);
    this.world.addChild(this.unitsLayer);
    this.world.addChild(this.threatGraphics);
    this.world.addChild(this.selectionGraphics);
    this.world.addChild(this.effectsLayer);

    this.drawBackdrop();
    this.app.renderer.on('resize', this.drawBackdrop);
    this.app.ticker.add(this.tick);
  }

  destroy() {
    this.disposed = true;
    this.app.ticker.remove(this.tick);
    this.app.renderer.off('resize', this.drawBackdrop);
    this.destroyBaseTextures();
  }

  // ---------- 数据输入 ----------

  /** 底图输入：planet/fog/overview 或烘焙进纹理的图层开关变化时重生成纹理。 */
  setBase(input: PlanetSceneBaseInput) {
    this.baseInput = input;
    this.layers = input.layers;
    const modeChanged = input.overviewMode !== this.overviewMode;
    this.overviewMode = input.overviewMode;

    // 只把"会影响纹理内容"的输入纳入变更检测：数据引用 + 烘焙进 overview 合成画布的 5 个图层开关。
    const bakedFlags = input.overviewMode
      ? [
          input.layers.terrain,
          input.layers.resources,
          input.layers.buildings,
          input.layers.units,
          input.layers.fog,
        ].map(Number).join('')
      : '';
    const textureSourceChanged = !this.textureSource
      || this.textureSource.planet !== input.planet
      || this.textureSource.fog !== input.fog
      || this.textureSource.overview !== input.overview
      || this.textureSource.overviewMode !== input.overviewMode
      || this.textureSource.bakedFlags !== bakedFlags;
    if (textureSourceChanged) {
      this.textureSource = {
        planet: input.planet,
        fog: input.fog,
        overview: input.overview,
        overviewMode: input.overviewMode,
        bakedFlags,
      };
      this.rebuildBaseTextures();
    }
    this.layoutBaseSprites();
    this.redrawGrid();
    this.applyLayerVisibility();
    if (modeChanged) {
      this.rebuildEntityNodes();
      this.redrawStaticLayers();
      this.redrawInteraction();
    }
  }

  /** 相机输入：平移只动 world 容器；tileSize（缩放档）变化才触发实体按新尺寸重建。 */
  setCamera(input: PlanetSceneCameraInput) {
    const tileSizeChanged = input.tileSize !== this.tileSize;
    this.offsetX = input.offsetX;
    this.offsetY = input.offsetY;
    this.tileSize = input.tileSize;
    this.world.position.set(input.offsetX, input.offsetY);
    this.layoutBaseSprites();
    if (tileSizeChanged) {
      this.redrawGrid();
      this.rebuildEntityNodes();
      this.redrawStaticLayers();
      this.redrawInteraction();
      this.applyLayerVisibility();
    }
  }

  /** 实体输入：建筑/单位/资源增量同步（保平滑移动状态），连线类 Graphics 整体重绘。 */
  setEntities(input: PlanetSceneEntitiesInput) {
    this.entitiesInput = input;
    this.layers = input.layers;
    this.detailPolicy = input.detailPolicy;
    this.syncBuildings(input.visible.buildings, input.catalog, input.playerId);
    this.syncUnits(input.visible.units, input.playerId);
    this.syncResources(input.visible.resources);
    this.redrawStaticLayers();
    // detailPolicy 由本输入提供：首帧 setBase/setCamera 先于 setEntities 时网格尚未绘制，这里补齐。
    this.redrawGrid();
    this.applyLayerVisibility();
  }

  /** 交互输入：选中/hover/幽灵/准星叠加层重绘。 */
  setInteraction(input: PlanetSceneInteractionInput) {
    this.interactionInput = input;
    this.redrawInteraction();
  }

  // ---------- 战斗事件演出 ----------

  /**
   * 消费一条战斗事件总线事件（damage_applied → 开火闪光/伤害飘字/受击闪白）。
   * seq 去重保证 StrictMode 双挂载/多重转发时同一事件只演出一次（同 battlefield-scene）。
   * frozen 模式下不演出。
   */
  handleBattleEvent(event: BattleEvent) {
    if (this.disposed || this.frozen) {
      return;
    }
    if (event.seq <= this.lastHandledSeq) {
      return;
    }
    this.lastHandledSeq = event.seq;

    const specs = specsFromPlanetBattleEvent(event, {
      resolve: (entityId) => this.resolveEffectPoint(entityId),
    });
    specs.forEach((spec) => this.spawnEffect(spec));
  }

  /** 把实体 id 解析到当前节点树：建筑取 footprint 中心，单位取平滑后的显示位置。 */
  private resolveEffectPoint(entityId: string | undefined | null): PlanetEffectPoint | null {
    if (!entityId) {
      return null;
    }
    const playerId = this.entitiesInput?.playerId;
    const building = this.buildingNodes.get(entityId);
    if (building) {
      const { width, height } = getBuildingFootprint(building.data);
      return {
        x: building.container.position.x + (width * this.tileSize) / 2,
        y: building.container.position.y + (height * this.tileSize) / 2,
        owner: playerId && building.data.owner_id === playerId ? 'own' : 'enemy',
        kind: 'building',
      };
    }
    const unit = this.unitNodes.get(entityId);
    if (unit) {
      return {
        x: unit.posX,
        y: unit.posY,
        owner: playerId && unit.data.owner_id === playerId ? 'own' : 'enemy',
        kind: 'unit',
      };
    }
    return null;
  }

  // ---------- 特效（池化视图 + ticker 推进） ----------

  private spawnEffect(spec: PlanetEffectSpec) {
    const effect = this.effectPool.spawn(spec);
    const view = this.obtainEffectView(spec);
    this.effectViews.set(effect.id, view);
    if (view.container.parent !== this.effectsLayer) {
      this.effectsLayer.addChild(view.container);
    }
    view.container.visible = true;
  }

  private obtainEffectView(spec: PlanetEffectSpec): PlanetEffectView {
    const freeList = this.freeEffectViews.get(spec.kind);
    const reused = freeList?.pop();
    const view = reused ?? this.createEffectView(spec.kind);
    view.restart(spec);
    return view;
  }

  private recycleEffectView(effect: PlanetEffect) {
    const view = this.effectViews.get(effect.id);
    if (!view) {
      return;
    }
    this.effectViews.delete(effect.id);
    view.release?.();
    view.container.visible = false;
    const freeList = this.freeEffectViews.get(view.kind) ?? [];
    freeList.push(view);
    this.freeEffectViews.set(view.kind, freeList);
  }

  private createEffectView(kind: PlanetEffectKind): PlanetEffectView {
    switch (kind) {
      case 'fire_flash':
        return this.createFireFlashView();
      case 'damage_float':
        return this.createDamageFloatView();
      case 'hit_flash':
        return this.createHitFlashView();
    }
  }

  /** 开火闪光：弹道亮点从攻击方飞到目标 + 短亮线随飞行渐隐。 */
  private createFireFlashView(): PlanetEffectView {
    const container = new Container();
    const trail = new Graphics();
    const head = new Sprite(getGlowTexture(0xffffff));
    head.anchor.set(0.5);
    head.scale.set(0.1);
    container.addChild(trail);
    container.addChild(head);

    let spec: FireFlashEffectSpec | null = null;

    return {
      kind: 'fire_flash',
      container,
      restart(next) {
        spec = next as FireFlashEffectSpec;
        const color = spec.tone === 'defense' ? COLOR_FIRE_DEFENSE : COLOR_FIRE_UNIT;
        head.tint = color;
        head.position.set(spec.fromX, spec.fromY);
        head.alpha = 1;
        trail
          .clear()
          .moveTo(spec.fromX, spec.fromY)
          .lineTo(spec.toX, spec.toY)
          .stroke({ width: 1.6, color, alpha: 0.7 });
      },
      update(effect) {
        if (!spec) {
          return;
        }
        const p = effect.progress;
        head.position.set(
          spec.fromX + (spec.toX - spec.fromX) * p,
          spec.fromY + (spec.toY - spec.fromY) * p,
        );
        head.alpha = 1 - p * 0.5;
        trail.alpha = (1 - p) * 0.7;
      },
    };
  }

  /** 伤害飘字：-{damage} 上飘渐隐（敌方受击红 / 己方受击橙）。 */
  private createDamageFloatView(): PlanetEffectView {
    const container = new Container();
    const text = new Text({
      text: '',
      style: {
        fontFamily: 'Inter, "PingFang SC", sans-serif',
        fontSize: 12,
        fontWeight: '700',
        fill: COLOR_FLOAT_ENEMY_HIT,
        stroke: { color: 0x1c0a0a, width: 2 },
      },
    });
    text.anchor.set(0.5);
    container.addChild(text);
    let spec: PlanetDamageFloatEffectSpec | null = null;

    return {
      kind: 'damage_float',
      container,
      restart(next) {
        spec = next as PlanetDamageFloatEffectSpec;
        text.text = spec.text;
        text.style.fill = spec.tone === 'own_hit' ? COLOR_FLOAT_OWN_HIT : COLOR_FLOAT_ENEMY_HIT;
        text.position.set(spec.x, spec.y);
        text.alpha = 1;
      },
      update(effect) {
        if (!spec) {
          return;
        }
        const p = effect.progress;
        text.position.set(spec.x, spec.y - 20 * p);
        text.alpha = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
      },
    };
  }

  /**
   * 受击闪白：对目标节点容器做 alpha 正弦脉冲（无自有绘制物）。
   * 节点中途被增量同步销毁时直接停演，release 只恢复未销毁节点的 alpha。
   */
  private createHitFlashView(): PlanetEffectView {
    const container = new Container();
    let target: Container | null = null;

    return {
      kind: 'hit_flash',
      container,
      restart: (next) => {
        const spec = next as HitFlashEffectSpec;
        const node = this.unitNodes.get(spec.targetId) ?? this.buildingNodes.get(spec.targetId);
        target = node?.container ?? null;
      },
      update(effect) {
        if (!target || target.destroyed) {
          return;
        }
        target.alpha = 1 - HIT_FLASH_ALPHA_DEPTH * Math.sin(Math.PI * effect.progress);
      },
      release() {
        if (target && !target.destroyed) {
          target.alpha = 1;
        }
        target = null;
      },
    };
  }

  // ---------- 底图 ----------

  private readonly drawBackdrop = () => {
    this.backdrop
      .clear()
      .rect(0, 0, this.app.screen.width, this.app.screen.height)
      .fill(COLOR_BACKDROP);
  };

  private destroyBaseTextures() {
    this.terrainTexture?.destroy(true);
    this.fogTexture?.destroy(true);
    this.overviewTexture?.destroy(true);
    this.terrainTexture = null;
    this.fogTexture = null;
    this.overviewTexture = null;
  }

  private rebuildBaseTextures() {
    const input = this.baseInput;
    if (!input) {
      return;
    }
    this.destroyBaseTextures();
    if (input.overviewMode) {
      if (input.overview) {
        const canvas = renderPlanetOverviewCanvas(input.overview, {
          terrain: input.layers.terrain,
          resources: input.layers.resources,
          buildings: input.layers.buildings,
          units: input.layers.units,
          fog: input.layers.fog,
        });
        this.overviewTexture = this.createBaseTexture(canvas, 'nearest');
        this.overviewSprite.texture = this.overviewTexture;
      } else {
        this.overviewSprite.texture = Texture.EMPTY;
      }
      this.terrainSprite.texture = Texture.EMPTY;
      this.fogSprite.texture = Texture.EMPTY;
      return;
    }
    const terrainCanvas = renderPlanetTerrainCanvas(input.planet);
    this.terrainTexture = this.createBaseTexture(terrainCanvas, 'nearest');
    this.terrainSprite.texture = this.terrainTexture;

    const fogCanvas = renderPlanetFogCanvas(input.planet, input.fog);
    if (fogCanvas) {
      this.fogTexture = this.createBaseTexture(fogCanvas, 'linear');
      this.fogSprite.texture = this.fogTexture;
    } else {
      this.fogSprite.texture = Texture.EMPTY;
    }
    this.overviewSprite.texture = Texture.EMPTY;
  }

  private createBaseTexture(canvas: HTMLCanvasElement, scaleMode: 'nearest' | 'linear'): Texture {
    const texture = Texture.from(canvas);
    texture.source.scaleMode = scaleMode;
    return texture;
  }

  /** 底图精灵尺寸跟随 tileSize（scene：1px/tile；overview：1px/cell，cell = tileSize*step）。 */
  private layoutBaseSprites() {
    const input = this.baseInput;
    if (!input) {
      return;
    }
    if (input.overviewMode && input.overview) {
      const step = Math.max(input.overview.step || 1, 1);
      const cellSize = Math.max(this.tileSize * step, 1);
      this.overviewSprite.width = input.overview.cells_width * cellSize;
      this.overviewSprite.height = input.overview.cells_height * cellSize;
      return;
    }
    this.terrainSprite.width = input.planet.map_width * this.tileSize;
    this.terrainSprite.height = input.planet.map_height * this.tileSize;
    this.fogSprite.width = this.terrainSprite.width;
    this.fogSprite.height = this.terrainSprite.height;
  }

  private redrawGrid() {
    const g = this.gridGraphics;
    g.clear();
    const input = this.baseInput;
    if (!input || !this.layers?.grid) {
      return;
    }
    if (input.overviewMode) {
      const overview = input.overview;
      if (!overview) {
        return;
      }
      const step = Math.max(overview.step || 1, 1);
      const cellSize = Math.max(this.tileSize * step, 1);
      if (cellSize < 10) {
        return;
      }
      const width = overview.cells_width * cellSize;
      const height = overview.cells_height * cellSize;
      for (let x = 0; x <= overview.cells_width; x += 1) {
        g.moveTo(x * cellSize, 0).lineTo(x * cellSize, height);
      }
      for (let y = 0; y <= overview.cells_height; y += 1) {
        g.moveTo(0, y * cellSize).lineTo(width, y * cellSize);
      }
      g.stroke({ width: 1, color: COLOR_GRID, alpha: 0.12 });
      return;
    }
    if (!this.detailPolicy?.showSceneGrid) {
      return;
    }
    const width = input.planet.map_width * this.tileSize;
    const height = input.planet.map_height * this.tileSize;
    for (let x = 0; x <= input.planet.map_width; x += 1) {
      g.moveTo(x * this.tileSize, 0).lineTo(x * this.tileSize, height);
    }
    for (let y = 0; y <= input.planet.map_height; y += 1) {
      g.moveTo(0, y * this.tileSize).lineTo(width, y * this.tileSize);
    }
    g.stroke({ width: 1, color: COLOR_GRID, alpha: 0.08 });
  }

  // ---------- 图层可见性 ----------

  private applyLayerVisibility() {
    const layers = this.layers;
    if (!layers) {
      return;
    }
    const overview = this.overviewMode;
    this.terrainSprite.visible = !overview && layers.terrain && this.terrainTexture !== null;
    this.overviewSprite.visible = overview && this.overviewTexture !== null;
    this.fogSprite.visible = !overview && layers.fog && this.fogTexture !== null;
    // gridGraphics 的内容由 redrawGrid 决定（关闭时 clear），空图形本身无渲染开销，保持 visible。
    this.pipelinesGraphics.visible = !overview && layers.pipelines;
    this.powerGraphics.visible = !overview && layers.power;
    this.resourcesLayer.visible = !overview && layers.resources;
    this.constructionGraphics.visible = !overview && layers.construction;
    this.buildingsLayer.visible = !overview && layers.buildings;
    this.logisticsGraphics.visible = !overview && layers.logistics;
    this.unitsLayer.visible = !overview && layers.units;
    this.threatGraphics.visible = !overview && layers.threat;
  }

  // ---------- 实体节点（增量同步） ----------

  private syncNodes<T extends { id: string }, N extends SceneNode>(
    map: Map<string, N>,
    items: T[],
    layer: Container,
    create: (item: T) => N,
    update?: (node: N, item: T) => void,
  ) {
    const seen = new Set<string>();
    for (const item of items) {
      seen.add(item.id);
      let node = map.get(item.id);
      if (!node) {
        node = create(item);
        map.set(item.id, node);
        layer.addChild(node.container);
      } else {
        update?.(node, item);
      }
    }
    for (const [id, node] of map) {
      if (!seen.has(id)) {
        node.container.destroy({ children: true });
        map.delete(id);
      }
    }
  }

  private clearNodeCollection(map: Map<string, SceneNode>) {
    for (const node of map.values()) {
      node.container.destroy({ children: true });
    }
    map.clear();
  }

  /** tileSize/模式变化后按最新数据全量重建实体节点（缩放档切换是低频离散事件）。 */
  private rebuildEntityNodes() {
    const input = this.entitiesInput;
    this.clearNodeCollection(this.buildingNodes);
    this.clearNodeCollection(this.unitNodes);
    this.clearNodeCollection(this.resourceNodes);
    if (!input) {
      return;
    }
    this.syncBuildings(input.visible.buildings, input.catalog, input.playerId);
    this.syncUnits(input.visible.units, input.playerId);
    this.syncResources(input.visible.resources);
  }

  private syncBuildings(buildings: Building[], catalog: CatalogView | undefined, playerId: string) {
    const simplify = this.detailPolicy?.simplifyStructures ?? false;
    this.syncNodes(
      this.buildingNodes,
      buildings,
      this.buildingsLayer,
      (building) => this.createBuildingNode(building, catalog, playerId, simplify),
      (node, building) => {
        if (node.data !== building) {
          node.data = building;
          this.drawBuildingNode(node, catalog, playerId, simplify);
        }
      },
    );
  }

  private createBuildingNode(
    building: Building,
    catalog: CatalogView | undefined,
    playerId: string,
    simplify: boolean,
  ): BuildingNode {
    const container = new Container();
    const box = new Graphics();
    const icon = new Sprite();
    icon.anchor.set(0.5);
    container.addChild(box);
    container.addChild(icon);
    const node: BuildingNode = { container, box, icon, data: building };
    this.drawBuildingNode(node, catalog, playerId, simplify);
    return node;
  }

  private drawBuildingNode(node: BuildingNode, catalog: CatalogView | undefined, playerId: string, simplify: boolean) {
    const building = node.data;
    const { width, height } = getBuildingFootprint(building);
    const point = toTilePoint(building.position);
    const isOwn = building.owner_id === playerId;
    const pixelWidth = width * this.tileSize;
    const pixelHeight = height * this.tileSize;

    node.container.position.set(point.x * this.tileSize, point.y * this.tileSize);
    const box = node.box.clear();
    if (simplify) {
      box
        .rect(0, 0, Math.max(pixelWidth, 2), Math.max(pixelHeight, 2))
        .fill(isOwn ? { color: 0x24c9b6, alpha: 0.4 } : { color: 0xde5757, alpha: 0.38 });
    } else {
      box
        .rect(1, 1, Math.max(pixelWidth - 2, 2), Math.max(pixelHeight - 2, 2))
        .fill(isOwn ? { color: 0x24c9b6, alpha: 0.26 } : { color: 0xde5757, alpha: 0.22 })
        .stroke({ width: 2, color: isOwn ? COLOR_BUILDING_STROKE_OWN : COLOR_BUILDING_STROKE_ENEMY });
    }

    if (simplify) {
      node.icon.visible = false;
    } else {
      const catalogEntry = getBuildingCatalogEntry(catalog, building.type);
      node.icon.texture = getEmojiTexture(resolveIconGlyph(catalogEntry?.icon_key ?? building.type));
      const size = Math.max(Math.min(pixelWidth, pixelHeight), 4);
      node.icon.width = size;
      node.icon.height = size;
      node.icon.position.set(pixelWidth / 2, pixelHeight / 2);
      node.icon.visible = true;
    }
  }

  private syncUnits(units: Unit[], playerId: string) {
    const simplify = this.detailPolicy?.simplifyStructures ?? false;
    this.syncNodes(
      this.unitNodes,
      units,
      this.unitsLayer,
      (unit) => this.createUnitNode(unit, playerId, simplify),
      (node, unit) => {
        const point = toTilePoint(unit.position);
        node.targetX = tileCenter(point.x, this.tileSize);
        node.targetY = tileCenter(point.y, this.tileSize);
        if (this.frozen) {
          node.posX = node.targetX;
          node.posY = node.targetY;
          node.container.position.set(node.posX, node.posY);
        }
        if (node.data !== unit) {
          node.data = unit;
          this.drawUnitDot(node, playerId, simplify);
        }
      },
    );
  }

  private createUnitNode(unit: Unit, playerId: string, simplify: boolean): UnitNode {
    const container = new Container();
    const dot = new Graphics();
    container.addChild(dot);
    const point = toTilePoint(unit.position);
    const node: UnitNode = {
      container,
      dot,
      data: unit,
      targetX: tileCenter(point.x, this.tileSize),
      targetY: tileCenter(point.y, this.tileSize),
      posX: tileCenter(point.x, this.tileSize),
      posY: tileCenter(point.y, this.tileSize),
    };
    container.position.set(node.posX, node.posY);
    this.drawUnitDot(node, playerId, simplify);
    return node;
  }

  private drawUnitDot(node: UnitNode, playerId: string, simplify: boolean) {
    const isOwn = node.data.owner_id === playerId;
    const color = isOwn ? COLOR_UNIT_OWN : COLOR_UNIT_ENEMY;
    const dot = node.dot.clear();
    if (simplify) {
      const size = Math.max(3, this.tileSize * 0.32);
      dot.rect(-size / 2, -size / 2, size, size).fill(color);
    } else {
      dot.circle(0, 0, Math.max(3, this.tileSize * 0.22)).fill(color);
    }
  }

  private syncResources(resources: PlanetResource[]) {
    this.syncNodes(
      this.resourceNodes,
      resources,
      this.resourcesLayer,
      (resource) => this.createResourceNode(resource),
      (node, resource) => {
        node.data = resource;
      },
    );
  }

  private createResourceNode(resource: PlanetResource): ResourceNode {
    const container = new Container();
    const icon = new Sprite(getEmojiTexture(resolveIconGlyph(resource.kind)));
    icon.anchor.set(0.5);
    const size = Math.max(this.tileSize * 0.62, 4);
    icon.width = size;
    icon.height = size;
    container.addChild(icon);
    const point = toTilePoint(resource.position);
    container.position.set(tileCenter(point.x, this.tileSize), tileCenter(point.y, this.tileSize));
    return { container, icon, data: resource };
  }

  // ---------- 连线/静态实体层（sync 时整体重绘） ----------

  private redrawStaticLayers() {
    const input = this.entitiesInput;
    this.redrawPipelines(input);
    this.redrawPower(input);
    this.redrawConstruction(input);
    this.redrawLogistics(input);
    this.redrawThreat(input);
  }

  private redrawPipelines(input: PlanetSceneEntitiesInput | null) {
    const g = this.pipelinesGraphics.clear();
    if (!input) {
      return;
    }
    const ts = this.tileSize;
    for (const segment of input.visible.pipelineSegments) {
      const from = toTilePoint(segment.from_position);
      const to = toTilePoint(segment.to_position);
      g.moveTo(tileCenter(from.x, ts), tileCenter(from.y, ts))
        .lineTo(tileCenter(to.x, ts), tileCenter(to.y, ts));
    }
    g.stroke({ width: 3, color: COLOR_PIPELINE, alpha: 0.78 });
    for (const node of input.visible.pipelineNodes) {
      const point = toTilePoint(node.position);
      const side = Math.max(6, ts * 0.36);
      g.rect(tileCenter(point.x, ts) - side / 2, tileCenter(point.y, ts) - side / 2, side, side)
        .fill(node.fluid_id ? getResourceColorValue(node.fluid_id) : COLOR_PIPELINE);
    }
  }

  private redrawPower(input: PlanetSceneEntitiesInput | null) {
    const g = this.powerGraphics.clear();
    if (!input) {
      return;
    }
    const ts = this.tileSize;
    for (const link of input.visible.powerLinks) {
      const from = toTilePoint(link.from_position);
      const to = toTilePoint(link.to_position);
      const wireless = link.kind === 'wireless';
      if (wireless) {
        this.strokeDashed(
          g,
          tileCenter(from.x, ts),
          tileCenter(from.y, ts),
          tileCenter(to.x, ts),
          tileCenter(to.y, ts),
          [6, 6],
          { width: 2, color: COLOR_POWER_WIRELESS, alpha: 0.72 },
        );
      } else {
        g.moveTo(tileCenter(from.x, ts), tileCenter(from.y, ts))
          .lineTo(tileCenter(to.x, ts), tileCenter(to.y, ts))
          .stroke({ width: 3, color: COLOR_POWER_WIRED, alpha: 0.72 });
      }
    }
    for (const coverage of input.visible.powerCoverage) {
      const point = toTilePoint(coverage.position);
      g.circle(tileCenter(point.x, ts), tileCenter(point.y, ts), Math.max(6, ts * 0.32))
        .stroke({ width: 2, color: coverage.connected ? COLOR_POWER_WIRED : COLOR_POWER_DOWN, alpha: 0.92 });
    }
  }

  private redrawConstruction(input: PlanetSceneEntitiesInput | null) {
    const g = this.constructionGraphics.clear();
    if (!input) {
      return;
    }
    const ts = this.tileSize;
    for (const task of input.visible.constructionTasks) {
      const point = toTilePoint(task.position);
      g.rect(point.x * ts + 2, point.y * ts + 2, Math.max(ts - 4, 4), Math.max(ts - 4, 4))
        .stroke({ width: 3, color: constructionStateColor(task.state), alpha: 0.9 });
    }
  }

  private redrawLogistics(input: PlanetSceneEntitiesInput | null) {
    const g = this.logisticsGraphics.clear();
    if (!input) {
      return;
    }
    const ts = this.tileSize;
    for (const drone of input.visible.logisticsDrones) {
      const start = toTilePoint(drone.position);
      if (drone.target_pos) {
        const target = toTilePoint(drone.target_pos);
        this.strokeDashed(
          g,
          tileCenter(start.x, ts),
          tileCenter(start.y, ts),
          tileCenter(target.x, ts),
          tileCenter(target.y, ts),
          [8, 6],
          { width: 2, color: COLOR_DRONE, alpha: 0.72 },
        );
      }
      g.circle(tileCenter(start.x, ts), tileCenter(start.y, ts), Math.max(4, ts * 0.18)).fill(COLOR_DRONE);
    }
    for (const ship of input.visible.logisticsShips) {
      const start = toTilePoint(ship.position);
      if (ship.target_pos) {
        const target = toTilePoint(ship.target_pos);
        this.strokeDashed(
          g,
          tileCenter(start.x, ts),
          tileCenter(start.y, ts),
          tileCenter(target.x, ts),
          tileCenter(target.y, ts),
          [2, 8],
          { width: 2, color: COLOR_SHIP, alpha: 0.68 },
        );
      }
      const side = Math.max(6, ts * 0.32);
      g.rect(tileCenter(start.x, ts) - side / 2, tileCenter(start.y, ts) - side / 2, side, side).fill(COLOR_SHIP);
    }
  }

  private redrawThreat(input: PlanetSceneEntitiesInput | null) {
    const g = this.threatGraphics.clear();
    if (!input) {
      return;
    }
    const ts = this.tileSize;
    for (const force of input.visible.enemyForces) {
      const point = toTilePoint(force.position);
      const cx = tileCenter(point.x, ts);
      const cy = tileCenter(point.y, ts);
      const r = Math.max(6, ts * 0.28);
      g.poly([cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy], true).fill({ color: COLOR_ENEMY, alpha: 0.88 });
    }
    for (const detection of input.visible.detections) {
      for (const position of detection.detected_positions ?? []) {
        const point = toTilePoint(position);
        g.circle(tileCenter(point.x, ts), tileCenter(point.y, ts), Math.max(5, ts * 0.22))
          .stroke({ width: 2, color: COLOR_DETECTION, alpha: 0.76 });
      }
    }
  }

  private strokeDashed(
    g: Graphics,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    pattern: readonly number[],
    style: { width: number; color: number; alpha: number },
  ) {
    for (const [ax, ay, bx, by] of buildDashSegments(fromX, fromY, toX, toY, pattern)) {
      g.moveTo(ax, ay).lineTo(bx, by);
    }
    g.stroke(style);
  }

  // ---------- 交互叠加层 ----------

  private redrawInteraction() {
    const g = this.selectionGraphics.clear();
    const input = this.interactionInput;
    if (!input) {
      return;
    }
    const ts = this.tileSize;
    const { hoveredTile, selected, mode, overviewMode } = input;

    // 建造模式：幽灵 footprint 预览（绿=可建 红=阻塞），替代普通 hover 高亮
    if (!overviewMode && mode.kind === 'build' && hoveredTile && input.buildAssessment) {
      const assessment = input.buildAssessment;
      const blockedSet = new Set(assessment.blockedTiles.map((tile) => `${tile.x},${tile.y}`));
      for (let dy = 0; dy < assessment.footprint.height; dy += 1) {
        for (let dx = 0; dx < assessment.footprint.width; dx += 1) {
          const tx = hoveredTile.x + dx;
          const ty = hoveredTile.y + dy;
          const blocked = blockedSet.has(`${tx},${ty}`);
          const screenX = tx * ts;
          const screenY = ty * ts;
          g.rect(screenX, screenY, ts, ts)
            .fill(blocked ? { color: COLOR_GHOST_BLOCKED, alpha: 0.32 } : { color: COLOR_GHOST_OK, alpha: 0.28 })
            .stroke({ width: 1.5, color: blocked ? COLOR_GHOST_BLOCKED : COLOR_GHOST_OK });
        }
      }
      return;
    }

    // 移动/攻击模式：目标点准星高亮
    if (!overviewMode && (mode.kind === 'move' || mode.kind === 'attack') && hoveredTile) {
      const screenX = hoveredTile.x * ts;
      const screenY = hoveredTile.y * ts;
      const color = mode.kind === 'move' ? COLOR_GHOST_OK : COLOR_GHOST_BLOCKED;
      g.rect(screenX + 1, screenY + 1, Math.max(ts - 2, 2), Math.max(ts - 2, 2))
        .stroke({ width: 2.5, color });
      const mid = ts / 2;
      g.moveTo(screenX + mid, screenY + 2)
        .lineTo(screenX + mid, screenY + ts - 2)
        .moveTo(screenX + 2, screenY + mid)
        .lineTo(screenX + ts - 2, screenY + mid)
        .stroke({ width: 2.5, color });
      return;
    }

    if (!input.selectionVisible) {
      return;
    }

    const highlightTile = selected ? toTilePoint(selected.position) : hoveredTile;
    if (!highlightTile) {
      return;
    }

    if (overviewMode && input.overview) {
      const step = Math.max(input.overview.step || 1, 1);
      const cellSize = Math.max(ts * step, 1);
      const screenX = Math.floor(highlightTile.x / step) * cellSize;
      const screenY = Math.floor(highlightTile.y / step) * cellSize;
      g.rect(screenX + 1, screenY + 1, Math.max(cellSize - 2, 2), Math.max(cellSize - 2, 2))
        .stroke(selected
          ? { width: 3, color: COLOR_SELECTED }
          : { width: 2, color: 0xffffff, alpha: 0.7 });
      return;
    }

    if (!isTilePointVisible(highlightTile, input.viewportBounds, 1)) {
      return;
    }
    const screenX = highlightTile.x * ts;
    const screenY = highlightTile.y * ts;
    g.rect(screenX + 1.5, screenY + 1.5, Math.max(ts - 3, 2), Math.max(ts - 3, 2))
      .stroke(selected
        ? { width: 3, color: COLOR_SELECTED }
        : { width: 2, color: 0xffffff, alpha: 0.65 });
  }

  // ---------- ticker：单位平滑移动 + 选中环脉冲 ----------

  private readonly tick = (ticker: Ticker) => {
    if (this.disposed || this.frozen) {
      return;
    }
    // 上限 100ms：后台标签页恢复时不会一次性飞跃。
    const dt = Math.min(ticker.deltaMS, 100) / 1000;
    const blend = smoothingBlend(dt);
    for (const node of this.unitNodes.values()) {
      const dx = node.targetX - node.posX;
      const dy = node.targetY - node.posY;
      if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
        if (node.posX !== node.targetX || node.posY !== node.targetY) {
          node.posX = node.targetX;
          node.posY = node.targetY;
          node.container.position.set(node.posX, node.posY);
        }
        continue;
      }
      node.posX += dx * blend;
      node.posY += dy * blend;
      node.container.position.set(node.posX, node.posY);
    }
    this.pulsePhase += dt * 3.2;
    this.selectionGraphics.alpha = 0.85 + 0.15 * Math.sin(this.pulsePhase);

    // 战斗特效推进：完成的回收视图（受击闪白恢复节点 alpha）
    const completed = this.effectPool.advance(ticker.deltaMS);
    completed.forEach((effect) => this.recycleEffectView(effect));
    this.effectPool.active().forEach((effect) => {
      this.effectViews.get(effect.id)?.update(effect);
    });
  };
}
