import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * engine/audio 测试：
 * - buildSoundSpecs / createRateLimiter 是纯函数，直接断言参数映射与限流逻辑；
 * - 引擎行为用 vi.stubGlobal 注入最小 AudioContext 桩（jsdom 无 WebAudio）；
 * - 每个用例 vi.resetModules + 动态 import，保证模块级状态（unlocked/muted/限流桶）干净。
 */

class FakeAudioParam {
  value = 0;

  setValueAtTime = vi.fn((_value: number, _time: number) => {});

  exponentialRampToValueAtTime = vi.fn((_value: number, _time: number) => {});
}

class FakeOscillatorNode {
  type = 'sine';

  frequency = new FakeAudioParam();

  detune = new FakeAudioParam();

  connect = vi.fn();

  disconnect = vi.fn();

  start = vi.fn();

  stop = vi.fn();

  onended: (() => void) | null = null;
}

class FakeGainNode {
  gain = new FakeAudioParam();

  connect = vi.fn();

  disconnect = vi.fn();
}

class FakeBiquadFilterNode {
  type = 'lowpass';

  frequency = new FakeAudioParam();

  connect = vi.fn();

  disconnect = vi.fn();
}

class FakeBufferSourceNode {
  buffer: unknown = null;

  loop = false;

  connect = vi.fn();

  disconnect = vi.fn();

  start = vi.fn();

  stop = vi.fn();

  onended: (() => void) | null = null;
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  state: 'running' | 'suspended' = 'running';

  currentTime = 0;

  sampleRate = 8000;

  destination = { kind: 'destination' };

  oscillators: FakeOscillatorNode[] = [];

  gains: FakeGainNode[] = [];

  filters: FakeBiquadFilterNode[] = [];

  sources: FakeBufferSourceNode[] = [];

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createOscillator = vi.fn(() => {
    const node = new FakeOscillatorNode();
    this.oscillators.push(node);
    return node;
  });

  createGain = vi.fn(() => {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  });

  createBiquadFilter = vi.fn(() => {
    const node = new FakeBiquadFilterNode();
    this.filters.push(node);
    return node;
  });

  createBufferSource = vi.fn(() => {
    const node = new FakeBufferSourceNode();
    this.sources.push(node);
    return node;
  });

  createBuffer = vi.fn((_channels: number, length: number, _sampleRate: number) => ({
    getChannelData: () => new Float32Array(length),
  }));

  resume = vi.fn(() => Promise.resolve());
}

type AudioModule = typeof import('@/engine/audio');

async function importFreshAudio(): Promise<AudioModule> {
  return import('@/engine/audio');
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  FakeAudioContext.instances = [];
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildSoundSpecs 纯函数映射', () => {
  it('fire：短促下滑锯齿波，带随机 detune', async () => {
    const { buildSoundSpecs } = await importFreshAudio();
    const specs = buildSoundSpecs('fire', { random: () => 1 });
    expect(specs).toHaveLength(1);
    const tone = specs[0];
    expect(tone).toMatchObject({
      kind: 'tone',
      type: 'sawtooth',
      freq: 720,
      freqEnd: 160,
      duration: 0.15,
      detune: 30,
    });
    expect(tone.gain).toBeLessThanOrEqual(0.2);
  });

  it('explosion：小爆炸 0.4s 噪声低通扫频；大爆炸 0.8s 追加低频下潜', async () => {
    const { buildSoundSpecs } = await importFreshAudio();

    const small = buildSoundSpecs('explosion');
    expect(small).toHaveLength(1);
    expect(small[0]).toMatchObject({ kind: 'noise', duration: 0.4, filterType: 'lowpass' });
    expect((small[0] as { filterFreq: number }).filterFreq)
      .toBeGreaterThan((small[0] as { filterEnd?: number }).filterEnd ?? 0);

    const big = buildSoundSpecs('explosion', { big: true });
    expect(big).toHaveLength(2);
    expect(big[0]).toMatchObject({ kind: 'noise', duration: 0.8 });
    expect(big[1]).toMatchObject({ kind: 'tone', type: 'sine' });
    expect((big[1] as { freqEnd?: number }).freqEnd).toBeLessThan((big[1] as { freq: number }).freq);
  });

  it('commandOk 双音上行 / commandFail 低音方波下行', async () => {
    const { buildSoundSpecs } = await importFreshAudio();

    const ok = buildSoundSpecs('commandOk');
    expect(ok).toHaveLength(2);
    expect((ok[1] as { freq: number }).freq).toBeGreaterThan((ok[0] as { freq: number }).freq);
    expect(ok[1].delay).toBeGreaterThan(0);

    const fail = buildSoundSpecs('commandFail');
    expect(fail).toHaveLength(1);
    expect(fail[0]).toMatchObject({ kind: 'tone', type: 'square' });
    expect((fail[0] as { freqEnd?: number }).freqEnd).toBeLessThan((fail[0] as { freq: number }).freq);
  });

  it('buildComplete 三音和弦齐响 / researchComplete 琶音递延 / alert 双脉冲 / uiClick 极短', async () => {
    const { buildSoundSpecs } = await importFreshAudio();

    const chord = buildSoundSpecs('buildComplete');
    expect(chord).toHaveLength(3);
    expect(chord.every((spec) => spec.kind === 'tone' && (spec.delay ?? 0) === 0)).toBe(true);
    expect(chord.reduce((sum, spec) => sum + spec.gain, 0)).toBeLessThanOrEqual(0.25);

    const arpeggio = buildSoundSpecs('researchComplete');
    expect(arpeggio).toHaveLength(4);
    for (let i = 1; i < arpeggio.length; i += 1) {
      expect(arpeggio[i].delay).toBeGreaterThan(arpeggio[i - 1].delay ?? 0);
    }

    const alert = buildSoundSpecs('alert');
    expect(alert).toHaveLength(2);
    expect((alert[0] as { freq: number }).freq).toBe((alert[1] as { freq: number }).freq);
    expect(alert[1].delay).toBeGreaterThan(0);

    const click = buildSoundSpecs('uiClick');
    expect(click).toHaveLength(1);
    expect(click[0].duration).toBeLessThanOrEqual(0.05);
  });

  it('音量克制：全部音效单音 peak ≤ 0.22，且除大爆炸外总时长 < 1s', async () => {
    const { buildSoundSpecs } = await importFreshAudio();
    const names = ['fire', 'explosion', 'intercept', 'commandOk', 'commandFail', 'buildComplete', 'researchComplete', 'alert', 'uiClick'] as const;
    names.forEach((name) => {
      buildSoundSpecs(name, { random: () => 0.5 }).forEach((spec) => {
        expect(spec.gain).toBeLessThanOrEqual(0.22);
        expect((spec.delay ?? 0) + spec.duration).toBeLessThan(1);
      });
    });
    // 大爆炸是唯一允许接近 1s 的音效
    buildSoundSpecs('explosion', { big: true }).forEach((spec) => {
      expect(spec.gain).toBeLessThanOrEqual(0.22);
      expect((spec.delay ?? 0) + spec.duration).toBeLessThanOrEqual(1);
    });
  });
});

describe('createRateLimiter 限流', () => {
  it('同窗口最多放行 maxPlays 次，窗口过后恢复', async () => {
    const { createRateLimiter } = await importFreshAudio();
    const limiter = createRateLimiter(50, 3);
    const results = Array.from({ length: 10 }, (_, i) => limiter.allow('explosion', 1000 + i));
    expect(results).toEqual([true, true, true, false, false, false, false, false, false, false]);
    expect(limiter.allow('explosion', 1050)).toBe(true);
  });

  it('不同 key 独立计数', async () => {
    const { createRateLimiter } = await importFreshAudio();
    const limiter = createRateLimiter(50, 1);
    expect(limiter.allow('fire', 0)).toBe(true);
    expect(limiter.allow('fire', 1)).toBe(false);
    expect(limiter.allow('intercept', 1)).toBe(true);
  });
});

describe('引擎行为（stub AudioContext）', () => {
  it('unlock 前播放静默丢弃：不创建 AudioContext 与任何节点', async () => {
    const { sfx } = await importFreshAudio();
    sfx.fire();
    sfx.explosion(true);
    sfx.commandOk();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('unlock 后 fire 创建正确参数的振荡器节点并接主增益', async () => {
    const { sfx, unlockAudio } = await importFreshAudio();
    unlockAudio();
    sfx.fire();

    expect(FakeAudioContext.instances).toHaveLength(1);
    const ctx = FakeAudioContext.instances[0];
    // 主增益 → destination
    expect(ctx.gains[0].connect).toHaveBeenCalledWith(ctx.destination);
    // 一个锯齿波振荡器：720 → 160 下滑，峰值 0.16
    expect(ctx.oscillators).toHaveLength(1);
    const osc = ctx.oscillators[0];
    expect(osc.type).toBe('sawtooth');
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(720, 0);
    expect(osc.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(160, 0.15);
    expect(osc.start).toHaveBeenCalledWith(0);
    expect(osc.stop).toHaveBeenCalled();
    const voiceGain = ctx.gains[1];
    expect(voiceGain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.16, 0.005);
  });

  it('explosion(big) 走噪声 buffer + 低通扫频 + 低频正弦', async () => {
    const { sfx, unlockAudio } = await importFreshAudio();
    unlockAudio();
    sfx.explosion(true);

    const ctx = FakeAudioContext.instances[0];
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].loop).toBe(true);
    expect(ctx.filters).toHaveLength(1);
    expect(ctx.filters[0].type).toBe('lowpass');
    expect(ctx.filters[0].frequency.setValueAtTime).toHaveBeenCalledWith(4200, 0);
    expect(ctx.filters[0].frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(120, 0.8);
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0].type).toBe('sine');
  });

  it('限流合并：同帧 10 个爆炸只播 3 个', async () => {
    const { sfx, unlockAudio } = await importFreshAudio();
    unlockAudio();
    for (let i = 0; i < 10; i += 1) {
      sfx.explosion();
    }
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.sources).toHaveLength(3);
  });

  it('静音后播放丢弃，静音状态持久化并在新模块实例恢复', async () => {
    const audio = await importFreshAudio();
    audio.unlockAudio();
    audio.setMuted(true);
    expect(audio.isMuted()).toBe(true);
    expect(localStorage.getItem('sw.audio.muted')).toBe('1');

    audio.sfx.fire();
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(0);

    // 模拟刷新：新模块实例从 localStorage 恢复静音
    vi.resetModules();
    const reloaded = await importFreshAudio();
    expect(reloaded.isMuted()).toBe(true);

    reloaded.setMuted(false);
    expect(localStorage.getItem('sw.audio.muted')).toBe('0');
    reloaded.unlockAudio();
    reloaded.sfx.fire();
    const reloadedCtx = FakeAudioContext.instances[FakeAudioContext.instances.length - 1];
    expect(reloadedCtx.oscillators.length).toBeGreaterThan(0);
  });

  it('setVolume 收敛到 0..1 并写入主增益', async () => {
    const audio = await importFreshAudio();
    audio.unlockAudio();
    audio.setVolume(0.5);
    expect(audio.getVolume()).toBe(0.5);
    expect(FakeAudioContext.instances[0].gains[0].gain.value).toBe(0.5);
    audio.setVolume(7);
    expect(audio.getVolume()).toBe(1);
  });
});

describe('无 AudioContext 环境（no-op 降级）', () => {
  it('所有 API 可调用不抛错', async () => {
    vi.unstubAllGlobals();
    const audio = await importFreshAudio();
    expect(() => {
      audio.unlockAudio();
      audio.sfx.fire();
      audio.sfx.explosion(true);
      audio.sfx.intercept();
      audio.sfx.commandOk();
      audio.sfx.commandFail();
      audio.sfx.buildComplete();
      audio.sfx.researchComplete();
      audio.sfx.alert();
      audio.sfx.uiClick();
      audio.setMuted(true);
      audio.setMuted(false);
      audio.setVolume(0.3);
    }).not.toThrow();
    expect(audio.isMuted()).toBe(false);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });
});
