import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlanetRenderView } from '@/features/planet-map/model';

/**
 * usePlanetAudioScene 的 hook 级用例（第三轮）：
 * - 挂载即算一次声床/配乐，之后按 AUDIO_CAMERA_POLL_MS 轮询；
 * - low 档不预载配乐（进入状态才懒加载）；
 * - ?freeze=1（frozen）停声床与配乐，且不预载；
 * - 卸载清空声床/配乐/空间监听器/实体索引。
 * engine/audio 与 manifest 全部 mock：这里只断言「hook 调了什么」，声音本身在引擎测试里。
 */

const audio = vi.hoisted(() => ({
  setAmbientLayers: vi.fn(),
  setMusic: vi.fn(),
  setSpatialTrimDb: vi.fn(),
  preloadSamples: vi.fn(),
  tickAudioLoops: vi.fn(),
  noteSceneTick: vi.fn(),
}));

vi.mock('@/engine/audio', () => audio);

import {
  AUDIO_CAMERA_POLL_MS,
  countRunningBuildings,
  resetTenseWindowForTests,
  tenseSignalFromEvent,
  usePlanetAudioScene,
  type AudioSceneHandle,
} from '@/features/audio/use-planet-audio-scene';
import { getAudioListener, resetAudioListenerForTests } from '@/features/audio/spatial';
import { getBattleEntityIndex, resetBattleEntityIndexForTests } from '@/features/audio/battle-context';

function planetWith(ownerId: string, running: number): PlanetRenderView {
  const buildings = Object.fromEntries(Array.from({ length: running }, (_, index) => [`b${index}`, {
    id: `b${index}`,
    type: 'wind_turbine',
    owner_id: ownerId,
    hp: 100,
    position: { x: index, y: 0, z: 0 },
    runtime: { state: 'running' },
  }]));
  return {
    planet_id: 'planet-1-1',
    surface: { topology: 'cube_sphere', face_size: 32 },
    buildings,
    units: {},
  } as unknown as PlanetRenderView;
}

function sceneHandle(altitude = 10): AudioSceneHandle {
  return {
    getCameraState: () => ({ center: { x: 10, y: 10 }, altitude, tilt: 0.65, groundView: altitude < 190 }),
    project: () => ({ x: 500, y: 400, visible: true }),
    getViewport: () => ({ width: 1200, height: 900 }),
  };
}

const sceneRef = (handle: AudioSceneHandle | null) => ({ current: handle });

beforeEach(() => {
  vi.clearAllMocks();
  resetAudioListenerForTests();
  resetBattleEntityIndexForTests();
  resetTenseWindowForTests();
  localStorage.clear();
});

describe('usePlanetAudioScene hook', () => {
  it('挂载即给声床 + 配乐 + 空间监听器（画布宽归一化），并轮询', () => {
    vi.useFakeTimers();
    try {
      const planet = planetWith('p1', 40);
      renderHook(() => usePlanetAudioScene({
        planet,
        runtime: { tick: 100, threat_level: 0 } as never,
        sceneRef: sceneRef(sceneHandle()),
        playerId: 'p1',
      }));

      expect(audio.setAmbientLayers).toHaveBeenCalled();
      const layers = audio.setAmbientLayers.mock.calls[0][0] as Array<{ name: string; level: number }>;
      expect(layers.map((layer) => layer.name)).toEqual(['wind', 'factory']);
      expect(audio.setMusic).toHaveBeenCalledWith('calm');
      expect(getAudioListener()?.width).toBe(1200);

      const before = audio.setAmbientLayers.mock.calls.length;
      vi.advanceTimersByTime(AUDIO_CAMERA_POLL_MS);
      expect(audio.setAmbientLayers.mock.calls.length).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('low 档不预载配乐；balanced 预载三首', () => {
    localStorage.setItem('siliconworld-planet-quality', 'low');
    const first = renderHook(() => usePlanetAudioScene({
      planet: planetWith('p1', 1),
      runtime: undefined,
      sceneRef: sceneRef(sceneHandle()),
      playerId: 'p1',
    }));
    expect(audio.preloadSamples).not.toHaveBeenCalled();
    first.unmount();

    localStorage.setItem('siliconworld-planet-quality', 'balanced');
    renderHook(() => usePlanetAudioScene({
      planet: planetWith('p1', 1),
      runtime: undefined,
      sceneRef: sceneRef(sceneHandle()),
      playerId: 'p1',
    }));
    expect(audio.preloadSamples).toHaveBeenCalledTimes(1);
    expect((audio.preloadSamples.mock.calls[0][0] as string[]).length).toBe(3);
  });

  it('frozen（?freeze=1）：不预载、停声床与配乐', () => {
    renderHook(() => usePlanetAudioScene({
      planet: planetWith('p1', 5),
      runtime: undefined,
      sceneRef: sceneRef(sceneHandle()),
      playerId: 'p1',
      frozen: true,
    }));
    expect(audio.preloadSamples).not.toHaveBeenCalled();
    expect(audio.setAmbientLayers).toHaveBeenCalledWith([]);
    expect(audio.setMusic).toHaveBeenCalledWith(null);
  });

  it('卸载清场：声床空、配乐 null、监听器与实体索引清空', () => {
    const { unmount } = renderHook(() => usePlanetAudioScene({
      planet: planetWith('p1', 2),
      runtime: undefined,
      sceneRef: sceneRef(sceneHandle()),
      playerId: 'p1',
    }));
    expect(getBattleEntityIndex().size).toBe(2);
    unmount();
    expect(audio.setAmbientLayers).toHaveBeenLastCalledWith([]);
    expect(audio.setMusic).toHaveBeenLastCalledWith(null);
    expect(getAudioListener()).toBeNull();
    expect(getBattleEntityIndex().size).toBe(0);
  });

  it('场景句柄未就绪时仍起声床（按贴地默认值），中心格未知', () => {
    renderHook(() => usePlanetAudioScene({
      planet: planetWith('p1', 1),
      runtime: undefined,
      sceneRef: sceneRef(null),
      playerId: 'p1',
    }));
    const layers = audio.setAmbientLayers.mock.calls[0][0] as Array<{ name: string }>;
    expect(layers.map((layer) => layer.name)).toEqual(['wind', 'factory']);
  });
});

describe('声床输入与紧张信号（纯函数，hook 同口径）', () => {
  it('countRunningBuildings 只数己方 running 建筑', () => {
    expect(countRunningBuildings(planetWith('p1', 3), 'p1')).toBe(3);
    expect(countRunningBuildings(planetWith('p2', 3), 'p1')).toBe(0);
  });

  it('tenseSignalFromEvent 给 dark_fog_provoked 的 until_tick', () => {
    const signal = tenseSignalFromEvent({
      event_id: 'e1', tick: 10, event_type: 'dark_fog_provoked', visibility_scope: 'p1', payload: { until_tick: 900 },
    }, null, 10);
    expect(signal).toEqual({ hostileUntilTick: 900 });
  });
});
