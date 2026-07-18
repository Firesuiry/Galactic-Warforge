/**
 * 行星地图 Pixi 场景：底图纹理精灵/分块地表 + 实体节点树 + 轻量动效 ticker。
 *
 * 场景结构（除 backdrop/暗角外全部挂在 world 容器下，相机 = world.position）：
 * - 底图：scene 模式按有效 tileSize 分两路——≥4px 走 64×64 分块高分辨率地表
 *   （planet-terrain-chunks：8px/tile 烘焙、可见块按需生成、LRU 64 块、签名脏校验），
 *   <4px 走 1px/tile 整图画布；overview 模式 1px/cell 聚合画布。
 *   迷雾始终 1px/tile（linear 放大得软边界）；地形/overview 用 nearest。
 *   数据变化时重生成纹理并销毁旧纹理（emoji/暗角纹理由全局缓存管理，不在此销毁）。
 * - 氛围层：水面流光（低分辨率动态遮罩画布：1px/tile 水格遮罩 × ticker 驱动的移动光带，
 *   add 混合 + alpha 呼吸，不动静态地表纹理）+ 岩浆 1px mask 的呼吸辉光；
 *   暗角为 stage 级静态叠加。相位基于固定时钟，frozen 停在 0。
 * - 实体：建筑（程序化矢量结构精灵：原型剪影 + 投影/底座板 + 队伍色底座描边条 + emoji 角标，
 *   planet-building-sprites 烘焙缓存；风机叶片/furnace 辉光走 ticker 动效）/单位（带朝向楔形 + HP 弧）
 *   /资源（晶簇贴花 + emoji）走逐节点 Container（增量同步）；物流/电网/管道/工地/敌情各一个 Graphics，
 *   sync 时整体重绘（工地为脚手架虚线 + 进度条）。建筑+单位在同一个 sortableChildren 容器按
 *   tile 底部 y 排序（zIndex 单位为小数 tile 坐标）：建筑结构向上溢出 footprint，单位走到高建筑
 *   北侧会被遮住上半；单位 zIndex 随平滑移动逐帧更新。buildings/units 图层开关落到逐节点 visible。
 * - 交互叠加：选中黄框（防御建筑附射程圈）/ hover 白框 / 建造幽灵（footprint + catalog 范围圈）/
 *   move/attack 准星（单个 Graphics，数据变化重绘）；
 *   地块 hover 轻量高亮为独立 Graphics（形状只随 tileSize 重画，hover 变化仅动位置/可见性，零重建）。
 *
 * ticker 只做轻量动效：单位显示位置向数据位置指数趋近（k≈8/s）+ 选中环透明度脉冲 +
 * 缩放档切换的 world 变换补间（~180ms，frozen 时瞬切）+ 分块惰性补块（每帧 ≤2 块）+
 * 氛围相位推进，不做任何数据重建。
 * 视觉契约与旧 entity-draw.ts / PlanetMapCanvas 对齐。
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
import { getEmojiTexture, getGlowTexture, getVignetteTexture } from '@/engine/textures';
import { createTween, easeOutCubic, lerp, type Tween } from '@/engine/tween';
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
  canonicalTileIndex,
  getBuildingCatalogEntry,
  getBuildingFootprint,
  isWrapAxisEnabled,
  toTilePoint,
  wrapMod,
  type PlanetRenderView,
  type SelectedEntity,
  type TilePoint,
  type ViewportTileBounds,
} from '@/features/planet-map/model';
import {
  BUILDING_SPRITE_TILE_PX,
  FURNACE_GLOW_FRACTION,
  ROTOR_HUB_FRACTION,
  buildingSpriteLayout,
  getBuildingSpriteTexture,
  getWindBladesTexture,
  hasGlowWindow,
  hasRotorBlades,
  resolveBuildingAccent,
  resolveBuildingArchetype,
  resolveBuildingVisualState,
  resolveConveyorBeltDirection,
} from '@/features/planet-map/planet-building-sprites';
import {
  renderPlanetFogCanvas,
  renderPlanetFluidMaskCanvas,
  renderPlanetOverviewCanvas,
  renderPlanetTerrainCanvas,
} from '@/features/planet-map/planet-base-map';
import {
  LruMap,
  TERRAIN_CHUNK_BUILD_BUDGET_PER_FRAME,
  TERRAIN_CHUNK_CACHE_LIMIT,
  TERRAIN_CHUNK_TILES,
  chunkSpanAxis,
  computeVisibleChunkKeys,
  parseChunkKey,
  renderTerrainChunkCanvas,
  terrainChunkSignature,
  useChunkedTerrain,
  type TerrainWrapSampling,
} from '@/features/planet-map/planet-terrain-chunks';
import { isTilePointVisible, type SceneRenderDetailPolicy } from '@/features/planet-map/render';
import type { PlanetInteractionMode, PlanetLayerState } from '@/features/planet-map/store';
import { getResourceColorValue, type VisibleEntities } from '@/features/planet-map/visible-entities';

/** 单位平滑移动的指数趋近速率（1/s）：pos += (target - pos) * (1 - exp(-dt * k))。 */
export const UNIT_SMOOTHING_RATE = 8;

/** 缩放档切换的补间时长（ms）：渲染层 world 变换从旧值动画到新值，数据层档位离散不变。 */
export const PLANET_ZOOM_TWEEN_MS = 180;

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

/**
 * 虚线圆弧：沿圆周按 dash pattern（如画 8 空 6）切成若干"画"段微弦，
 * 供 Graphics 模拟虚线圆（Pixi Graphics 无原生 setLineDash）。
 * pattern 为空（或全 0）时退化为完整圆。
 */
export function buildDashArcSegments(
  cx: number,
  cy: number,
  radius: number,
  pattern: readonly number[],
): Array<readonly [number, number, number, number]> {
  if (radius <= 0) {
    return [];
  }
  const safePattern = pattern.map((value) => Math.max(value, 0)).filter((value) => value > 0);
  const circumference = Math.PI * 2 * radius;
  // 微弦弧长 ≈ 2px（至少 24 段）：兼顾圆滑与段数。
  const chordCount = Math.max(Math.ceil(circumference / 2), 24);
  const chordLength = circumference / chordCount;
  const pointAt = (index: number) => {
    const angle = (index / chordCount) * Math.PI * 2;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as const;
  };
  const segments: Array<readonly [number, number, number, number]> = [];
  let drawing = true;
  let patternIndex = 0;
  let remaining = safePattern.length > 0 ? safePattern[0] : Number.POSITIVE_INFINITY;
  for (let i = 0; i < chordCount; i += 1) {
    if (drawing) {
      const [x1, y1] = pointAt(i);
      const [x2, y2] = pointAt(i + 1);
      segments.push([x1, y1, x2, y2]);
    }
    if (safePattern.length === 0) {
      continue;
    }
    remaining -= chordLength;
    while (remaining <= 0) {
      drawing = !drawing;
      patternIndex = (patternIndex + 1) % safePattern.length;
      remaining += safePattern[patternIndex];
    }
  }
  return segments;
}

/** 范围圈规格：kind 决定配色/线型（combat 橙红细实线，power 黄色虚线对齐电网语义）。 */
export interface RangeCircleSpec {
  kind: 'combat' | 'power';
  /** 半径（tile 单位，与 server 曼哈顿距离语义一致，绘制时换算像素）。 */
  radiusTiles: number;
}

/**
 * build 幽灵范围圈：catalog 条目带 combat_range / power_range 时各出一圈；
 * 无范围字段的建筑类型不画。
 */
export function resolveGhostRangeCircles(
  catalog: CatalogView | undefined,
  buildingType: string | undefined,
): RangeCircleSpec[] {
  if (!buildingType) {
    return [];
  }
  const entry = getBuildingCatalogEntry(catalog, buildingType);
  const circles: RangeCircleSpec[] = [];
  if (entry?.combat_range && entry.combat_range > 0) {
    circles.push({ kind: 'combat', radiusTiles: entry.combat_range });
  }
  if (entry?.power_range && entry.power_range > 0) {
    circles.push({ kind: 'power', radiusTiles: entry.power_range });
  }
  return circles;
}

/**
 * 选中建筑射程圈半径（tile）：已放置防御建筑读 runtime.functions.combat.range；
 * 无战斗能力返回 undefined。供电建筑的无线覆盖由电网图层（连线 + 覆盖标记）承担，不重复画圈。
 */
export function resolveSelectedCombatRange(building: Building | undefined | null): number | undefined {
  const range = building?.runtime?.functions?.combat?.range;
  return range !== undefined && range > 0 ? range : undefined;
}

/** 确定性 id hash → [0, 2π) 动画相位（同 id 同相位，截图可复现）。 */
export function entityAnimPhase(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash ^ id.charCodeAt(i)) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return ((hash % 6283) / 6283) * Math.PI * 2;
}

/**
 * 单位楔形（带朝向箭头）多边形：默认指向正上 (-y)，顶点在 (0,-r)。
 * 尾部分叉内凹，低分辨率下也能读出朝向。
 */
export function unitWedgePoints(radius: number): number[] {
  const r = Math.max(radius, 1.5);
  return [
    0, -r,
    r * 0.78, r * 0.72,
    0, r * 0.3,
    -r * 0.78, r * 0.72,
  ];
}

/**
 * 单位朝向解析：移动中朝 target_pos；否则朝 attack_target 解析位置；
 * 都无则保留 fallback（节点存续期间的最近朝向，默认朝上）。
 */
export function resolveUnitDirection(
  unit: Pick<Unit, 'position' | 'is_moving' | 'target_pos' | 'attack_target'>,
  fallback: { x: number; y: number },
  resolveTarget: (entityId: string) => TilePoint | null,
): { x: number; y: number } {
  const origin = toTilePoint(unit.position);
  let target: TilePoint | null = null;
  if (unit.is_moving && unit.target_pos) {
    target = toTilePoint(unit.target_pos);
  } else if (unit.attack_target) {
    target = resolveTarget(unit.attack_target);
  }
  if (!target) {
    return fallback;
  }
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) {
    return fallback;
  }
  return { x: dx / length, y: dy / length };
}

export interface HpArcParams {
  /** 血量比 [0, 1]。 */
  ratio: number;
  /** 弧色：满血绿 → 残血红（中段黄）。 */
  color: number;
  /** 是否绘制（有血量数据且受伤才画）。 */
  visible: boolean;
}

/** HP 弧参数：有 max_hp 且 hp < max_hp 时显示；颜色绿→黄→红按 ratio 插值。 */
export function hpArcParams(hp: number | undefined, maxHp: number | undefined): HpArcParams {
  if (hp === undefined || maxHp === undefined || maxHp <= 0) {
    return { ratio: 1, color: 0x69db7c, visible: false };
  }
  const ratio = Math.min(Math.max(hp / maxHp, 0), 1);
  // 绿 (0x69db7c) → 黄 (0xffd43b) → 红 (0xe03131)：ratio 0.5 处为黄。
  const t = ratio < 0.5 ? ratio * 2 : (ratio - 0.5) * 2;
  const from = ratio < 0.5 ? 0xe03131 : 0xffd43b;
  const to = ratio < 0.5 ? 0xffd43b : 0x69db7c;
  const r = Math.round(((from >> 16) & 0xff) + (((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * t);
  const g = Math.round(((from >> 8) & 0xff) + (((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * t);
  const b = Math.round((from & 0xff) + ((to & 0xff) - (from & 0xff)) * t);
  return { ratio, color: (r << 16) | (g << 8) | b, visible: ratio < 1 };
}

/** 工地进度：remaining/total_ticks 可算时返回 [0,1]，否则 null（不画进度条）。 */
export function constructionProgress(task: { state: string; remaining_ticks?: number; total_ticks?: number }): number | null {
  if (task.state === 'completed') {
    return 1;
  }
  if (task.total_ticks === undefined || task.total_ticks <= 0 || task.remaining_ticks === undefined) {
    return null;
  }
  return Math.min(Math.max(1 - task.remaining_ticks / task.total_ticks, 0), 1);
}

/**
 * 遮挡排序键（zIndex，单位为小数 tile 坐标）：建筑按 footprint 底行 y，
 * 结构向上溢出 footprint → 底行相同者先画，y 小者被遮挡。
 */
export function buildingSortKey(tileY: number, footprintHeight: number): number {
  return tileY + footprintHeight;
}

/** 单位遮挡排序键：平滑移动中的显示位置 y（像素）换算成小数 tile 坐标，随移动逐帧更新。 */
export function unitSortKey(posY: number, tileSize: number): number {
  return posY / Math.max(tileSize, 1e-6);
}

/**
 * 地块 hover 轻量高亮落点：inspect/move/attack 模式下悬停即亮；
 * build 模式由幽灵 footprint 承担（不叠加），overview 或无 hover 时隐藏。
 */
export function resolveTileHoverHighlight(
  hoveredTile: TilePoint | null,
  mode: PlanetInteractionMode,
  overviewMode: boolean,
): TilePoint | null {
  if (overviewMode || !hoveredTile || mode.kind === 'build') {
    return null;
  }
  return hoveredTile;
}

/**
 * 资源点底座贴花多边形组（晶簇/岩块）：3 片确定性"晶簇"三角形 + 底托椭圆参数，
 * 形状种子来自 kind 字符串（同种资源同形）。返回容器坐标（贴花中心在原点）。
 */
export function resourceDecalLayout(kind: string, size: number): {
  shards: number[][];
  baseRadiusX: number;
  baseRadiusY: number;
} {
  let hash = 5381;
  for (let i = 0; i < kind.length; i += 1) {
    hash = ((hash << 5) + hash + kind.charCodeAt(i)) >>> 0;
  }
  const rand = () => {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    hash >>>= 0;
    return hash / 0xffffffff;
  };
  const r = size / 2;
  const shards: number[][] = [];
  for (let i = 0; i < 3; i += 1) {
    const cx = (rand() - 0.5) * r * 0.9;
    const height = r * (0.55 + rand() * 0.45);
    const halfWidth = r * (0.22 + rand() * 0.14);
    const lean = (rand() - 0.5) * r * 0.3;
    // 底边贴底托上沿，尖端略偏（晶簇感）
    shards.push([
      cx - halfWidth, 0,
      cx + halfWidth, 0,
      cx + lean, -height,
    ]);
  }
  return { shards, baseRadiusX: r * 0.95, baseRadiusY: r * 0.38 };
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
  /** 数据层离散缩放档：档位变化触发渲染层补间（resize 导致的 tileSize 变化不播动画）。 */
  zoomIndex: number;
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
  /** build 模式幽灵范围圈数据源（catalog 的 combat_range / power_range）。 */
  catalog?: CatalogView;
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

/** 底图镜像精灵：环绕轴上把整图纹理在 +W/+H/(+W,+H) 处各贴一份，填充接缝另一侧。 */
interface MirrorSpriteEntry {
  sprite: Sprite;
  /** 纹理/尺寸来源（主精灵）；镜像共享其纹理，不单独销毁。 */
  source: Sprite;
  shiftX: boolean;
  shiftY: boolean;
}

interface BuildingNode extends SceneNode {
  /** 队伍色底座描边条（不烘焙进纹理，缓存键与队伍无关）。 */
  base: Graphics;
  /** 程序化矢量结构精灵（bldg:* 缓存纹理）。 */
  sprite: Sprite;
  /** 类型 emoji 角标（右上角小尺寸，主视觉已降级）。 */
  badge: Sprite;
  /** 受损/故障警示角标（ticker 呼吸，frozen 停 0 相位）。 */
  warning: Sprite;
  /** 风机旋转叶片（独立小 sprite，ticker 驱动；非风机为 null）。 */
  blades: Sprite | null;
  /** furnace 发光窗呼吸辉光（非 furnace 为 null）。 */
  glow: Sprite | null;
  data: Building;
  /** 确定性动画相位（由 id hash，截图可复现；frozen 恒 0）。 */
  phase: number;
}

interface UnitNode extends SceneNode {
  /** 楔形（随朝向旋转）。 */
  dot: Graphics;
  /** HP 弧（不随朝向旋转，恒在屏幕上方）。 */
  hp: Graphics;
  data: Unit;
  targetX: number;
  targetY: number;
  posX: number;
  posY: number;
  /** 最近朝向（单位向量，楔形朝向；默认朝上 (0,-1)）。 */
  dirX: number;
  dirY: number;
}

interface ResourceNode extends SceneNode {
  /** 晶簇/岩块底座贴花（资源调色板上色，emoji 坐在其上）。 */
  base: Graphics;
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
const COLOR_RANGE_COMBAT = 0xff922b;

/** 建筑 emoji 角标显示门槛（tileSize 低于该值时类型靠剪影+配色辨认）。 */
export const BUILDING_BADGE_MIN_TILE_SIZE = 16;
/** 单位楔形填充暗底色（队色描边）。 */
const COLOR_UNIT_WEDGE_FILL = 0x1c2430;
/** 风机叶片转速（rad/s，ticker 驱动，frozen 停 0 相位）。 */
const WIND_BLADE_SPEED = 2.4;
/** 受损/故障警示角标呼吸参数。 */
const WARNING_BADGE_BASE_ALPHA = 0.75;
const WARNING_BADGE_ALPHA_SWING = 0.25;
/** furnace 发光窗辉光呼吸参数。 */
const FURNACE_GLOW_BASE_ALPHA = 0.55;
const FURNACE_GLOW_ALPHA_SWING = 0.3;

/** 开火闪光配色：普通单位青白 / 防御塔黄白（克制，短亮线一过即隐）。 */
const COLOR_FIRE_UNIT = 0xa5f3fc;
const COLOR_FIRE_DEFENSE = 0xfde68a;
/** 伤害飘字配色：敌方受击红色系 / 己方受击橙色系（与既有己敌配色一致）。 */
const COLOR_FLOAT_ENEMY_HIT = 0xf87171;
const COLOR_FLOAT_OWN_HIT = 0xfbbf24;
/** 受击闪白的 alpha 下探幅度（1 → 1-DEPTH → 1 的正弦脉冲）。 */
const HIT_FLASH_ALPHA_DEPTH = 0.55;

/** 水面流光高亮：add 混合，移动光带由低分辨率动态遮罩驱动（frozen 停在 0 相位）。 */
const WATER_SHINE_BASE_ALPHA = 0.7;
const WATER_SHINE_ALPHA_SWING = 0.15;
/** 动态遮罩画布单轴上限（低分辨率，防大图逐帧重绘过贵）。 */
const WATER_SHINE_MAX_AXIS_PX = 512;
/** 岩浆呼吸辉光：add 混合，alpha 正弦呼吸。 */
const LAVA_GLOW_BASE_ALPHA = 0.12;
const LAVA_GLOW_ALPHA_SWING = 0.05;

/** 分块地表缓存条目（场景自有纹理，逐出/销毁时由场景负责 destroy(true)）。 */
interface TerrainChunkEntry {
  sprite: Sprite;
  texture: Texture;
  signature: string;
}

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
  private readonly terrainChunkLayer: Container;
  private readonly ambientLayer: Container;
  private readonly waterShineSprite: Sprite;
  private readonly lavaGlowSprite: Sprite;
  private readonly vignetteSprite: Sprite;
  private readonly fogSprite: Sprite;
  private readonly overviewSprite: Sprite;
  private readonly gridGraphics: Graphics;
  private readonly hoverGraphics: Graphics;
  private readonly pipelinesGraphics: Graphics;
  private readonly powerGraphics: Graphics;
  private readonly resourcesLayer: Container;
  private readonly constructionGraphics: Graphics;
  private readonly entitiesLayer: Container;
  private readonly logisticsGraphics: Graphics;
  private readonly threatGraphics: Graphics;
  private readonly selectionGraphics: Graphics;
  private readonly effectsLayer: Container;

  private terrainTexture: Texture | null = null;
  private fogTexture: Texture | null = null;
  private overviewTexture: Texture | null = null;
  private lavaMaskTexture: Texture | null = null;
  private waterShineTexture: Texture | null = null;
  /** 1px/tile 水格遮罩（仅 2D 合成用，不上 GPU）；无水格时为 null。 */
  private waterMaskCanvas: HTMLCanvasElement | null = null;
  /** 低分辨率动态遮罩画布（移动光带 × 水格遮罩），ticker 逐帧重绘（frozen 只绘 0 相位一次）。 */
  private waterShineCanvas: HTMLCanvasElement | null = null;

  /** 地表路径：legacy = 1px/tile 整图画布（1/2px 档）；chunked = 64×64 分块 8px/tile 高分辨率。 */
  private terrainPath: 'legacy' | 'chunked' = 'legacy';
  private readonly chunks = new LruMap<string, TerrainChunkEntry>(TERRAIN_CHUNK_CACHE_LIMIT, (_key, entry) => {
    entry.sprite.destroy();
    entry.texture.destroy(true);
  });
  private chunkQueue: string[] = [];
  private neededChunkKeys = new Set<string>();
  /** 氛围动效的固定时钟（s）：ticker 累积 dt，frozen 恒为 0 → 相位确定。 */
  private ambientTime = 0;
  private mapPixelWidth = 0;
  private mapPixelHeight = 0;

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
  /** 环绕渲染状态：每轴是否环绕（世界像素 > 视口像素）+ 视口起始 tile（cut，unwrapped）。 */
  private wrapX = false;
  private wrapY = false;
  private cutX = 0;
  private cutY = 0;
  private readonly mirrorSprites: MirrorSpriteEntry[] = [];
  /** 渲染层实际应用的 world 变换（补间期间与数据层目标值 offsetX/offsetY 不同步）。 */
  private appliedScale = 1;
  private appliedX = 0;
  private appliedY = 0;
  private zoomTween: { fromScale: number; fromX: number; fromY: number; toX: number; toY: number; tween: Tween } | null = null;
  private lastAppliedZoomIndex: number | null = null;
  private lastAppliedMode: boolean | null = null;
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
    this.terrainChunkLayer = new Container();
    this.ambientLayer = new Container();
    // 水面流光：动态遮罩纹理 sprite（add 混合），ticker 逐帧重绘低分辨率遮罩（光带移动 + alpha 呼吸）。
    this.waterShineSprite = new Sprite();
    this.waterShineSprite.blendMode = 'add';
    this.waterShineSprite.alpha = WATER_SHINE_BASE_ALPHA;
    this.waterShineSprite.visible = false;
    // 岩浆呼吸：岩浆格 1px mask 纹理直接 tint 亮橙 + add 混合，ticker 驱动 alpha 呼吸。
    this.lavaGlowSprite = new Sprite();
    this.lavaGlowSprite.blendMode = 'add';
    this.lavaGlowSprite.tint = 0xff7a28;
    this.lavaGlowSprite.alpha = LAVA_GLOW_BASE_ALPHA;
    this.lavaGlowSprite.visible = false;
    // 全屏轻暗角：stage 级（不随相机），resize 时铺满屏幕。
    this.vignetteSprite = new Sprite(getVignetteTexture());
    this.fogSprite = new Sprite();
    this.overviewSprite = new Sprite();
    this.gridGraphics = new Graphics();
    // 地块 hover 轻量高亮：形状只随 tileSize 重画，hover 变化仅动位置/可见性（零重建）。
    this.hoverGraphics = new Graphics();
    this.hoverGraphics.visible = false;
    this.pipelinesGraphics = new Graphics();
    this.powerGraphics = new Graphics();
    this.resourcesLayer = new Container();
    this.constructionGraphics = new Graphics();
    this.entitiesLayer = new Container();
    // 遮挡排序：建筑+单位同容器按 tile 底部 y 排序（zIndex 单位为小数 tile 坐标，
    // 建筑取 footprint 底行，单位取平滑移动中的显示位置），y 小者先画被高建筑遮挡。
    this.entitiesLayer.sortableChildren = true;
    this.logisticsGraphics = new Graphics();
    this.threatGraphics = new Graphics();
    this.selectionGraphics = new Graphics();
    this.effectsLayer = new Container();

    // z 序对齐旧实现：地形 < 水面/岩浆氛围 < 网格 < 迷雾 < hover 高亮 < 管网/电网 < 资源 < 工地
    // < 实体（建筑+单位统一 y 排序） < 物流 < 敌情 < 选中叠加 < 战斗特效；
    // 暗角在 world 之后，屏幕空间压在一切之上。
    this.app.stage.addChild(this.backdrop);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.terrainSprite);
    this.addMirrorSprites(this.terrainSprite, this.world);
    this.world.addChild(this.terrainChunkLayer);
    this.world.addChild(this.ambientLayer);
    this.ambientLayer.addChild(this.waterShineSprite);
    this.addMirrorSprites(this.waterShineSprite, this.ambientLayer);
    this.ambientLayer.addChild(this.lavaGlowSprite);
    this.addMirrorSprites(this.lavaGlowSprite, this.ambientLayer);
    this.world.addChild(this.overviewSprite);
    this.world.addChild(this.gridGraphics);
    this.world.addChild(this.fogSprite);
    this.addMirrorSprites(this.fogSprite, this.world);
    this.world.addChild(this.hoverGraphics);
    this.world.addChild(this.pipelinesGraphics);
    this.world.addChild(this.powerGraphics);
    this.world.addChild(this.resourcesLayer);
    this.world.addChild(this.constructionGraphics);
    this.world.addChild(this.entitiesLayer);
    this.world.addChild(this.logisticsGraphics);
    this.world.addChild(this.threatGraphics);
    this.world.addChild(this.selectionGraphics);
    this.world.addChild(this.effectsLayer);
    this.app.stage.addChild(this.vignetteSprite);

    // 首帧即备好 hover 高亮形状（后续仅 tileSize 变化时重画）。
    this.redrawHoverShape();
    this.handleResize();
    this.app.renderer.on('resize', this.handleResize);
    this.app.ticker.add(this.tick);
  }

  destroy() {
    this.disposed = true;
    this.app.ticker.remove(this.tick);
    this.app.renderer.off('resize', this.handleResize);
    this.destroyBaseTextures();
    this.clearTerrainChunks();
    // 暗角 sprite 销毁但纹理来自全局缓存（engine/textures），不得 destroy(true)。
    this.vignetteSprite.destroy();
    this.waterShineSprite.destroy();
    this.lavaGlowSprite.destroy();
    // 镜像精灵只持有共享纹理引用，单独销毁 sprite 即可。
    for (const mirror of this.mirrorSprites) {
      mirror.sprite.destroy();
    }
    this.mirrorSprites.length = 0;
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
    const previousTileSize = this.tileSize;
    const tileSizeChanged = input.tileSize !== previousTileSize;
    this.offsetX = input.offsetX;
    this.offsetY = input.offsetY;
    this.tileSize = input.tileSize;
    // 环绕状态（轴 + 视口起始 tile）：cut 变化时把实体/连线/交互叠加重摆到规范坐标。
    // tileSize 变化走全量重建路径，已包含等价重摆，无需重复。
    const wrapChanged = this.updateWrapState();
    if (wrapChanged && !tileSizeChanged) {
      this.relayoutWrappedPositions();
      this.redrawStaticLayers();
      this.redrawInteraction();
      this.redrawGrid();
    }
    this.layoutBaseSprites();
    // 网格只覆盖可见范围，平移/缩放都要重画（每帧几百条线段，代价可忽略）。
    this.redrawGrid();
    if (tileSizeChanged) {
      this.redrawHoverShape();
      this.rebuildEntityNodes();
      this.redrawStaticLayers();
      this.redrawInteraction();
      this.applyLayerVisibility();
    }

    // 地表路径同步：缩放档跨过 4px 阈值或模式切换时 legacy ↔ chunked 切换；
    // 相机平移只更新可见块计划（缺失块进惰性队列）。
    const desiredPath = useChunkedTerrain(this.overviewMode, input.tileSize) ? 'chunked' : 'legacy';
    if (desiredPath !== this.terrainPath) {
      this.syncTerrainPath();
    } else if (desiredPath === 'chunked') {
      if (tileSizeChanged) {
        this.layoutTerrainChunks();
      }
      this.updateChunkPlan();
    }

    // 缩放补间：离散档位变化时，渲染变换（world scale/position）从当前值 ~180ms 补间到
    // scale=1@目标 offset。起始帧按 旧tileSize/新tileSize 收缩 world.scale，
    // 使子节点按新尺寸重建后首帧视觉与旧视图连续；平移/首帧/模式切换/frozen 直接落位。
    const modeSwitched = this.lastAppliedMode !== null && this.lastAppliedMode !== this.overviewMode;
    const zoomIndexChanged = this.lastAppliedZoomIndex !== null && input.zoomIndex !== this.lastAppliedZoomIndex;
    if (!this.frozen && zoomIndexChanged && !modeSwitched) {
      const fromScale = this.appliedScale * (previousTileSize / input.tileSize);
      // 归一化后的目标 offset 可能与当前渲染位置相差整数个地图周期（等价分支），
      // 补间目标对齐到最近分支，避免 180ms 内扫过整张地图。
      const periodX = (this.baseInput?.planet.map_width ?? 0) * input.tileSize;
      const periodY = (this.baseInput?.planet.map_height ?? 0) * input.tileSize;
      const alignBranch = (target: number, reference: number, period: number, wrap: boolean) => (
        wrap && period > 0 ? target + Math.round((reference - target) / period) * period : target
      );
      this.zoomTween = {
        fromScale,
        fromX: this.appliedX,
        fromY: this.appliedY,
        toX: alignBranch(this.offsetX, this.appliedX, periodX, this.wrapX),
        toY: alignBranch(this.offsetY, this.appliedY, periodY, this.wrapY),
        tween: createTween(PLANET_ZOOM_TWEEN_MS, easeOutCubic),
      };
      this.applyCameraTransform(fromScale, this.appliedX, this.appliedY);
    } else {
      this.zoomTween = null;
      this.applyCameraTransform(1, this.offsetX, this.offsetY);
    }
    this.lastAppliedZoomIndex = input.zoomIndex;
    this.lastAppliedMode = this.overviewMode;
  }

  /** 应用渲染层相机变换：world.scale 承载补间中的缩放混合，空闲时恒为 1。 */
  private applyCameraTransform(scale: number, x: number, y: number) {
    this.appliedScale = scale;
    this.appliedX = x;
    this.appliedY = y;
    this.world.scale.set(scale);
    this.world.position.set(x, y);
  }

  // ---------- 环绕渲染（toroidal wrap） ----------

  /** 为主精灵登记 3 个镜像（+X / +Y / +XY），共享纹理、随主精灵布局与可见性。 */
  private addMirrorSprites(source: Sprite, parent: Container) {
    for (const [shiftX, shiftY] of [[true, false], [false, true], [true, true]] as const) {
      const sprite = new Sprite();
      sprite.visible = false;
      sprite.blendMode = source.blendMode;
      sprite.tint = source.tint;
      parent.addChild(sprite);
      this.mirrorSprites.push({ sprite, source, shiftX, shiftY });
    }
  }

  /** 重算环绕状态（环绕轴 + 视口起始 tile）；返回是否有变化。 */
  private updateWrapState() {
    const planet = this.baseInput?.planet;
    let nextWrapX = false;
    let nextWrapY = false;
    if (planet && !this.overviewMode) {
      nextWrapX = isWrapAxisEnabled(planet.map_width * this.tileSize, this.app.screen.width);
      nextWrapY = isWrapAxisEnabled(planet.map_height * this.tileSize, this.app.screen.height);
    }
    const nextCutX = nextWrapX ? Math.floor(-this.offsetX / this.tileSize) : 0;
    const nextCutY = nextWrapY ? Math.floor(-this.offsetY / this.tileSize) : 0;
    const changed = nextWrapX !== this.wrapX || nextWrapY !== this.wrapY
      || nextCutX !== this.cutX || nextCutY !== this.cutY;
    this.wrapX = nextWrapX;
    this.wrapY = nextWrapY;
    this.cutX = nextCutX;
    this.cutY = nextCutY;
    return changed;
  }

  /** 真实 tile → 规范（unwrapped）tile：视口跨接缝时把接缝另一侧的内容平移进来。 */
  private canonTileX(tile: number) {
    const mapWidth = this.baseInput?.planet.map_width ?? 1;
    return this.wrapX ? canonicalTileIndex(tile, this.cutX, mapWidth) : tile;
  }

  private canonTileY(tile: number) {
    const mapHeight = this.baseInput?.planet.map_height ?? 1;
    return this.wrapY ? canonicalTileIndex(tile, this.cutY, mapHeight) : tile;
  }

  /** 真实 tile → 世界像素（tile 左上角）。 */
  private pxTileX(tile: number) {
    return this.canonTileX(tile) * this.tileSize;
  }

  private pxTileY(tile: number) {
    return this.canonTileY(tile) * this.tileSize;
  }

  /** 真实 tile → 世界像素（tile 中心）。 */
  private pxCenterX(tile: number) {
    return tileCenter(this.canonTileX(tile), this.tileSize);
  }

  private pxCenterY(tile: number) {
    return tileCenter(this.canonTileY(tile), this.tileSize);
  }

  /** 镜像精灵布局/可见性：贴主精灵纹理与尺寸，位置平移一个地图周期。 */
  private layoutMirrorSprites() {
    for (const mirror of this.mirrorSprites) {
      mirror.sprite.texture = mirror.source.texture;
      mirror.sprite.width = mirror.source.width;
      mirror.sprite.height = mirror.source.height;
      mirror.sprite.position.set(
        mirror.shiftX ? this.mapPixelWidth : 0,
        mirror.shiftY ? this.mapPixelHeight : 0,
      );
      mirror.sprite.visible = mirror.source.visible
        && (!mirror.shiftX || this.wrapX)
        && (!mirror.shiftY || this.wrapY);
    }
  }

  /**
   * 相机 cut 变化后的重定位：把实体节点重新摆到规范坐标。
   * 非接缝实体的规范坐标不随 cut 变化（仅接缝处实体跳变），所以这是廉价的 position 更新，
   * 单位不做跨图平滑滑行（直接落位），静态连线层与交互叠加层重绘。
   */
  private relayoutWrappedPositions() {
    for (const node of this.buildingNodes.values()) {
      const point = toTilePoint(node.data.position);
      const { height } = getBuildingFootprint(node.data);
      node.container.position.set(this.pxTileX(point.x), this.pxTileY(point.y));
      node.container.zIndex = buildingSortKey(this.canonTileY(point.y), height);
    }
    for (const node of this.unitNodes.values()) {
      const point = toTilePoint(node.data.position);
      node.targetX = this.pxCenterX(point.x);
      node.targetY = this.pxCenterY(point.y);
      node.posX = node.targetX;
      node.posY = node.targetY;
      node.container.position.set(node.posX, node.posY);
      node.container.zIndex = unitSortKey(node.posY, this.tileSize);
    }
    for (const node of this.resourceNodes.values()) {
      const point = toTilePoint(node.data.position);
      node.container.position.set(this.pxCenterX(point.x), this.pxCenterY(point.y));
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

  /** resize 统一入口：背景/暗角铺满屏幕；视口变化后环绕状态/可见块集合重算。 */
  private readonly handleResize = () => {
    this.drawBackdrop();
    this.vignetteSprite.width = this.app.screen.width;
    this.vignetteSprite.height = this.app.screen.height;
    if (this.updateWrapState()) {
      this.relayoutWrappedPositions();
      this.redrawStaticLayers();
      this.redrawInteraction();
      this.redrawGrid();
    }
    this.layoutBaseSprites();
    if (this.terrainPath === 'chunked') {
      this.updateChunkPlan();
    }
  };

  private destroyBaseTextures() {
    this.terrainTexture?.destroy(true);
    this.fogTexture?.destroy(true);
    this.overviewTexture?.destroy(true);
    this.waterShineTexture?.destroy(true);
    this.lavaMaskTexture?.destroy(true);
    this.terrainTexture = null;
    this.fogTexture = null;
    this.overviewTexture = null;
    this.waterShineTexture = null;
    this.lavaMaskTexture = null;
    this.waterMaskCanvas = null;
    this.waterShineCanvas = null;
    this.lastShinePhase = -1;
    this.waterShineSprite.texture = Texture.EMPTY;
    this.lavaGlowSprite.texture = Texture.EMPTY;
    // 镜像共享主精灵纹理：主纹理销毁后同步置空，避免悬挂引用。
    this.layoutMirrorSprites();
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
      this.clearTerrainChunks();
      this.terrainPath = 'legacy';
      return;
    }

    const fogCanvas = renderPlanetFogCanvas(input.planet, input.fog);
    if (fogCanvas) {
      this.fogTexture = this.createBaseTexture(fogCanvas, 'linear');
      this.fogSprite.texture = this.fogTexture;
    } else {
      this.fogSprite.texture = Texture.EMPTY;
    }
    this.overviewSprite.texture = Texture.EMPTY;

    // 氛围遮罩（水/岩浆 1px/tile）：流光高亮与呼吸辉光的载体，不改动静态地表纹理。
    this.waterMaskCanvas = renderPlanetFluidMaskCanvas(input.planet, 'water');
    if (this.waterMaskCanvas) {
      // 低分辨率动态遮罩画布：逐帧把"移动光带 × 水格遮罩"合成进去再 texture.update。
      const scale = Math.min(1, WATER_SHINE_MAX_AXIS_PX / Math.max(input.planet.map_width, input.planet.map_height, 1));
      const shineCanvas = document.createElement('canvas');
      shineCanvas.width = Math.max(Math.round(input.planet.map_width * scale), 1);
      shineCanvas.height = Math.max(Math.round(input.planet.map_height * scale), 1);
      this.waterShineCanvas = shineCanvas;
      this.waterShineTexture = this.createBaseTexture(shineCanvas, 'linear');
      this.waterShineSprite.texture = this.waterShineTexture;
    }
    const lavaCanvas = renderPlanetFluidMaskCanvas(input.planet, 'lava');
    if (lavaCanvas) {
      this.lavaMaskTexture = this.createBaseTexture(lavaCanvas, 'linear');
      this.lavaGlowSprite.texture = this.lavaMaskTexture;
    }

    // 地表本体：按 tileSize 决定 legacy 整图 / 分块路径（含脏块校验与可见块计划）。
    this.syncTerrainPath();
    this.layoutAmbientSprites();
    this.applyLayerVisibility();
  }

  /**
   * 地表路径同步：数据变化与缩放档切换共用。
   * - legacy（1px 整图画布）：无缓存纹理时重建（destroyBaseTextures 后必然重建）。
   * - chunked（64×64 分块 8px/tile）：按签名逐块校验（地形变化的块销毁待重建），
   *   重排块精灵并按当前相机更新可见块计划；frozen 模式同步补齐（截图确定性）。
   */
  private syncTerrainPath() {
    const input = this.baseInput;
    if (!input || input.overviewMode) {
      this.terrainPath = 'legacy';
      this.clearTerrainChunks();
      return;
    }
    if (useChunkedTerrain(false, this.tileSize)) {
      if (this.terrainTexture) {
        this.terrainTexture.destroy(true);
        this.terrainTexture = null;
        this.terrainSprite.texture = Texture.EMPTY;
      }
      this.terrainPath = 'chunked';
      this.validateTerrainChunks(input.planet);
      this.layoutTerrainChunks();
      this.updateChunkPlan();
      return;
    }
    this.terrainPath = 'legacy';
    this.clearTerrainChunks();
    if (!this.terrainTexture) {
      const terrainCanvas = renderPlanetTerrainCanvas(input.planet);
      this.terrainTexture = this.createBaseTexture(terrainCanvas, 'nearest');
      this.terrainSprite.texture = this.terrainTexture;
      this.layoutBaseSprites();
    }
  }

  /** 当前环绕取样配置（传给分块地形烘焙/签名）。 */
  private get wrapSampling(): TerrainWrapSampling {
    return { wrapX: this.wrapX, wrapY: this.wrapY };
  }

  /** 按签名逐块校验：地形变化的块销毁（重新进入待生成队列）；非环绕轴越出地图的块一并销毁。 */
  private validateTerrainChunks(planet: PlanetRenderView) {
    for (const key of this.chunks.keys()) {
      const entry = this.chunks.peek(key);
      if (!entry) {
        continue;
      }
      const [cx, cy] = parseChunkKey(key);
      const outOfMap = (!this.wrapX && (cx * TERRAIN_CHUNK_TILES >= planet.map_width || cx < 0))
        || (!this.wrapY && (cy * TERRAIN_CHUNK_TILES >= planet.map_height || cy < 0));
      if (outOfMap || entry.signature !== terrainChunkSignature(planet, cx, cy, this.wrapSampling)) {
        entry.sprite.destroy();
        entry.texture.destroy(true);
        this.chunks.delete(key);
      }
    }
  }

  /**
   * 可见块计划：计算可见集合（含 1 圈余量，按到视口中心距离升序），
   * 缺失块进惰性队列（ticker 每帧最多补 N 块；frozen 同步全补），LRU 逐出不保护可见块。
   */
  private updateChunkPlan() {
    const input = this.baseInput;
    if (!input || input.overviewMode || this.terrainPath !== 'chunked') {
      this.chunkQueue = [];
      this.neededChunkKeys = new Set<string>();
      return;
    }
    const keys = computeVisibleChunkKeys({
      mapWidth: input.planet.map_width,
      mapHeight: input.planet.map_height,
      offsetX: this.offsetX,
      offsetY: this.offsetY,
      tileSize: this.tileSize,
      viewportWidth: this.app.screen.width,
      viewportHeight: this.app.screen.height,
      wrapX: this.wrapX,
      wrapY: this.wrapY,
    });
    this.neededChunkKeys = new Set(keys);
    this.chunkQueue = keys.filter((key) => !this.chunks.has(key));
    for (const key of keys) {
      this.chunks.get(key); // 触达提新（LRU 使用序）
    }
    this.chunks.evictToCapacity((key) => this.neededChunkKeys.has(key));
    if (this.frozen && this.chunkQueue.length > 0) {
      const pending = this.chunkQueue;
      this.chunkQueue = [];
      for (const key of pending) {
        this.buildTerrainChunk(key);
      }
    }
  }

  /** 生成一个地表块：烘焙 canvas → Texture → Sprite 拼入 world（nearest 保硬边像素感）。 */
  private buildTerrainChunk(key: string) {
    const input = this.baseInput;
    if (!input || input.overviewMode || this.chunks.has(key)) {
      return;
    }
    const [cx, cy] = parseChunkKey(key);
    const canvas = renderTerrainChunkCanvas(input.planet, cx, cy, this.wrapSampling);
    const texture = Texture.from(canvas);
    texture.source.scaleMode = 'nearest';
    const sprite = new Sprite(texture);
    this.layoutTerrainChunkSprite(sprite, cx, cy);
    this.terrainChunkLayer.addChild(sprite);
    this.chunks.set(key, {
      sprite,
      texture,
      signature: terrainChunkSignature(input.planet, cx, cy, this.wrapSampling),
    });
  }

  private clearTerrainChunks() {
    for (const key of this.chunks.keys()) {
      const entry = this.chunks.peek(key);
      if (!entry) {
        continue;
      }
      entry.sprite.destroy();
      entry.texture.destroy(true);
    }
    this.chunks.clear();
    this.chunkQueue = [];
    this.neededChunkKeys = new Set<string>();
  }

  private layoutTerrainChunkSprite(sprite: Sprite, cx: number, cy: number) {
    const input = this.baseInput;
    if (!input) {
      return;
    }
    const x0 = cx * TERRAIN_CHUNK_TILES;
    const y0 = cy * TERRAIN_CHUNK_TILES;
    sprite.position.set(x0 * this.tileSize, y0 * this.tileSize);
    // 环绕轴 chunk 恒满 64 tile（内容 mod 回绕），非环绕轴地图边缘残块收窄。
    const spanX = this.wrapX ? TERRAIN_CHUNK_TILES : chunkSpanAxis(x0, input.planet.map_width);
    const spanY = this.wrapY ? TERRAIN_CHUNK_TILES : chunkSpanAxis(y0, input.planet.map_height);
    sprite.width = spanX * this.tileSize;
    sprite.height = spanY * this.tileSize;
  }

  private layoutTerrainChunks() {
    for (const key of this.chunks.keys()) {
      const entry = this.chunks.peek(key);
      if (!entry) {
        continue;
      }
      const [cx, cy] = parseChunkKey(key);
      this.layoutTerrainChunkSprite(entry.sprite, cx, cy);
    }
  }

  /** 氛围层尺寸/相位布局：流光/辉光铺满地图；相位 0 重绘一次动态遮罩（frozen 也只画这一次）。 */
  private layoutAmbientSprites() {
    const input = this.baseInput;
    if (!input || input.overviewMode) {
      this.mapPixelWidth = 0;
      this.mapPixelHeight = 0;
      return;
    }
    this.mapPixelWidth = input.planet.map_width * this.tileSize;
    this.mapPixelHeight = input.planet.map_height * this.tileSize;
    if (this.waterShineSprite.texture !== Texture.EMPTY) {
      this.waterShineSprite.width = this.mapPixelWidth;
      this.waterShineSprite.height = this.mapPixelHeight;
    }
    if (this.lavaGlowSprite.texture !== Texture.EMPTY) {
      this.lavaGlowSprite.width = this.mapPixelWidth;
      this.lavaGlowSprite.height = this.mapPixelHeight;
    }
    this.updateAmbientPhase();
  }

  /** 氛围动效相位：水面流光（光带移动 + alpha 呼吸）、岩浆 alpha 呼吸；frozen 下 ambientTime 恒 0 → 固定相位。 */
  private updateAmbientPhase() {
    const t = this.ambientTime;
    this.renderWaterShineCanvas(t);
    this.waterShineSprite.alpha = WATER_SHINE_BASE_ALPHA + WATER_SHINE_ALPHA_SWING * Math.sin(t * 0.9);
    this.lavaGlowSprite.alpha = LAVA_GLOW_BASE_ALPHA + LAVA_GLOW_ALPHA_SWING * Math.sin(t * 1.9);
    // 氛围镜像跟随主精灵的呼吸 alpha。
    for (const mirror of this.mirrorSprites) {
      if (mirror.source === this.waterShineSprite || mirror.source === this.lavaGlowSprite) {
        mirror.sprite.alpha = mirror.source.alpha;
      }
    }
  }

  /** 低分辨率动态遮罩：对角柔光带（相位 t 驱动位置）× 水格遮罩（destination-in），再上传纹理。 */
  private lastShinePhase = -1;

  private renderWaterShineCanvas(t: number) {
    const canvas = this.waterShineCanvas;
    const mask = this.waterMaskCanvas;
    if (!canvas || !mask || t === this.lastShinePhase) {
      return;
    }
    this.lastShinePhase = t;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    // 光带中心沿对角线往返（±0.7 振幅保证完全扫过）；带宽约图宽 35%。
    const center = 0.5 + 0.7 * Math.sin(t * 0.35);
    const bandWidth = Math.max(width * 0.35, 1);
    const bandX = center * (width + bandWidth * 2) - bandWidth;
    const gradient = context.createLinearGradient(bandX - bandWidth, 0, bandX + bandWidth, height * 0.25);
    gradient.addColorStop(0, 'rgba(140, 210, 255, 0)');
    gradient.addColorStop(0.5, 'rgba(165, 222, 255, 0.55)');
    gradient.addColorStop(1, 'rgba(140, 210, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(mask, 0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
    this.waterShineTexture?.source.update();
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
      this.layoutAmbientSprites();
      this.layoutMirrorSprites();
      return;
    }
    this.terrainSprite.width = input.planet.map_width * this.tileSize;
    this.terrainSprite.height = input.planet.map_height * this.tileSize;
    this.fogSprite.width = this.terrainSprite.width;
    this.fogSprite.height = this.terrainSprite.height;
    this.layoutAmbientSprites();
    this.layoutMirrorSprites();
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
    // 只画可见范围的网格线（unwrapped 坐标，环绕轴上自然跨过接缝）：
    // 网格周期 = 1 tile，任意副本里的线位置一致，无需感知地图边界。
    const minTX = Math.floor(-this.offsetX / this.tileSize);
    const maxTX = Math.ceil((this.app.screen.width - this.offsetX) / this.tileSize);
    const minTY = Math.floor(-this.offsetY / this.tileSize);
    const maxTY = Math.ceil((this.app.screen.height - this.offsetY) / this.tileSize);
    for (let x = minTX; x <= maxTX; x += 1) {
      g.moveTo(x * this.tileSize, minTY * this.tileSize).lineTo(x * this.tileSize, maxTY * this.tileSize);
    }
    for (let y = minTY; y <= maxTY; y += 1) {
      g.moveTo(minTX * this.tileSize, y * this.tileSize).lineTo(maxTX * this.tileSize, y * this.tileSize);
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
    const chunked = this.terrainPath === 'chunked';
    this.terrainSprite.visible = !overview && !chunked && layers.terrain && this.terrainTexture !== null;
    this.terrainChunkLayer.visible = !overview && chunked && layers.terrain;
    this.overviewSprite.visible = overview && this.overviewTexture !== null;
    this.fogSprite.visible = !overview && layers.fog && this.fogTexture !== null;
    // 氛围层跟随地形开关；单个 sprite 还要求自己的遮罩纹理存在。
    this.ambientLayer.visible = !overview && layers.terrain;
    this.waterShineSprite.visible = !overview && layers.terrain && this.waterShineTexture !== null;
    this.lavaGlowSprite.visible = !overview && layers.terrain && this.lavaMaskTexture !== null;
    // gridGraphics 的内容由 redrawGrid 决定（关闭时 clear），空图形本身无渲染开销，保持 visible。
    this.pipelinesGraphics.visible = !overview && layers.pipelines;
    this.powerGraphics.visible = !overview && layers.power;
    this.resourcesLayer.visible = !overview && layers.resources;
    this.constructionGraphics.visible = !overview && layers.construction;
    // 建筑/单位同处一个排序容器，图层开关落到逐节点 visible（zIndex 排序不受影响）。
    for (const node of this.buildingNodes.values()) {
      node.container.visible = !overview && layers.buildings;
    }
    for (const node of this.unitNodes.values()) {
      node.container.visible = !overview && layers.units;
    }
    this.logisticsGraphics.visible = !overview && layers.logistics;
    this.threatGraphics.visible = !overview && layers.threat;
    this.layoutMirrorSprites();
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
      this.entitiesLayer,
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
    const base = new Graphics();
    const sprite = new Sprite();
    const badge = new Sprite();
    badge.anchor.set(0.5);
    const warning = new Sprite(getEmojiTexture('⚠️'));
    warning.anchor.set(0.5);
    container.addChild(base);
    container.addChild(sprite);
    container.addChild(badge);
    container.addChild(warning);
    const node: BuildingNode = {
      container,
      base,
      sprite,
      badge,
      warning,
      blades: null,
      glow: null,
      data: building,
      phase: entityAnimPhase(building.id),
    };
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

    node.container.position.set(this.pxTileX(point.x), this.pxTileY(point.y));
    node.container.zIndex = buildingSortKey(this.canonTileY(point.y), height);

    // 低缩放档（tileSize < 6）保持简化色块，不做结构精灵。
    if (simplify) {
      node.sprite.visible = false;
      node.badge.visible = false;
      node.warning.visible = false;
      this.setBuildingAttachment(node, 'blades', null);
      this.setBuildingAttachment(node, 'glow', null);
      node.base
        .clear()
        .rect(0, 0, Math.max(pixelWidth, 2), Math.max(pixelHeight, 2))
        .fill(isOwn ? { color: 0x24c9b6, alpha: 0.4 } : { color: 0xde5757, alpha: 0.38 });
      return;
    }

    // 结构精灵：原型剪影 + 主色/点缀色，烘焙纹理按 (archetype, w×h, state[, direction]) 缓存。
    const visualState = resolveBuildingVisualState(building);
    const archetype = resolveBuildingArchetype(building.type);
    node.sprite.texture = getBuildingSpriteTexture({
      archetype,
      buildingType: building.type,
      tilesWide: width,
      tilesHigh: height,
      state: visualState,
      direction: archetype === 'belt' ? resolveConveyorBeltDirection(building) : undefined,
    });
    const scale = this.tileSize / BUILDING_SPRITE_TILE_PX;
    const layout = buildingSpriteLayout(width, height);
    node.sprite.scale.set(scale);
    node.sprite.position.set(-layout.padX * scale, -layout.topExtra * scale);
    node.sprite.visible = true;

    // 队伍归属：贴合底座板的队伍色描边条（不烘焙，缓存键与队伍无关）。
    node.base
      .clear()
      .roundRect(1, pixelHeight * 0.66, Math.max(pixelWidth - 2, 2), pixelHeight * 0.32, 2)
      .stroke({ width: 1.5, color: isOwn ? COLOR_BUILDING_STROKE_OWN : COLOR_BUILDING_STROKE_ENEMY, alpha: 0.9 });

    // emoji 降级为右上角类型角标（高缩放档才显示，低档靠剪影+配色辨认）。
    if (this.tileSize >= BUILDING_BADGE_MIN_TILE_SIZE) {
      const catalogEntry = getBuildingCatalogEntry(catalog, building.type);
      node.badge.texture = getEmojiTexture(resolveIconGlyph(catalogEntry?.icon_key ?? building.type));
      const badgeSize = Math.max(pixelWidth * 0.34, 6);
      node.badge.width = badgeSize;
      node.badge.height = badgeSize;
      node.badge.position.set(pixelWidth - badgeSize * 0.4, badgeSize * 0.4);
      node.badge.alpha = 0.92;
      node.badge.visible = true;
    } else {
      node.badge.visible = false;
    }

    // 受损/故障：警示角标（ticker 呼吸；frozen 停 0 相位恒定亮度）。
    if (visualState === 'distressed') {
      const badgeSize = Math.max(pixelWidth * 0.3, 5);
      node.warning.width = badgeSize;
      node.warning.height = badgeSize;
      node.warning.position.set(badgeSize * 0.45, badgeSize * 0.45);
      node.warning.alpha = WARNING_BADGE_BASE_ALPHA;
      node.warning.visible = true;
    } else {
      node.warning.visible = false;
    }

    // 风机旋转叶片：独立小 sprite，轮毂对齐结构机舱位置。
    if (hasRotorBlades(building.type)) {
      const blades = this.setBuildingAttachment(node, 'blades', () => {
        const sprite = new Sprite();
        sprite.anchor.set(0.5);
        return sprite;
      });
      blades.texture = getWindBladesTexture(width, height);
      blades.scale.set(scale);
      blades.position.set(pixelWidth * ROTOR_HUB_FRACTION.x, pixelHeight * ROTOR_HUB_FRACTION.y);
      blades.rotation = this.frozen ? 0 : node.phase;
      blades.visible = true;
    } else {
      this.setBuildingAttachment(node, 'blades', null);
    }

    // furnace 发光窗呼吸辉光（add 混合叠加在窗口位置）。
    if (hasGlowWindow(archetype)) {
      const glow = this.setBuildingAttachment(node, 'glow', () => {
        const sprite = new Sprite(getGlowTexture(resolveBuildingAccent(building.type)));
        sprite.anchor.set(0.5);
        sprite.blendMode = 'add';
        return sprite;
      });
      const glowSize = Math.max(pixelWidth * 0.5, 4);
      glow.width = glowSize;
      glow.height = glowSize;
      glow.position.set(pixelWidth * FURNACE_GLOW_FRACTION.x, pixelHeight * FURNACE_GLOW_FRACTION.y);
      glow.alpha = FURNACE_GLOW_BASE_ALPHA;
      glow.visible = true;
    } else {
      this.setBuildingAttachment(node, 'glow', null);
    }
  }

  /** 附件（叶片/辉光）按需挂载/卸载：factory 为 null 时销毁并置空。 */
  private setBuildingAttachment<K extends 'blades' | 'glow'>(node: BuildingNode, slot: K, factory: () => Sprite): Sprite;
  private setBuildingAttachment<K extends 'blades' | 'glow'>(node: BuildingNode, slot: K, factory: null): null;
  private setBuildingAttachment<K extends 'blades' | 'glow'>(
    node: BuildingNode,
    slot: K,
    factory: (() => Sprite) | null,
  ): Sprite | null {
    const existing = node[slot];
    if (!factory) {
      if (existing) {
        node.container.removeChild(existing);
        existing.destroy();
        node[slot] = null;
      }
      return null;
    }
    if (existing) {
      return existing;
    }
    const sprite = factory();
    // 压在结构精灵（index 1）之上、角标之下。
    node.container.addChildAt(sprite, 2);
    node[slot] = sprite;
    return sprite;
  }

  private syncUnits(units: Unit[], playerId: string) {
    const simplify = this.detailPolicy?.simplifyStructures ?? false;
    this.syncNodes(
      this.unitNodes,
      units,
      this.entitiesLayer,
      (unit) => this.createUnitNode(unit, playerId, simplify),
      (node, unit) => {
        const point = toTilePoint(unit.position);
        node.targetX = this.pxCenterX(point.x);
        node.targetY = this.pxCenterY(point.y);
        if (this.frozen) {
          node.posX = node.targetX;
          node.posY = node.targetY;
          node.container.position.set(node.posX, node.posY);
          node.container.zIndex = unitSortKey(node.posY, this.tileSize);
        }
        if (node.data !== unit) {
          node.data = unit;
          this.drawUnitDot(node, playerId, simplify);
        }
      },
    );
  }

  /** 攻击目标 id → tile 位置（供单位朝向解析；找不到返回 null）。 */
  private resolveEntityTilePoint = (entityId: string): TilePoint | null => {
    const building = this.buildingNodes.get(entityId);
    if (building) {
      return toTilePoint(building.data.position);
    }
    const unit = this.unitNodes.get(entityId);
    if (unit) {
      return toTilePoint(unit.data.position);
    }
    return null;
  };

  private createUnitNode(unit: Unit, playerId: string, simplify: boolean): UnitNode {
    const container = new Container();
    const dot = new Graphics();
    const hp = new Graphics();
    container.addChild(dot);
    container.addChild(hp);
    const point = toTilePoint(unit.position);
    const node: UnitNode = {
      container,
      dot,
      hp,
      data: unit,
      targetX: this.pxCenterX(point.x),
      targetY: this.pxCenterY(point.y),
      posX: this.pxCenterX(point.x),
      posY: this.pxCenterY(point.y),
      dirX: 0,
      dirY: -1,
    };
    container.position.set(node.posX, node.posY);
    container.zIndex = unitSortKey(node.posY, this.tileSize);
    this.drawUnitDot(node, playerId, simplify);
    return node;
  }

  /** 单位：带朝向的楔形（队色描边 + 暗底）+ 受伤 HP 弧；简化档保持色块。 */
  private drawUnitDot(node: UnitNode, playerId: string, simplify: boolean) {
    const isOwn = node.data.owner_id === playerId;
    const color = isOwn ? COLOR_UNIT_OWN : COLOR_UNIT_ENEMY;
    const dot = node.dot.clear();
    const hpGraphics = node.hp.clear();
    if (simplify) {
      const size = Math.max(3, this.tileSize * 0.32);
      dot.rect(-size / 2, -size / 2, size, size).fill(color);
      return;
    }

    const direction = resolveUnitDirection(node.data, { x: node.dirX, y: node.dirY }, this.resolveEntityTilePoint);
    node.dirX = direction.x;
    node.dirY = direction.y;
    const radius = Math.max(3.5, this.tileSize * 0.3);
    dot.poly(unitWedgePoints(radius), true)
      .fill({ color: COLOR_UNIT_WEDGE_FILL, alpha: 0.92 })
      .stroke({ width: 1.6, color });
    // 楔形默认朝正上，旋转到朝向（atan2 相对 +x，补偿 -90°）。
    dot.rotation = Math.atan2(direction.y, direction.x) + Math.PI / 2;

    const hp = hpArcParams(node.data.hp, node.data.max_hp);
    if (hp.visible) {
      // HP 弧：楔形外圈顶部 90° 扇形，长度随血量比缩短，颜色绿→黄→红（不随朝向旋转）。
      const arcRadius = radius + 2.5;
      const startAngle = -Math.PI * 0.75;
      const endAngle = startAngle + Math.PI * 0.5 * Math.max(hp.ratio, 0.06);
      hpGraphics.arc(0, 0, arcRadius, startAngle, -Math.PI * 0.25)
        .stroke({ width: 2, color: 0x10151d, alpha: 0.7 });
      hpGraphics.arc(0, 0, arcRadius, startAngle, endAngle)
        .stroke({ width: 2, color: hp.color });
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
    // 晶簇/岩块底座贴花（资源调色板上色，确定性形状），emoji 坐在贴花之上。
    const base = new Graphics();
    const decalSize = Math.max(this.tileSize * 0.72, 5);
    const decal = resourceDecalLayout(resource.kind, decalSize);
    const resourceColor = getResourceColorValue(resource.kind);
    base.ellipse(0, 0, decal.baseRadiusX, decal.baseRadiusY)
      .fill({ color: 0x141a24, alpha: 0.85 })
      .stroke({ width: 1, color: resourceColor, alpha: 0.5 });
    for (const shard of decal.shards) {
      base.poly(shard, true).fill({ color: resourceColor, alpha: 0.9 });
    }
    container.addChild(base);

    const icon = new Sprite(getEmojiTexture(resolveIconGlyph(resource.kind)));
    icon.anchor.set(0.5);
    const size = Math.max(this.tileSize * 0.52, 4);
    icon.width = size;
    icon.height = size;
    icon.position.set(0, -decalSize * 0.28);
    container.addChild(icon);
    const point = toTilePoint(resource.position);
    container.position.set(this.pxCenterX(point.x), this.pxCenterY(point.y));
    return { container, base, icon, data: resource };
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
      g.moveTo(this.pxCenterX(from.x), this.pxCenterY(from.y))
        .lineTo(this.pxCenterX(to.x), this.pxCenterY(to.y));
    }
    g.stroke({ width: 3, color: COLOR_PIPELINE, alpha: 0.78 });
    for (const node of input.visible.pipelineNodes) {
      const point = toTilePoint(node.position);
      const side = Math.max(6, ts * 0.36);
      g.rect(this.pxCenterX(point.x) - side / 2, this.pxCenterY(point.y) - side / 2, side, side)
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
          this.pxCenterX(from.x),
          this.pxCenterY(from.y),
          this.pxCenterX(to.x),
          this.pxCenterY(to.y),
          [6, 6],
          { width: 2, color: COLOR_POWER_WIRELESS, alpha: 0.72 },
        );
      } else {
        g.moveTo(this.pxCenterX(from.x), this.pxCenterY(from.y))
          .lineTo(this.pxCenterX(to.x), this.pxCenterY(to.y))
          .stroke({ width: 3, color: COLOR_POWER_WIRED, alpha: 0.72 });
      }
    }
    for (const coverage of input.visible.powerCoverage) {
      const point = toTilePoint(coverage.position);
      g.circle(this.pxCenterX(point.x), this.pxCenterY(point.y), Math.max(6, ts * 0.32))
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
      const x = this.pxTileX(point.x);
      const y = this.pxTileY(point.y);
      const color = constructionStateColor(task.state);
      const inset = 1.5;
      const arm = Math.max(3, ts * 0.24);

      // 脚手架：虚线轮廓 + 四角 L 支架 + 轻对角撑，替代旧的 3px 色块边框。
      const left = x + inset;
      const top = y + inset;
      const right = x + ts - inset;
      const bottom = y + ts - inset;
      for (const [ax, ay, bx, by] of buildDashSegments(left, top, right, top, [4, 3])) {
        g.moveTo(ax, ay).lineTo(bx, by);
      }
      for (const [ax, ay, bx, by] of buildDashSegments(left, bottom, right, bottom, [4, 3])) {
        g.moveTo(ax, ay).lineTo(bx, by);
      }
      for (const [ax, ay, bx, by] of buildDashSegments(left, top, left, bottom, [4, 3])) {
        g.moveTo(ax, ay).lineTo(bx, by);
      }
      for (const [ax, ay, bx, by] of buildDashSegments(right, top, right, bottom, [4, 3])) {
        g.moveTo(ax, ay).lineTo(bx, by);
      }
      g.stroke({ width: 1.5, color, alpha: 0.75 });

      // 四角 L 支架（粗一点，读作脚手架夹具）。
      g.moveTo(left, top + arm).lineTo(left, top).lineTo(left + arm, top)
        .moveTo(right - arm, top).lineTo(right, top).lineTo(right, top + arm)
        .moveTo(right, bottom - arm).lineTo(right, bottom).lineTo(right - arm, bottom)
        .moveTo(left + arm, bottom).lineTo(left, bottom).lineTo(left, bottom - arm)
        .stroke({ width: 2, color, alpha: 0.95 });

      // 对角撑（轻，施工中的"未成形"感）。
      g.moveTo(left, bottom).lineTo(right, top)
        .stroke({ width: 1, color, alpha: 0.35 });

      // 进度条（底部，数据可算时绘制）。
      const progress = constructionProgress(task);
      if (progress !== null) {
        const barWidth = ts - inset * 2;
        const barY = bottom - 3.5;
        g.rect(left, barY, barWidth, 3).fill({ color: 0x10151d, alpha: 0.8 });
        if (progress > 0) {
          g.rect(left, barY, Math.max(barWidth * progress, 1), 3).fill({ color, alpha: 0.95 });
        }
      }
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
          this.pxCenterX(start.x),
          this.pxCenterY(start.y),
          this.pxCenterX(target.x),
          this.pxCenterY(target.y),
          [8, 6],
          { width: 2, color: COLOR_DRONE, alpha: 0.72 },
        );
      }
      g.circle(this.pxCenterX(start.x), this.pxCenterY(start.y), Math.max(4, ts * 0.18)).fill(COLOR_DRONE);
    }
    for (const ship of input.visible.logisticsShips) {
      const start = toTilePoint(ship.position);
      if (ship.target_pos) {
        const target = toTilePoint(ship.target_pos);
        this.strokeDashed(
          g,
          this.pxCenterX(start.x),
          this.pxCenterY(start.y),
          this.pxCenterX(target.x),
          this.pxCenterY(target.y),
          [2, 8],
          { width: 2, color: COLOR_SHIP, alpha: 0.68 },
        );
      }
      const side = Math.max(6, ts * 0.32);
      g.rect(this.pxCenterX(start.x) - side / 2, this.pxCenterY(start.y) - side / 2, side, side).fill(COLOR_SHIP);
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
      const cx = this.pxCenterX(point.x);
      const cy = this.pxCenterY(point.y);
      const r = Math.max(6, ts * 0.28);
      g.poly([cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy], true).fill({ color: COLOR_ENEMY, alpha: 0.88 });
    }
    for (const detection of input.visible.detections) {
      for (const position of detection.detected_positions ?? []) {
        const point = toTilePoint(position);
        g.circle(this.pxCenterX(point.x), this.pxCenterY(point.y), Math.max(5, ts * 0.22))
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

  /** hover 高亮形状：按当前 tileSize 在原点画一次（tileSize 变化才重画；hover 变化只动位置）。 */
  private redrawHoverShape() {
    const ts = this.tileSize;
    this.hoverGraphics
      .clear()
      .rect(1, 1, Math.max(ts - 2, 2), Math.max(ts - 2, 2))
      .fill({ color: 0xffffff, alpha: 0.06 })
      .stroke({ width: 1.5, color: 0xffffff, alpha: 0.5 });
  }

  /** hover 高亮落点：仅动 hoverGraphics 的位置/可见性，零重建（build 模式幽灵逻辑不受影响）。 */
  private updateHoverHighlight() {
    const input = this.interactionInput;
    const tile = input
      ? resolveTileHoverHighlight(input.hoveredTile, input.mode, input.overviewMode)
      : null;
    if (!tile) {
      this.hoverGraphics.visible = false;
      return;
    }
    this.hoverGraphics.position.set(this.pxTileX(tile.x), this.pxTileY(tile.y));
    this.hoverGraphics.visible = true;
  }

  private redrawInteraction() {
    this.updateHoverHighlight();
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
          const screenX = this.pxTileX(tx);
          const screenY = this.pxTileY(ty);
          g.rect(screenX, screenY, ts, ts)
            .fill(blocked ? { color: COLOR_GHOST_BLOCKED, alpha: 0.32 } : { color: COLOR_GHOST_OK, alpha: 0.28 })
            .stroke({ width: 1.5, color: blocked ? COLOR_GHOST_BLOCKED : COLOR_GHOST_OK });
        }
      }
      // 幽灵范围预览：catalog 带 combat_range（橙红细圈）/power_range（黄虚线圈，对齐电网配色），
      // 随幽灵移动，退出 build 模式随叠加层整体清除；无范围字段的建筑类型不画。
      const rangeCircles = resolveGhostRangeCircles(input.catalog, mode.buildingType);
      if (rangeCircles.length > 0) {
        this.drawRangeCircles(
          g,
          this.pxTileX(hoveredTile.x) + (assessment.footprint.width / 2) * ts,
          this.pxTileY(hoveredTile.y) + (assessment.footprint.height / 2) * ts,
          rangeCircles,
          ts,
        );
      }
      return;
    }

    // 移动/攻击模式：目标点准星高亮
    if (!overviewMode && (mode.kind === 'move' || mode.kind === 'attack') && hoveredTile) {
      const screenX = this.pxTileX(hoveredTile.x);
      const screenY = this.pxTileY(hoveredTile.y);
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
    // 选中防御建筑：画射程圈（数据来自该建筑 runtime.functions.combat.range）；
    // 供电建筑的无线覆盖由电网图层承担，这里不重复画。
    if (selected?.kind === 'building') {
      const node = this.buildingNodes.get(selected.id);
      const combatRange = resolveSelectedCombatRange(node?.data);
      if (node && combatRange !== undefined) {
        const { width, height } = getBuildingFootprint(node.data);
        const point = toTilePoint(node.data.position);
        this.drawRangeCircles(
          g,
          (this.canonTileX(point.x) + width / 2) * ts,
          (this.canonTileY(point.y) + height / 2) * ts,
          [{ kind: 'combat', radiusTiles: combatRange }],
          ts,
        );
      }
    }
    const screenX = this.pxTileX(highlightTile.x);
    const screenY = this.pxTileY(highlightTile.y);
    g.rect(screenX + 1.5, screenY + 1.5, Math.max(ts - 3, 2), Math.max(ts - 3, 2))
      .stroke(selected
        ? { width: 3, color: COLOR_SELECTED }
        : { width: 2, color: 0xffffff, alpha: 0.65 });
  }

  /** 范围圈绘制：combat 橙红细实线，power 黄色虚线（对齐电网 wireless 配色语义）。 */
  private drawRangeCircles(g: Graphics, cx: number, cy: number, circles: RangeCircleSpec[], ts: number) {
    for (const circle of circles) {
      const radius = circle.radiusTiles * ts;
      if (radius <= 0) {
        continue;
      }
      if (circle.kind === 'combat') {
        g.circle(cx, cy, radius).stroke({ width: 2, color: COLOR_RANGE_COMBAT, alpha: 0.85 });
      } else {
        for (const [ax, ay, bx, by] of buildDashArcSegments(cx, cy, radius, [8, 6])) {
          g.moveTo(ax, ay).lineTo(bx, by);
        }
        g.stroke({ width: 2, color: COLOR_POWER_WIRELESS, alpha: 0.85 });
      }
    }
  }

  // ---------- ticker：单位平滑移动 + 选中环脉冲 ----------

  private readonly tick = (ticker: Ticker) => {
    if (this.disposed || this.frozen) {
      return;
    }
    // 上限 100ms：后台标签页恢复时不会一次性飞跃。
    const dt = Math.min(ticker.deltaMS, 100) / 1000;
    // 缩放补间推进：完成后精确落到 scale=1@归一化目标 offset（周期等价分支视觉一致）。
    if (this.zoomTween) {
      const progress = this.zoomTween.tween.step(ticker.deltaMS);
      this.applyCameraTransform(
        lerp(this.zoomTween.fromScale, 1, progress),
        lerp(this.zoomTween.fromX, this.zoomTween.toX, progress),
        lerp(this.zoomTween.fromY, this.zoomTween.toY, progress),
      );
      if (progress >= 1) {
        this.zoomTween = null;
        this.applyCameraTransform(1, this.offsetX, this.offsetY);
      }
    }
    // 分块地表惰性补块：每帧最多 N 块（拖拽时防卡顿），按队列（视口中心优先）生成。
    let buildBudget = TERRAIN_CHUNK_BUILD_BUDGET_PER_FRAME;
    while (buildBudget > 0 && this.chunkQueue.length > 0) {
      const key = this.chunkQueue.shift();
      if (key === undefined) {
        break;
      }
      this.buildTerrainChunk(key);
      buildBudget -= 1;
    }
    // 氛围动效推进固定时钟（frozen 不推进，相位停在 0）。
    this.ambientTime += dt;
    this.updateAmbientPhase();
    // 建筑动效：风机叶片旋转（确定性相位）、受损/故障警示呼吸、furnace 发光窗呼吸。
    // frozen 下 tick 提前返回，初始绘制停在 0 相位。
    for (const node of this.buildingNodes.values()) {
      if (node.blades) {
        node.blades.rotation = node.phase + this.ambientTime * WIND_BLADE_SPEED;
      }
      if (node.warning.visible) {
        node.warning.alpha = WARNING_BADGE_BASE_ALPHA
          + WARNING_BADGE_ALPHA_SWING * Math.sin(this.ambientTime * 3.4 + node.phase);
      }
      if (node.glow) {
        node.glow.alpha = FURNACE_GLOW_BASE_ALPHA
          + FURNACE_GLOW_ALPHA_SWING * Math.sin(this.ambientTime * 2.1 + node.phase);
      }
    }
    const blend = smoothingBlend(dt);
    for (const node of this.unitNodes.values()) {
      const dx = node.targetX - node.posX;
      const dy = node.targetY - node.posY;
      if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
        if (node.posX !== node.targetX || node.posY !== node.targetY) {
          node.posX = node.targetX;
          node.posY = node.targetY;
          node.container.position.set(node.posX, node.posY);
          node.container.zIndex = unitSortKey(node.posY, this.tileSize);
        }
        continue;
      }
      node.posX += dx * blend;
      node.posY += dy * blend;
      node.container.position.set(node.posX, node.posY);
      // 遮挡排序键随平滑移动逐帧更新（小数 tile y），单位走到高建筑北侧被遮住。
      node.container.zIndex = unitSortKey(node.posY, this.tileSize);
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
