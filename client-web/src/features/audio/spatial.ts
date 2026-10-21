/**
 * 音频空间化（第 23 轮 3A 音频分支）。
 *
 * 口径（契约 §5）：
 * - 距离按**球面格距**（surfaceDistanceWithin，跨面正确）从画面中心格算；
 *   0 格 = 0 dB，30 格 ≈ −18 dB（线性 −0.6 dB/格），> 60 格不播；
 * - 左右声相按屏幕 x：把事件格投影到画布坐标，pan = 归一化 x（−1..1）；
 * - 画面中心与高度来自 3D 场景的 `getCameraState()`，由 PlanetMapThree 每 500ms
 *   通过 `setAudioListener` 推一份轻量快照（不改场景逻辑）；
 * - 全球视角（altitude > 190）下战斗音整体 −10 dB。
 *
 * 纯函数在前（可单测），监听器快照在后（模块级单例）。
 */

import { surfaceDistanceWithin } from '@shared/surface';

export interface TilePoint {
  x: number;
  y: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export interface AudioListenerSnapshot {
  /** 画面中心格（场景未就绪为 null）。 */
  center: TilePoint | null;
  /** 相机高度（与 scene.getCameraState().altitude 同口径）。 */
  altitude: number;
  /** 是否全球视角（altitude > 190）。 */
  globalView: boolean;
  /** 画布 CSS 尺寸（声相归一化用）。 */
  width: number;
  height: number;
  /** 行星面尺寸（surface.face_size，球面格距用）。 */
  faceSize: number;
  /** 格 → 画布 CSS 坐标（scene.project；不可用时为 null）。 */
  project: ((tile: TilePoint) => ScreenPoint | null) | null;
}

/** 距离衰减斜率（dB/格）：30 格 = −18 dB。 */
export const SPATIAL_DB_PER_TILE = 0.6;
/** 超过该格距不播。 */
export const SPATIAL_MAX_TILES = 60;
/** 全球视角的整体衰减（dB）。 */
export const GLOBAL_VIEW_TRIM_DB = -10;
/** 实体 id 反查不到坐标（不在当前相机窗口）时的衰减（dB）：能听见但明显在画面外。 */
export const OFFSCREEN_VOLUME_DB = -12;
/** 全球视角判定阈值（与 planet-three-status 的 groundView 阈值同口径）。 */
export const GLOBAL_VIEW_ALTITUDE = 190;

export interface SpatialResult {
  /** 球面格距（> 60 时也给值，但 audible=false）。 */
  distance: number;
  /** 距离衰减（dB，≤ 0）。 */
  volumeDb: number;
  /** 左右声相（−1 左 / +1 右）。 */
  pan: number;
  audible: boolean;
}

/**
 * 距离衰减曲线（纯函数）：0 格 0 dB，线性 −0.6 dB/格，60 格 −36 dB 封顶。
 * 与契约「30 格 ≈ −18 dB」一致。
 */
export function distanceAttenuationDb(distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  return -Math.min(SPATIAL_DB_PER_TILE * distance, SPATIAL_DB_PER_TILE * SPATIAL_MAX_TILES);
}

/**
 * 事件格 → 空间参数。listener 缺中心格 / 不可投影时按「不空间化」（0 dB、pan 0）。
 */
export function spatializeTile(
  listener: AudioListenerSnapshot,
  tile: TilePoint,
  faceSize: number = listener.faceSize,
): SpatialResult {
  if (!listener.center) {
    return { distance: 0, volumeDb: 0, pan: 0, audible: true };
  }
  const distance = surfaceDistanceWithin(listener.center, tile, faceSize, SPATIAL_MAX_TILES + 1);
  if (distance === undefined) {
    // 超出查询半径（> 60 格）：不播
    return { distance: SPATIAL_MAX_TILES + 1, volumeDb: distanceAttenuationDb(SPATIAL_MAX_TILES + 1), pan: 0, audible: false };
  }
  const volumeDb = distanceAttenuationDb(distance);
  let pan = 0;
  if (listener.project && listener.width > 0) {
    const screen = listener.project(tile);
    if (screen) {
      pan = Math.max(-1, Math.min(1, (screen.x / listener.width) * 2 - 1));
    }
  }
  return { distance, volumeDb, pan, audible: distance <= SPATIAL_MAX_TILES };
}

/** 全球视角的整体衰减（纯函数）。 */
export function globalViewTrimDb(altitude: number): number {
  return altitude > GLOBAL_VIEW_ALTITUDE ? GLOBAL_VIEW_TRIM_DB : 0;
}

// ---------- 监听器快照（模块级单例） ----------

let listener: AudioListenerSnapshot | null = null;

export function setAudioListener(next: AudioListenerSnapshot | null) {
  listener = next;
}

export function getAudioListener(): AudioListenerSnapshot | null {
  return listener;
}

/** 测试用：清空监听器。 */
export function resetAudioListenerForTests() {
  listener = null;
}

/**
 * 当前监听器快照下的播放参数（给 sfx.* 直接吃）。
 * 没有监听器 / 没有中心格 / 超距 → 返回 undefined（= 非空间音，按原样播）；
 * 全球视角由 engine 的 setSpatialTrimDb 统一 −10 dB，不在这里叠。
 */
export function spatialForTile(tile: TilePoint | null | undefined): { tile: TilePoint; volumeDb: number; pan: number } | undefined {
  if (!tile || !listener || !listener.center) return undefined;
  const result = spatializeTile(listener, tile, listener.faceSize);
  if (!result.audible) return undefined;
  return { tile, volumeDb: result.volumeDb, pan: result.pan };
}

/**
 * 实体 id 反查不到坐标时（服务端事件只有 id、实体不在当前相机窗口）：
 * 按「画面外」处理——固定 −12 dB、不做声相；没有监听器（非行星页）时同样返回这组参数，
 * 避免画面外的战斗和贴脸的战斗一样响。
 */
export const OFFSCREEN_SPATIAL = { volumeDb: OFFSCREEN_VOLUME_DB, pan: 0 } as const;
