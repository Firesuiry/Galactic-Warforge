/**
 * 命令落点标记：右键移动/攻击、军团进攻/移动下达后，在地图上短暂显示反馈
 * （move = 扩散圆环涟漪，attack = 红色准星）。
 *
 * - emitCommandMarker / subscribeCommandMarkers：命令提交点 → 2D/3D 场景的极简总线；
 * - CommandMarkerTrack：纯生命周期（spawn/advance/上限），场景只负责按 progress 绘制。
 */

export type CommandMarkerKind = 'move' | 'attack';

export interface CommandMarkerSpec {
  kind: CommandMarkerKind;
  position: { x: number; y: number };
}

export interface CommandMarker extends CommandMarkerSpec {
  id: number;
  elapsedMs: number;
  durationMs: number;
  /** [0,1] 线性进度。 */
  progress: number;
}

export const COMMAND_MARKER_MS: Record<CommandMarkerKind, number> = { move: 1000, attack: 1100 };
export const MAX_COMMAND_MARKERS = 8;

type Listener = (spec: CommandMarkerSpec) => void;
const listeners = new Set<Listener>();

export function emitCommandMarker(spec: CommandMarkerSpec): void {
  listeners.forEach((listener) => listener(spec));
}

export function subscribeCommandMarkers(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export class CommandMarkerTrack {
  private items: CommandMarker[] = [];
  private nextId = 1;

  spawn(spec: CommandMarkerSpec): CommandMarker {
    // 同一格重复下令只保留最新一个；超上限丢最旧。
    this.items = this.items.filter((item) => item.position.x !== spec.position.x || item.position.y !== spec.position.y);
    if (this.items.length >= MAX_COMMAND_MARKERS) this.items.shift();
    const marker: CommandMarker = {
      kind: spec.kind,
      position: { x: spec.position.x, y: spec.position.y },
      id: this.nextId++,
      elapsedMs: 0,
      durationMs: COMMAND_MARKER_MS[spec.kind],
      progress: 0,
    };
    this.items.push(marker);
    return marker;
  }

  /** 推进；返回本帧结束的标记（场景据此回收绘制对象）。 */
  advance(dtMs: number): CommandMarker[] {
    const done: CommandMarker[] = [];
    this.items = this.items.filter((item) => {
      item.elapsedMs += Math.max(dtMs, 0);
      item.progress = Math.min(item.elapsedMs / item.durationMs, 1);
      if (item.progress >= 1) {
        done.push(item);
        return false;
      }
      return true;
    });
    return done;
  }

  active(): readonly CommandMarker[] {
    return this.items;
  }

  clear(): void {
    this.items = [];
  }
}

/** 涟漪外观：半径倍率由 0.25 扩到 1，透明度末段淡出（两圈错相）。 */
export function rippleRings(progress: number): { scale: number; alpha: number }[] {
  return [0, 0.35].flatMap((lag) => {
    const t = (progress - lag) / (1 - lag);
    if (t <= 0 || t >= 1) return [];
    return [{ scale: 0.25 + 0.75 * t, alpha: (1 - t) * (lag === 0 ? 0.95 : 0.7) }];
  });
}

/** 准星外观：先由 1.6 倍收拢到 1，后段淡出。 */
export function crosshairPose(progress: number): { scale: number; alpha: number } {
  const close = Math.min(progress / 0.25, 1);
  return { scale: 1.6 - 0.6 * close * (2 - close), alpha: progress < 0.6 ? 1 : 1 - (progress - 0.6) / 0.4 };
}
