import { beforeEach, describe, expect, it } from 'vitest';

import {
  distanceAttenuationDb,
  globalViewTrimDb,
  GLOBAL_VIEW_ALTITUDE,
  GLOBAL_VIEW_TRIM_DB,
  resetAudioListenerForTests,
  setAudioListener,
  spatialForTile,
  spatializeTile,
  type AudioListenerSnapshot,
} from '@/features/audio/spatial';

function listener(overrides: Partial<AudioListenerSnapshot> = {}): AudioListenerSnapshot {
  return {
    center: { x: 20, y: 20 },
    altitude: 10,
    globalView: false,
    width: 1000,
    height: 800,
    faceSize: 32,
    project: () => ({ x: 500, y: 400, visible: true }),
    ...overrides,
  };
}

beforeEach(() => {
  resetAudioListenerForTests();
});

describe('distanceAttenuationDb 距离衰减曲线', () => {
  it('0 格 = 0 dB，30 格 ≈ −18 dB（契约口径）', () => {
    expect(distanceAttenuationDb(0)).toBe(0);
    expect(distanceAttenuationDb(30)).toBeCloseTo(-18, 5);
  });

  it('线性 −0.6 dB/格，60 格封顶 −36 dB', () => {
    expect(distanceAttenuationDb(10)).toBeCloseTo(-6, 5);
    expect(distanceAttenuationDb(60)).toBeCloseTo(-36, 5);
    expect(distanceAttenuationDb(200)).toBeCloseTo(-36, 5);
  });

  it('非法输入按 0 dB 处理', () => {
    expect(distanceAttenuationDb(-3)).toBe(0);
    expect(distanceAttenuationDb(Number.NaN)).toBe(0);
  });
});

describe('spatializeTile', () => {
  it('按球面格距衰减，并按屏幕 x 定声相', () => {
    const result = spatializeTile(listener({ project: () => ({ x: 750, y: 400, visible: true }) }), { x: 25, y: 20 });
    expect(result.distance).toBe(5);
    expect(result.volumeDb).toBeCloseTo(-3, 5);
    expect(result.pan).toBeCloseTo(0.5, 5);
    expect(result.audible).toBe(true);
  });

  it('屏幕左侧 → 负声相', () => {
    const result = spatializeTile(listener({ project: () => ({ x: 250, y: 400, visible: true }) }), { x: 20, y: 20 });
    expect(result.pan).toBeCloseTo(-0.5, 5);
  });

  it('> 60 格不播', () => {
    // 32 面内同面最远 31 格；绕到对面面（y 跨过面边界）才能超过 60 格。
    const result = spatializeTile(listener({ center: { x: 5, y: 5 } }), { x: 5, y: 90 });
    expect(result.audible).toBe(false);
    expect(result.volumeDb).toBeLessThanOrEqual(-36);
  });

  it('30 格仍播（−18 dB）', () => {
    // 32 面：y 16 → 46 跨面（16..31 是面 0，32..63 是面 3），球面距离 34；用面内 30 格的点
    const result = spatializeTile(listener({ center: { x: 16, y: 0 } }), { x: 16, y: 30 });
    expect(result.distance).toBe(30);
    expect(result.volumeDb).toBeCloseTo(-18, 5);
    expect(result.audible).toBe(true);
  });

  it('没有中心格时不空间化（0 dB / 0 声相）', () => {
    const result = spatializeTile(listener({ center: null }), { x: 99, y: 99 });
    expect(result).toEqual({ distance: 0, volumeDb: 0, pan: 0, audible: true });
  });

  it('不可投影（项目 null）时只衰减不声相', () => {
    const result = spatializeTile(listener({ project: null }), { x: 23, y: 20 });
    expect(result.pan).toBe(0);
    expect(result.volumeDb).toBeCloseTo(-1.8, 5);
  });
});

describe('globalViewTrimDb 全球视角整体衰减', () => {
  it('超过阈值 −10 dB，贴地 0', () => {
    expect(globalViewTrimDb(GLOBAL_VIEW_ALTITUDE - 1)).toBe(0);
    expect(globalViewTrimDb(GLOBAL_VIEW_ALTITUDE + 1)).toBe(GLOBAL_VIEW_TRIM_DB);
    expect(GLOBAL_VIEW_TRIM_DB).toBe(-10);
  });
});

describe('spatialForTile 播放参数', () => {
  it('监听器就绪时返回 volumeDb/pan；没有监听器或超距返回 undefined', () => {
    expect(spatialForTile({ x: 20, y: 20 })).toBeUndefined();
    setAudioListener(listener());
    expect(spatialForTile({ x: 20, y: 20 })).toMatchObject({ volumeDb: 0, pan: 0 });
    expect(spatialForTile(null)).toBeUndefined();
    // 对面面（球面距离 > 60 格）不返回播放参数
    expect(spatialForTile({ x: 5, y: 90 })).toBeUndefined();
  });
});
