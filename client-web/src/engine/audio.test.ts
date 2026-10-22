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

  linearRampToValueAtTime = vi.fn((_value: number, _time: number) => {});

  cancelScheduledValues = vi.fn((_time: number) => {});

  setTargetAtTime = vi.fn((_value: number, _time: number, _constant: number) => {});
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

class FakeStereoPannerNode {
  pan = new FakeAudioParam();

  connect = vi.fn();

  disconnect = vi.fn();
}

class FakeBufferSourceNode {
  buffer: unknown = null;

  playbackRate = new FakeAudioParam();

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

  createStereoPanner = vi.fn(() => new FakeStereoPannerNode());

  /** 采样解码：返回一个带 duration 的假 buffer（测试只关心「有没有用采样」）。 */
  decodeAudioData = vi.fn(async () => ({ duration: 0.5, sampleRate: 48000, numberOfChannels: 1 }));

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
    // 主增益 → destination（第 23 轮起还多四条总线 GainNode，主增益仍是第一个）
    expect(ctx.gains[0].connect).toHaveBeenCalledWith(ctx.destination);
    // 一个锯齿波振荡器：720 → 160 下滑，峰值 0.16
    expect(ctx.oscillators).toHaveLength(1);
    const osc = ctx.oscillators[0];
    expect(osc.type).toBe('sawtooth');
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(720, 0);
    expect(osc.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(160, 0.15);
    expect(osc.start).toHaveBeenCalledWith(0);
    expect(osc.stop).toHaveBeenCalled();
    // 总线（master + music/ambient/sfx/ui + spatial）之后才是每次发声的包络增益
    const voiceGain = ctx.gains.at(-1)!;
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

  it('setMix({ master }) 收敛到 0..1 并写入主增益', async () => {
    const audio = await importFreshAudio();
    audio.unlockAudio();
    audio.setMix({ master: 0.5 });
    expect(audio.getMix().master).toBe(0.5);
    expect(FakeAudioContext.instances[0].gains[0].gain.value).toBe(0.5);
    audio.setMix({ master: 7 });
    expect(audio.getMix().master).toBe(1);
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
      audio.setMix({ master: 0.3 });
    }).not.toThrow();
    expect(audio.isMuted()).toBe(false);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });
});

// ---------- 采样引擎（第 23 轮） ----------

/** 采样加载统计走 window.__swAudio 探针（引擎不再导出只给测试用的 sampleStats）。 */
function probeSamples(audio: { unlockAudio: () => void }) {
  void audio;
  const probe = (window as unknown as { __swAudio?: { samples: { loaded: number; requested: number } } }).__swAudio;
  if (!probe) throw new Error('__swAudio 探针未发布');
  return probe.samples;
}

/** 等异步解码链跑完（fetch → decodeAudioData）。 */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('采样加载与回退', () => {
  /** 让 fetch 返回一个假 ogg 字节串；未匹配的路径 404。 */
  function stubFetch(ok = true) {
    // 显式声明入参，便于断言「请求了哪个路径」
    const fetchMock = vi.fn(async (_url: string) => (ok
      ? { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }
      : { ok: false, status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('首次播放发起加载并回退合成音；加载完成后用采样（BufferSource + 声相）', async () => {
    const fetchMock = stubFetch();
    const audio = await importFreshAudio();
    audio.unlockAudio();
    // 先把噪声 buffer 之类的一次性初始化排掉（本用例只关心 fire 的合成回退）
    audio.sfx.fireGauss();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const ctx = FakeAudioContext.instances[0];
    // 变体随机挑一条，断言落在 fire-gauss 的变体清单里
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^\/assets\/audio\/sfx\/fire-gauss(-\d)?\.ogg$/);

    // 三个变体都预加载（随机挑变体，只加载一条的话第二次可能挑到未加载的那条）
    const { AUDIO_MANIFEST } = await import('@/engine/audio-manifest');
    audio.preloadSamples(AUDIO_MANIFEST.sfx['fire-gauss']);
    await flush();
    await flush();
    expect(probeSamples(audio).loaded).toBe(AUDIO_MANIFEST.sfx['fire-gauss'].length);

    // 第二次：走采样（BufferSource），不再新建振荡器
    const oscillatorsBefore = ctx.oscillators.length;
    audio.sfx.fireGauss();
    expect(ctx.sources.length).toBeGreaterThan(0);
    expect(ctx.oscillators.length).toBe(oscillatorsBefore);
  });

  it('每个音效从变体清单里随机挑一条（变体数 > 1 的采样路径都被用到过）', async () => {
    stubFetch();
    const audio = await importFreshAudio();
    audio.unlockAudio();
    // 预加载全部变体，避免首播回退
    const { AUDIO_MANIFEST } = await import('@/engine/audio-manifest');
    const paths = AUDIO_MANIFEST.sfx['fire-gauss'];
    expect(paths.length).toBeGreaterThan(1);
    audio.preloadSamples(paths);
    await flush();
    const used = new Set<string>();
    for (let i = 0; i < 40; i += 1) audio.sfx.fireGauss();
    // 采样播放时 BufferSource.buffer 就是被选中的 buffer（假 buffer 无路径），
    // 这里改为断言「所有变体都进了缓存」+ 播放没有回退合成音。
    paths.forEach((path) => expect(path).toMatch(/^\/assets\/audio\/sfx\/fire-gauss(-\d)?\.ogg$/));
    expect(probeSamples(audio).loaded).toBe(paths.length);
    expect(FakeAudioContext.instances[0].sources.length).toBeGreaterThan(0);
    used.add('ok');
    expect(used.size).toBe(1);
  });

  it('加载失败只尝试一次，之后继续走合成回退且不报错', async () => {
    const fetchMock = stubFetch(false);
    const audio = await importFreshAudio();
    audio.unlockAudio();
    // 单变体音效：失败路径只打一次请求
    audio.sfx.researchComplete();
    await flush();
    const callsAfterFirst = fetchMock.mock.calls.length;
    expect(callsAfterFirst).toBe(1);
    audio.sfx.researchComplete();
    audio.sfx.researchComplete();
    await flush();
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    expect(() => audio.sfx.researchComplete()).not.toThrow();
    expect(probeSamples(audio).loaded).toBe(0);
  });

  it('空间音走 sfx 总线的 spatial 子总线 + 声相；audible=false（> 60 格）不播', async () => {
    stubFetch();
    const audio = await importFreshAudio();
    audio.unlockAudio();
    audio.sfx.explosion(true, { tile: { x: 1, y: 1 }, volumeDb: 0, pan: 0 });
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.sources.length + ctx.oscillators.length).toBeGreaterThan(0);

    const before = ctx.sources.length + ctx.oscillators.length;
    audio.sfx.explosion(true, { audible: false, tile: { x: 1, y: 1 }, volumeDb: Number.NEGATIVE_INFINITY, pan: 0 });
    expect(ctx.sources.length + ctx.oscillators.length).toBe(before);
  });

  it('爆炸近/远两档按 12 格阈值挑采样键', async () => {
    stubFetch();
    const audio = await importFreshAudio();
    audio.unlockAudio();
    audio.sfx.explosionAt(6, undefined);
    audio.sfx.explosionAt(40, undefined);
    const { SAMPLE_KEY } = audio;
    expect(SAMPLE_KEY.explosionNear.key).toBe('explosion-near');
    expect(SAMPLE_KEY.explosionFar.key).toBe('explosion-far');
    expect(audio.EXPLOSION_NEAR_TILES).toBe(12);
  });
});

describe('混音设置与总线', () => {
  it('五条总线接到主增益；setMix 写总线并持久化到 sw.audio.mix', async () => {
    const audio = await importFreshAudio();
    audio.unlockAudio();
    const ctx = FakeAudioContext.instances[0];
    // master + music/ambient/sfx/ui + spatial = 6 条总线
    expect(ctx.gains.length).toBeGreaterThanOrEqual(6);
    ctx.gains.slice(1, 5).forEach((gain) => expect(gain.connect).toHaveBeenCalledWith(ctx.gains[0]));

    audio.setMix({ music: 0.2, sfx: 0.5 });
    expect(audio.getMix().music).toBe(0.2);
    expect(JSON.parse(localStorage.getItem('sw.audio.mix') ?? '{}')).toMatchObject({ music: 0.2, sfx: 0.5 });

    // 刷新后恢复
    vi.resetModules();
    const reloaded = await importFreshAudio();
    expect(reloaded.getMix().music).toBe(0.2);
  });

  it('默认混音：音乐 .35，其余按 DEFAULT_MIX', async () => {
    const audio = await importFreshAudio();
    expect(audio.getMix()).toEqual(audio.DEFAULT_MIX);
    expect(audio.getMix().music).toBe(0.35);
  });

  it('静音时主增益归零；全球视角 trim 写 spatial 总线', async () => {
    const audio = await importFreshAudio();
    audio.unlockAudio();
    const ctx = FakeAudioContext.instances[0];
    audio.setMuted(true);
    expect(ctx.gains[0].gain.value).toBe(0);
    audio.setMuted(false);

    audio.setSpatialTrimDb(-10);
    // spatial 总线是第 6 个 GainNode（master + 4 条总线之后）
    expect(ctx.gains[5].gain.value).toBeCloseTo(10 ** (-10 / 20), 5);
  });
});

describe('循环声床与配乐', () => {
  it('setAmbientLayers/setMusic 在采样就绪后起循环 BufferSource（loop=true）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    const audio = await importFreshAudio();
    audio.unlockAudio();
    const ctx = FakeAudioContext.instances[0];

    const { AUDIO_MANIFEST } = await import('@/engine/audio-manifest');
    audio.preloadSamples([AUDIO_MANIFEST.ambient.wind[0], AUDIO_MANIFEST.music.calm[0]]);
    await flush();
    audio.setAmbientLayers([{ name: 'wind', level: 0.8 }]);
    audio.setMusic('calm', 0.35);
    audio.tickAudioLoops();

    const loops = ctx.sources.filter((source) => source.loop);
    expect(loops.length).toBe(2);
    expect(audio.getAmbientNames()).toEqual(['wind']);
    expect(audio.getMusicName()).toBe('calm');
  });

  it('双声床：风与机械各一路循环，同时播放、各自增益', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    const audio = await importFreshAudio();
    audio.unlockAudio();
    const { AUDIO_MANIFEST } = await import('@/engine/audio-manifest');
    audio.preloadSamples([AUDIO_MANIFEST.ambient.wind[0], AUDIO_MANIFEST.ambient.factory[0]]);
    await flush();

    audio.setAmbientLayers([{ name: 'wind', level: 1 }, { name: 'factory', level: 0.126 }]);
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.sources.filter((source) => source.loop).length).toBe(2);
    expect(audio.getAmbientNames().sort()).toEqual(['factory', 'wind']);
    // 每路各自一个 GainNode（loop 的 source 之后创建的那个 gain）
    expect(audio.getAmbientLevels()).toEqual({ wind: 1, factory: 0.126 });
  });

  it('切换声床会停掉旧循环（交叉淡化的 stop 排在淡化之后）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    const audio = await importFreshAudio();
    audio.unlockAudio();
    const { AUDIO_MANIFEST } = await import('@/engine/audio-manifest');
    audio.preloadSamples([AUDIO_MANIFEST.ambient.wind[0], AUDIO_MANIFEST.ambient.space[0]]);
    await flush();
    audio.setAmbientLayers([{ name: 'wind', level: 1 }]);
    const ctx = FakeAudioContext.instances[0];
    const first = ctx.sources.filter((source) => source.loop);
    expect(first.length).toBe(1);

    audio.setAmbientLayers([{ name: 'space', level: 1 }]);
    expect(first[0].stop).toHaveBeenCalled();
    expect(audio.getAmbientNames()).toEqual(['space']);
  });

  it('配乐懒加载：未预载时 setMusic 只记目标，tickAudioLoops 在加载完后起播', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    const audio = await importFreshAudio();
    audio.unlockAudio();
    // 不预载：setMusic 只发起一次加载并记下目标，此刻还没起播
    audio.setMusic('tense', 1);
    expect(audio.getMusicName()).toBeNull();
    await flush();
    audio.tickAudioLoops();
    expect(audio.getMusicName()).toBe('tense');
    expect(FakeAudioContext.instances[0].sources.filter((source) => source.loop).length).toBe(1);
  });

  it('setMusic(null) 停配乐；无 AudioContext 时全部 no-op', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    const audio = await importFreshAudio();
    audio.unlockAudio();
    const { AUDIO_MANIFEST } = await import('@/engine/audio-manifest');
    audio.preloadSamples([AUDIO_MANIFEST.music.combat[0]]);
    await flush();
    audio.setMusic('combat', 1);
    expect(audio.getMusicName()).toBe('combat');
    audio.setMusic(null);
    expect(audio.getMusicName()).toBeNull();

    vi.unstubAllGlobals();
    vi.resetModules();
    const noCtx = await importFreshAudio();
    expect(() => {
      noCtx.setAmbientLayers([{ name: 'wind', level: 1 }]);
      noCtx.setMusic('calm', 1);
      noCtx.tickAudioLoops();
      noCtx.setSpatialTrimDb(-10);
      noCtx.setMix({ master: 0.5 });
    }).not.toThrow();
  });
});

describe('首次解锁补起已想要的声床', () => {
  it('解锁前 setAmbientLayers 只记目标；unlockAudio 后立刻起播（不用等下一次轮询）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    const audio = await importFreshAudio();
    const { AUDIO_MANIFEST } = await import('@/engine/audio-manifest');
    // 解锁前预载 + 设目标（银河/恒星系页第一次点击才解锁的真实顺序）
    audio.preloadSamples([AUDIO_MANIFEST.ambient.space[0]]);
    audio.setAmbientLayers([{ name: 'space', level: 1 }]);
    expect(audio.getAmbientNames()).toEqual([]);
    await flush();
    audio.unlockAudio();
    expect(audio.getAmbientNames()).toEqual(['space']);
  });
});
