/**
 * 2D 世界相机：连续缩放/平移 + 补间飞行。纯 TS，不依赖 Pixi，可单测。
 *
 * 坐标约定：世界坐标以相机目标点 (x, y) 为中心，zoom = 屏幕像素/世界单位。
 * world→screen: sx = (wx - cam.x) * zoom + viewportW / 2
 */

import { createTween, lerp, type EaseFn, type Tween } from '@/engine/tween';

export interface CameraPose {
  x: number;
  y: number;
  zoom: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface CameraOptions {
  minZoom?: number;
  maxZoom?: number;
}

const DEFAULT_MIN_ZOOM = 0.05;
const DEFAULT_MAX_ZOOM = 40;

export class Camera2D {
  private pose: CameraPose;
  private readonly minZoom: number;
  private readonly maxZoom: number;
  private from: CameraPose | null = null;
  private to: CameraPose | null = null;
  private tween: Tween | null = null;

  constructor(initial: CameraPose, options: CameraOptions = {}) {
    this.minZoom = options.minZoom ?? DEFAULT_MIN_ZOOM;
    this.maxZoom = options.maxZoom ?? DEFAULT_MAX_ZOOM;
    this.pose = { ...initial, zoom: this.clampZoom(initial.zoom) };
  }

  get x() {
    return this.pose.x;
  }

  get y() {
    return this.pose.y;
  }

  get zoom() {
    return this.pose.zoom;
  }

  get animating() {
    return this.tween != null && !this.tween.done;
  }

  clampZoom(zoom: number) {
    return Math.min(Math.max(zoom, this.minZoom), this.maxZoom);
  }

  worldToScreen(wx: number, wy: number, viewport: ViewportSize) {
    return {
      x: (wx - this.pose.x) * this.pose.zoom + viewport.width / 2,
      y: (wy - this.pose.y) * this.pose.zoom + viewport.height / 2,
    };
  }

  screenToWorld(sx: number, sy: number, viewport: ViewportSize) {
    return {
      x: (sx - viewport.width / 2) / this.pose.zoom + this.pose.x,
      y: (sy - viewport.height / 2) / this.pose.zoom + this.pose.y,
    };
  }

  /** 立即设置位姿并取消进行中的动画。 */
  jumpTo(pose: Partial<CameraPose>) {
    this.cancelAnimation();
    this.pose = {
      x: pose.x ?? this.pose.x,
      y: pose.y ?? this.pose.y,
      zoom: this.clampZoom(pose.zoom ?? this.pose.zoom),
    };
  }

  /** 拖拽平移：传入屏幕像素位移（指针移动量）。 */
  panBy(dxScreen: number, dyScreen: number) {
    this.cancelAnimation();
    this.pose = {
      ...this.pose,
      x: this.pose.x - dxScreen / this.pose.zoom,
      y: this.pose.y - dyScreen / this.pose.zoom,
    };
  }

  /** 以屏幕上某点为锚缩放 factor 倍（保持锚点下的世界点不动）。 */
  zoomAt(anchorScreenX: number, anchorScreenY: number, factor: number, viewport: ViewportSize) {
    this.cancelAnimation();
    const anchorWorld = this.screenToWorld(anchorScreenX, anchorScreenY, viewport);
    const nextZoom = this.clampZoom(this.pose.zoom * factor);
    this.pose = {
      zoom: nextZoom,
      x: anchorWorld.x - (anchorScreenX - viewport.width / 2) / nextZoom,
      y: anchorWorld.y - (anchorScreenY - viewport.height / 2) / nextZoom,
    };
  }

  /** 补间飞行到目标位姿。 */
  flyTo(pose: Partial<CameraPose>, durationMs = 450, ease?: EaseFn) {
    this.from = { ...this.pose };
    this.to = {
      x: pose.x ?? this.pose.x,
      y: pose.y ?? this.pose.y,
      zoom: this.clampZoom(pose.zoom ?? this.pose.zoom),
    };
    this.tween = createTween(durationMs, ease);
    if (this.tween.done) {
      this.applyProgress(1);
    }
  }

  /** 由外部 ticker 按 dt 驱动；返回当前是否仍在动画中。 */
  update(dtMs: number) {
    if (!this.tween || this.tween.done) {
      return false;
    }
    const t = this.tween.step(dtMs);
    this.applyProgress(t);
    return t < 1;
  }

  private applyProgress(t: number) {
    if (!this.from || !this.to) {
      return;
    }
    this.pose = {
      x: lerp(this.from.x, this.to.x, t),
      y: lerp(this.from.y, this.to.y, t),
      zoom: lerp(this.from.zoom, this.to.zoom, t),
    };
    if (t >= 1) {
      this.from = null;
      this.to = null;
      this.tween = null;
    }
  }

  private cancelAnimation() {
    this.from = null;
    this.to = null;
    this.tween = null;
  }
}
