import { describe, expect, it, vi } from 'vitest';

import {
  COMMAND_MARKER_MS,
  CommandMarkerTrack,
  MAX_COMMAND_MARKERS,
  crosshairPose,
  emitCommandMarker,
  rippleRings,
  subscribeCommandMarkers,
} from '@/features/planet-map/command-markers';

describe('命令落点标记生命周期', () => {
  it('spawn → advance 推进进度，到期返回并移除', () => {
    const track = new CommandMarkerTrack();
    const marker = track.spawn({ kind: 'move', position: { x: 3, y: 4 } });
    expect(marker.durationMs).toBe(COMMAND_MARKER_MS.move);
    expect(track.advance(500)).toEqual([]);
    expect(track.active()[0].progress).toBeCloseTo(0.5);
    const done = track.advance(600);
    expect(done.map((item) => item.id)).toEqual([marker.id]);
    expect(track.active()).toHaveLength(0);
  });

  it('同一格重复下令只保留最新；超上限丢最旧', () => {
    const track = new CommandMarkerTrack();
    track.spawn({ kind: 'move', position: { x: 1, y: 1 } });
    const latest = track.spawn({ kind: 'attack', position: { x: 1, y: 1 } });
    expect(track.active().map((item) => item.id)).toEqual([latest.id]);
    for (let i = 0; i < MAX_COMMAND_MARKERS + 3; i += 1) track.spawn({ kind: 'move', position: { x: 10 + i, y: 0 } });
    expect(track.active()).toHaveLength(MAX_COMMAND_MARKERS);
    expect(track.active()[0].position.x).toBe(13);
  });

  it('涟漪两圈错相扩散并淡出；准星先收拢后淡出', () => {
    expect(rippleRings(0.1)).toHaveLength(1);
    expect(rippleRings(0.6)).toHaveLength(2);
    const early = rippleRings(0.2)[0];
    const late = rippleRings(0.8)[0];
    expect(late.scale).toBeGreaterThan(early.scale);
    expect(late.alpha).toBeLessThan(early.alpha);
    expect(rippleRings(1)).toHaveLength(0);
    expect(crosshairPose(0).scale).toBeCloseTo(1.6);
    expect(crosshairPose(0.3).scale).toBeCloseTo(1);
    expect(crosshairPose(0.5).alpha).toBe(1);
    expect(crosshairPose(1).alpha).toBeCloseTo(0);
  });

  it('总线：订阅收到命令标记，退订后不再收到', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommandMarkers(listener);
    emitCommandMarker({ kind: 'attack', position: { x: 2, y: 5 } });
    unsubscribe();
    emitCommandMarker({ kind: 'move', position: { x: 0, y: 0 } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ kind: 'attack', position: { x: 2, y: 5 } });
  });
});
