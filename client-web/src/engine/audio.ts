/**
 * 游戏音频引擎（第 23 轮 3A 音频分支）。
 *
 * 结构：
 * - **总线**：master ← music / ambient / sfx / ui，各自一个 GainNode（设置面板的五个滑条）；
 *   另有 spatial 总线下挂到 sfx，空间衰减与全球视角整体压低只改它。
 * - **采样**：public/assets/audio 下的 Opus 成品（见 develop_tools/audio/build.mjs 与
 *   THIRD_PARTY.md），按需 `decodeAudioData` 懒加载并缓存；同一音效有多个变体，随机挑一个
 *   并做 ±4% 音高 / ±2 dB 音量扰动。
 * - **回退**：采样未加载完（或加载失败）时用程序合成音顶上（`buildSoundSpecs` 的旧语义
 *   原样保留），所以 jsdom / 首帧 / 弱网都不会「没声音」或报错。
 * - **循环声床**：每层（风 / 基地嗡鸣 / 轨道低频）各一路 BufferSource(loop=true) + GainNode，
 *   同时播放、各自增益；消失的层淡出（1.5s）。配乐同机制，切换 3s 交叉淡化。
 *
 * 设计约束（与旧版一致，测试依赖）：
 * - 惰性创建 AudioContext，首次用户手势（pointerdown/keydown 捕获阶段）后 unlock，
 *   unlock 之前所有播放调用静默丢弃。
 * - 静音持久化到 localStorage（sw.audio.muted），音量存 sw.audio.mix。
 * - 同类音效 50ms 窗口内最多播 3 次；静音 / 无 AudioContext / 采样失败都不抛错。
 */

import { AUDIO_MANIFEST } from './audio-manifest';

// ---------- 程序合成规格（回退路径，纯数据） ----------

export interface ToneSpec {
  kind: 'tone';
  freq: number;
  freqEnd?: number;
  type: OscillatorType;
  /** 秒。 */
  duration: number;
  /** 秒，默认 0.005。 */
  attack?: number;
  /** 秒，包络末尾的释放时长，默认整段指数衰减。 */
  release?: number;
  /** 峰值音量（线性，0..1）。 */
  gain: number;
  /** 音分偏移（随机防机械感用）。 */
  detune?: number;
  /** 相对当前的起播延迟（秒），用于和弦/琶音/双脉冲。 */
  delay?: number;
}

export interface NoiseSpec {
  kind: 'noise';
  duration: number;
  filterFreq: number;
  filterEnd?: number;
  filterType?: BiquadFilterType;
  gain: number;
  attack?: number;
  release?: number;
  delay?: number;
}

export type SoundSpec = ToneSpec | NoiseSpec;

/** 语义音效名（保留旧名 + 第 23 轮扩充）。 */
export type SoundName =
  // 旧名（保持映射语义，测试仍覆盖）
  | 'fire'
  | 'explosion'
  | 'intercept'
  | 'commandOk'
  | 'commandFail'
  | 'buildComplete'
  | 'researchComplete'
  | 'alert'
  | 'uiClick'
  // 开火按炮塔类型
  | 'fireGauss'
  | 'fireLaser'
  | 'fireMissile'
  | 'firePlasma'
  | 'fireGeneric'
  // 战斗
  | 'explosionNear'
  | 'explosionFar'
  | 'hit'
  // 建造
  | 'buildPlace'
  | 'demolish'
  | 'beltPlace'
  | 'constructionComplete'
  // 单位与指令
  | 'unitSelect'
  | 'unitAck'
  | 'orderMove'
  | 'orderAttack'
  | 'notify'
  // UI
  | 'uiHover'
  | 'uiPanelOpen'
  | 'uiPanelClose';

/** 音效 → 采样清单键（AUDIO_MANIFEST 的 sfx / ui 分组）。 */
export const SAMPLE_KEY: Record<SoundName, { bus: 'sfx' | 'ui'; key: string }> = {
  fire: { bus: 'sfx', key: 'fire-generic' },
  explosion: { bus: 'sfx', key: 'explosion-near' },
  intercept: { bus: 'sfx', key: 'intercept' },
  commandOk: { bus: 'sfx', key: 'command-ok' },
  commandFail: { bus: 'sfx', key: 'command-fail' },
  buildComplete: { bus: 'sfx', key: 'construction-complete' },
  researchComplete: { bus: 'sfx', key: 'research-complete' },
  alert: { bus: 'sfx', key: 'alert' },
  uiClick: { bus: 'ui', key: 'click' },
  fireGauss: { bus: 'sfx', key: 'fire-gauss' },
  fireLaser: { bus: 'sfx', key: 'fire-laser' },
  fireMissile: { bus: 'sfx', key: 'fire-missile' },
  firePlasma: { bus: 'sfx', key: 'fire-plasma' },
  fireGeneric: { bus: 'sfx', key: 'fire-generic' },
  explosionNear: { bus: 'sfx', key: 'explosion-near' },
  explosionFar: { bus: 'sfx', key: 'explosion-far' },
  hit: { bus: 'sfx', key: 'hit' },
  buildPlace: { bus: 'sfx', key: 'build-place' },
  demolish: { bus: 'sfx', key: 'demolish' },
  beltPlace: { bus: 'sfx', key: 'belt-place' },
  constructionComplete: { bus: 'sfx', key: 'construction-complete' },
  unitSelect: { bus: 'sfx', key: 'unit-select' },
  unitAck: { bus: 'sfx', key: 'unit-ack' },
  orderMove: { bus: 'sfx', key: 'order-move' },
  orderAttack: { bus: 'sfx', key: 'order-attack' },
  notify: { bus: 'sfx', key: 'notify' },
  uiHover: { bus: 'ui', key: 'hover' },
  uiPanelOpen: { bus: 'ui', key: 'panel-open' },
  uiPanelClose: { bus: 'ui', key: 'panel-close' },
};

export interface BuildSoundOptions {
  /** explosion 专用：大爆炸（击毁）更久更沉。 */
  big?: boolean;
  /** 注入随机源便于测试（默认 Math.random）。 */
  random?: () => number;
}

/** 战斗音效的随机 detune 幅度（±30 音分）。 */
const COMBAT_DETUNE_CENTS = 30;

/**
 * 语义音效 → 合成参数映射（纯函数，采样缺失时的回退）。
 * 音量克制：单音 peak 均 ≤ 0.22；除大爆炸（0.8s）外所有音效总时长 < 1s。
 */
export function buildSoundSpecs(name: SoundName, options: BuildSoundOptions = {}): SoundSpec[] {
  const random = options.random ?? Math.random;
  const combatDetune = () => Math.round((random() - 0.5) * 2 * COMBAT_DETUNE_CENTS);

  switch (name) {
    case 'fire':
    case 'fireGeneric':
    case 'fireGauss':
    case 'fireLaser':
    case 'fireMissile':
    case 'firePlasma':
      // 开火：短促下滑音（各类型只在音高/波形上区分）
      return [
        {
          kind: 'tone',
          type: name === 'firePlasma' ? 'square' : 'sawtooth',
          freq: name === 'fireGauss' ? 900 : name === 'fireLaser' ? 1250 : name === 'firePlasma' ? 480 : 720,
          freqEnd: 160,
          duration: 0.15,
          gain: 0.16,
          detune: combatDetune(),
        },
      ];
    case 'explosion':
    case 'explosionNear':
    case 'explosionFar': {
      const big = options.big === true;
      const far = name === 'explosionFar';
      const specs: SoundSpec[] = [
        {
          kind: 'noise',
          duration: big ? 0.8 : far ? 0.55 : 0.4,
          filterFreq: big ? 4200 : far ? 1400 : 2600,
          filterEnd: big ? 120 : far ? 180 : 240,
          filterType: 'lowpass',
          gain: big ? 0.2 : 0.18,
        },
      ];
      if (big) {
        specs.push({ kind: 'tone', type: 'sine', freq: 110, freqEnd: 38, duration: 0.6, gain: 0.18 });
      }
      return specs;
    }
    case 'intercept':
      return [
        { kind: 'tone', type: 'square', freq: 2400, freqEnd: 1700, duration: 0.08, gain: 0.1, detune: combatDetune() },
      ];
    case 'hit':
      return [
        { kind: 'noise', duration: 0.12, filterFreq: 3200, filterEnd: 900, filterType: 'bandpass', gain: 0.14 },
      ];
    case 'commandOk':
      return [
        { kind: 'tone', type: 'sine', freq: 660, duration: 0.07, gain: 0.14 },
        { kind: 'tone', type: 'sine', freq: 880, duration: 0.1, gain: 0.14, delay: 0.07 },
      ];
    case 'commandFail':
      return [
        { kind: 'tone', type: 'square', freq: 200, freqEnd: 95, duration: 0.24, gain: 0.14 },
      ];
    case 'buildComplete':
    case 'constructionComplete':
      return [523.25, 659.25, 783.99].map((freq): ToneSpec => ({
        kind: 'tone', type: 'sine', freq, duration: 0.35, gain: 0.07,
      }));
    case 'researchComplete':
      return [523.25, 659.25, 783.99, 1046.5].map((freq, index): ToneSpec => ({
        kind: 'tone', type: 'triangle', freq, duration: 0.1, gain: 0.12, delay: index * 0.08,
      }));
    case 'alert':
      return [0, 0.16].map((delay): ToneSpec => ({
        kind: 'tone', type: 'square', freq: 740, duration: 0.09, gain: 0.13, delay,
      }));
    case 'notify':
      return [{ kind: 'tone', type: 'sine', freq: 880, duration: 0.12, gain: 0.1 }];
    case 'buildPlace':
    case 'beltPlace':
    case 'demolish':
      return [
        { kind: 'noise', duration: 0.09, filterFreq: 1800, filterEnd: 700, filterType: 'lowpass', gain: 0.12 },
      ];
    case 'unitSelect':
    case 'unitAck':
      return [{ kind: 'tone', type: 'sine', freq: 990, duration: 0.05, gain: 0.08 }];
    case 'orderMove':
    case 'orderAttack':
      return [{ kind: 'tone', type: 'triangle', freq: 720, freqEnd: 900, duration: 0.08, gain: 0.1 }];
    case 'uiClick':
    case 'uiHover':
      return [
        { kind: 'tone', type: 'square', freq: 1250, duration: 0.03, gain: 0.07 },
      ];
    case 'uiPanelOpen':
    case 'uiPanelClose':
      return [
        { kind: 'tone', type: 'sine', freq: 520, freqEnd: 780, duration: 0.08, gain: 0.08 },
      ];
  }
}

// ---------- 限流（纯逻辑，便于测试） ----------

export interface SoundRateLimiter {
  /** nowMs 时刻 key 类音效是否允许播放（窗口内计数 +1）；可覆盖窗口/次数。 */
  allow(key: string, nowMs: number, windowMs?: number, maxPlays?: number): boolean;
}

/** 同类音效 windowMs 毫秒内最多播 maxPlays 次，超出的直接丢弃。 */
export function createRateLimiter(windowMs = 50, maxPlays = 3): SoundRateLimiter {
  const buckets = new Map<string, { windowStart: number; count: number }>();
  return {
    allow(key, nowMs, customWindowMs, customMaxPlays) {
      const window = customWindowMs ?? windowMs;
      const max = customMaxPlays ?? maxPlays;
      const bucket = buckets.get(key);
      if (!bucket || nowMs - bucket.windowStart >= window) {
        buckets.set(key, { windowStart: nowMs, count: 1 });
        return true;
      }
      if (bucket.count >= max) {
        return false;
      }
      bucket.count += 1;
      return true;
    },
  };
}

// ---------- 混音设置 ----------

export type MixBus = 'master' | 'music' | 'ambient' | 'sfx' | 'ui';

export interface MixSettings {
  master: number;
  music: number;
  ambient: number;
  sfx: number;
  ui: number;
}

/** 默认混音：音乐 .35（契约 §7），其余 1。 */
export const DEFAULT_MIX: MixSettings = { master: 1, music: 0.35, ambient: 0.6, sfx: 1, ui: 0.8 };

const MIX_STORAGE_KEY = 'sw.audio.mix';
const MUTED_STORAGE_KEY = 'sw.audio.muted';
const MIN_GAIN = 0.0001;

function readPersistedMix(): MixSettings {
  try {
    const raw = globalThis.localStorage?.getItem(MIX_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MIX };
    const parsed = JSON.parse(raw) as Partial<MixSettings>;
    return {
      master: clamp01(parsed.master ?? DEFAULT_MIX.master),
      music: clamp01(parsed.music ?? DEFAULT_MIX.music),
      ambient: clamp01(parsed.ambient ?? DEFAULT_MIX.ambient),
      sfx: clamp01(parsed.sfx ?? DEFAULT_MIX.sfx),
      ui: clamp01(parsed.ui ?? DEFAULT_MIX.ui),
    };
  } catch {
    return { ...DEFAULT_MIX };
  }
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | undefined {
  const scope = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

function isAudioSupported(): boolean {
  return getAudioContextCtor() !== undefined;
}

function readPersistedMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(MUTED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistMuted(next: boolean) {
  try {
    globalThis.localStorage?.setItem(MUTED_STORAGE_KEY, next ? '1' : '0');
  } catch {
    // 隐私模式等 localStorage 不可用时静默忽略
  }
}

function persistMix(next: MixSettings) {
  try {
    globalThis.localStorage?.setItem(MIX_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 同上
  }
}

let context: AudioContext | null = null;
let masterGain: GainNode | null = null;
/** 五条总线（master 之外的四条挂到 master 上；spatial 挂到 sfx 上）。 */
let busGains: Record<Exclude<MixBus, 'master'>, GainNode> | null = null;
let spatialGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let unlocked = false;
let muted = readPersistedMuted();
let mix: MixSettings = readPersistedMix();
/** 空间化总衰减（dB）：全球视角整体 −10 dB，贴地视角 0。 */
let spatialTrimDb = 0;
const limiter = createRateLimiter();
/** 播放诊断计数（window.__swAudio.diag）。 */
let sceneTicks = 0;
/** 音频场景 hook 每次 apply 调一次（诊断用）。 */
export function noteSceneTick() {
  sceneTicks += 1;
}
const diag = {
  playCalls: 0,
  skippedUnsupported: 0,
  skippedMuted: 0,
  skippedLocked: 0,
  skippedLimited: 0,
  skippedSuspended: 0,
  samplePlays: 0,
  sampleMisses: 0,
  skippedInaudible: 0,
};
/** 采样缓存：路径 → 已解码 AudioBuffer；解码中 / 失败的路径记在下面两张表里。 */
const sampleCache = new Map<string, AudioBuffer>();
const samplesLoading = new Set<string>();
const samplesFailed = new Set<string>();

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function dbToGain(db: number) {
  return 10 ** (db / 20);
}

function ensureContext(): AudioContext | null {
  if (context) {
    return context;
  }
  const Ctor = getAudioContextCtor();
  if (!Ctor) {
    return null;
  }
  context = new Ctor();
  masterGain = context.createGain();
  masterGain.connect(context.destination);
  busGains = {
    music: context.createGain(),
    ambient: context.createGain(),
    sfx: context.createGain(),
    ui: context.createGain(),
  };
  for (const gain of Object.values(busGains)) gain.connect(masterGain);
  spatialGain = context.createGain();
  spatialGain.connect(busGains.sfx);
  applyMixGains();
  return context;
}

/** 把 mix 设置写到各总线（master 乘静音）。 */
function applyMixGains() {
  if (!masterGain || !busGains) return;
  masterGain.gain.value = muted ? 0 : mix.master;
  busGains.music.gain.value = mix.music;
  busGains.ambient.gain.value = mix.ambient;
  busGains.sfx.gain.value = mix.sfx;
  busGains.ui.gain.value = mix.ui;
  if (spatialGain) spatialGain.gain.value = dbToGain(spatialTrimDb);
}

// ---------- 对外控制 API ----------

export function setMuted(next: boolean) {
  muted = next;
  persistMuted(next);
  applyMixGains();
}

export function isMuted(): boolean {
  return muted;
}

export function getMix(): MixSettings {
  return { ...mix };
}

export function setMix(patch: Partial<MixSettings>) {
  mix = {
    master: clamp01(patch.master ?? mix.master),
    music: clamp01(patch.music ?? mix.music),
    ambient: clamp01(patch.ambient ?? mix.ambient),
    sfx: clamp01(patch.sfx ?? mix.sfx),
    ui: clamp01(patch.ui ?? mix.ui),
  };
  persistMix(mix);
  applyMixGains();
  if (musicCurrent) applyMusicLevel();
}

/** 空间化总衰减：全球视角 −10 dB（见 features/audio/spatial.ts）。 */
export function setSpatialTrimDb(db: number) {
  spatialTrimDb = db;
  if (spatialGain) spatialGain.gain.value = dbToGain(spatialTrimDb);
}

/**
 * 用户手势内调用：创建（如需）并 resume AudioContext。
 * 之后所有 sfx.* 播放才生效；未调用前播放一律静默丢弃。
 */
export function unlockAudio() {
  const ctx = ensureContext();
  if (!ctx) {
    return;
  }
  unlocked = true;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
}

export function isUnlocked() {
  return unlocked;
}

// ---------- 合成原语（回退路径） ----------

/** 指数包络：attack 升到 peak → 保持到 duration-release → 释放到 ~0。 */
function applyEnvelope(
  param: AudioParam,
  startAt: number,
  peak: number,
  duration: number,
  attack?: number,
  release?: number,
) {
  const attackTime = Math.min(Math.max(attack ?? 0.005, 0.002), duration);
  const releaseTime = Math.min(Math.max(release ?? duration, 0.01), duration);
  const peakGain = Math.max(peak, MIN_GAIN);
  param.setValueAtTime(MIN_GAIN, startAt);
  param.exponentialRampToValueAtTime(peakGain, startAt + attackTime);
  param.setValueAtTime(peakGain, startAt + Math.max(attackTime, duration - releaseTime));
  param.exponentialRampToValueAtTime(MIN_GAIN, startAt + duration);
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] = Math.random() * 2 - 1;
    }
    noiseBuffer = buffer;
  }
  return noiseBuffer;
}

function scheduleTone(ctx: AudioContext, spec: ToneSpec, destination: AudioNode) {
  const startAt = ctx.currentTime + (spec.delay ?? 0);
  const oscillator = ctx.createOscillator();
  oscillator.type = spec.type;
  oscillator.frequency.setValueAtTime(Math.max(1, spec.freq), startAt);
  if (spec.freqEnd !== undefined) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, spec.freqEnd), startAt + spec.duration);
  }
  if (spec.detune) {
    oscillator.detune.setValueAtTime(spec.detune, startAt);
  }
  const gain = ctx.createGain();
  applyEnvelope(gain.gain, startAt, spec.gain, spec.duration, spec.attack, spec.release);
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + spec.duration + 0.05);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}

function scheduleNoiseBurst(ctx: AudioContext, spec: NoiseSpec, destination: AudioNode) {
  const startAt = ctx.currentTime + (spec.delay ?? 0);
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx);
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = spec.filterType ?? 'lowpass';
  filter.frequency.setValueAtTime(Math.max(10, spec.filterFreq), startAt);
  if (spec.filterEnd !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(10, spec.filterEnd), startAt + spec.duration);
  }
  const gain = ctx.createGain();
  applyEnvelope(gain.gain, startAt, spec.gain, spec.duration, spec.attack, spec.release);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(startAt);
  source.stop(startAt + spec.duration + 0.05);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}

// ---------- 采样加载 ----------

/** 已加载的采样数 / 已发起加载数（调试与测试用）。 */
let samplesLoaded = 0;
let samplesRequested = 0;

/**
 * 取一条采样的 AudioBuffer；未加载时发起加载并返回 null（调用方回退合成音）。
 * 加载失败只记一次警告、之后不再重试，避免弱网下每次播放都打一发请求。
 */
function getSample(ctx: AudioContext, path: string): AudioBuffer | null {
  const cached = sampleCache.get(path);
  if (cached) return cached;
  if (samplesLoading.has(path) || samplesFailed.has(path)) return null;
  samplesLoading.add(path);
  samplesRequested += 1;
  void (async () => {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      // 显式 copy：部分浏览器下 fetch 的 ArrayBuffer 是 detachable，decodeAudioData 会
      // 把它转移走，后续同 buffer 复用会报「已 detach」——这里给解码器一份独立副本。
      sampleCache.set(path, await ctx.decodeAudioData(bytes.slice(0)));
      samplesLoaded += 1;
    } catch (error) {
      samplesFailed.add(path);
      console.warn(`[audio] 采样加载失败，回退合成音：${path}`, error);
    } finally {
      samplesLoading.delete(path);
    }
  })();
  return null;
}

/** 预加载若干采样（页面切换时调，避免首次播放回退）。 */
export function preloadSamples(paths: readonly string[]) {
  const ctx = ensureContext();
  if (!ctx) return;
  for (const path of paths) getSample(ctx, path);
}

/**
 * 调试探针（E2E/真机排查用）：`window.__swAudio` 暴露解锁/采样/循环/空间状态。
 * 只读；生产构建也在（几十字节，试玩驱动依赖它核对「音频真的在跑」）。
 */
function publishProbe() {
  if (typeof window === 'undefined') return;
  (window as unknown as { __swAudio?: unknown }).__swAudio = {
    get unlocked() { return unlocked; },
    get muted() { return muted; },
    get contextState() { return context?.state ?? null; },
    get mix() { return { ...mix }; },
    get samples() { return { loaded: samplesLoaded, requested: samplesRequested }; },
    get ambient() { return ambientCurrent.map((voice) => voice.name); },
    get music() { return musicCurrent?.name ?? null; },
    /** 想要（等待采样）的声床/配乐（加载完成前 ambient/music 仍是空的）。 */
    get wantedAmbient() { return ambientWanted.map((layer) => layer.name); },
    /** 各声床层的实际电平（验收：贴地 + 40 台运行建筑时风与机械都 > 0）。 */
    get ambientLevels() { return getAmbientLevels(); },
    /** 场景 hook 调过几次 apply（排查「hook 没跑」与「采样没就绪」）。 */
    get sceneTicks() { return sceneTicks; },
    get wantedMusic() { return musicWanted?.name ?? null; },
    get spatialTrimDb() { return spatialTrimDb; },
    /** 已缓存的采样路径（验收：页面切过去后应当有 sfx/ui/ambient/music）。 */
    get cachedSamples() { return [...sampleCache.keys()].map((path) => path.replace(/^\/assets\/audio\//, '')); },
    get diag() { return { ...diag }; },
  };
}

publishProbe();

/** 测试用：清空采样缓存与统计。 */
export function resetSampleCacheForTests() {
  sampleCache.clear();
  samplesLoading.clear();
  samplesFailed.clear();
  samplesLoaded = 0;
  samplesRequested = 0;
}

function manifestPaths(bus: 'sfx' | 'ui', key: string): readonly string[] {
  const group = bus === 'sfx' ? AUDIO_MANIFEST.sfx : AUDIO_MANIFEST.ui;
  return (group as Record<string, readonly string[]>)[key] ?? [];
}

// ---------- 播放入口 ----------

export interface PlayOptions {
  /**
   * 空间参数（由 features/audio/spatial.ts 算好）——仅 sfx 用；缺省为非空间音。
   * `audible: false` = 超过 60 格，引擎直接丢弃（不占限流窗口以外的资源）。
   * 没有 tile（实体反查不到、按画面外处理）时只套用 volumeDb / pan。
   */
  spatial?: {
    audible?: boolean;
    tile?: { x: number; y: number };
    volumeDb: number;
    pan: number;
    distance?: number;
  } | null;
  /** 覆盖总线（默认按 SAMPLE_KEY）。 */
  bus?: 'sfx' | 'ui';
}

/** 走 spatial 子总线（受全球视角 −10 dB）的战斗音效。 */
const COMBAT_SOUNDS: ReadonlySet<SoundName> = new Set<SoundName>([
  'fire', 'fireGauss', 'fireLaser', 'fireMissile', 'firePlasma', 'fireGeneric',
  'explosion', 'explosionNear', 'explosionFar', 'intercept', 'hit',
]);

/** 爆炸近/远分档的距离阈值（格，距画面中心）。 */
export const EXPLOSION_NEAR_TILES = 12;

/** 随机扰动幅度（契约：音高 ±4%，音量 ±2 dB）。 */
const PITCH_JITTER = 0.04;
const VOLUME_JITTER_DB = 2;

function playSample(
  ctx: AudioContext,
  path: string,
  buffer: AudioBuffer,
  destination: AudioNode,
  random: () => number,
  volumeDb: number,
  pan: number,
) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = 1 + (random() - 0.5) * 2 * PITCH_JITTER;
  const gain = ctx.createGain();
  gain.gain.value = dbToGain(volumeDb + (random() - 0.5) * 2 * VOLUME_JITTER_DB);
  source.connect(gain);
  let panner: StereoPannerNode | null = null;
  if (typeof ctx.createStereoPanner === 'function') {
    panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    gain.connect(panner);
    panner.connect(destination);
  } else {
    gain.connect(destination);
  }
  source.start();
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
    panner?.disconnect();
  };
}

function play(name: SoundName, options?: { big?: boolean; spatial?: PlayOptions['spatial'] }) {
  // 诊断计数（window.__swAudio.diag）：排查「点了没声」是没解锁 / 静音 / 限流还是采样没就绪。
  diag.playCalls += 1;
  if (!isAudioSupported()) { diag.skippedUnsupported += 1; return; }
  if (muted) { diag.skippedMuted += 1; return; }
  if (!unlocked) { diag.skippedLocked += 1; return; }
  if (!limiter.allow(name, now())) {
    diag.skippedLimited += 1;
    return;
  }
  const ctx = ensureContext();
  if (!ctx || !busGains) {
    return;
  }
  if (ctx.state === 'suspended') {
    // 非手势上下文 resume 可能被拒；本次播放丢弃，下个手势可恢复
    diag.skippedSuspended += 1;
    void ctx.resume().catch(() => {});
    return;
  }
  const target = SAMPLE_KEY[name];
  const spatial = options?.spatial ?? null;
  // 全球视角的 −10 dB 只作用于**战斗音**（引擎内的 combat 音效）：这些走 spatial 子总线；
  // 建造 chime / 指令音 / 通知等直接走 sfx 总线，不被压低。
  const destination = target.bus === 'ui'
    ? busGains.ui
    : COMBAT_SOUNDS.has(name)
      ? spatialGain ?? busGains.sfx
      : busGains.sfx;
  // 超过 60 格：spatial.ts 给 audible=false，这里直接丢弃（不是「压低到听不见」）。
  if (spatial && target.bus === 'sfx' && spatial.audible === false) {
    diag.skippedInaudible += 1;
    return;
  }
  const paths = manifestPaths(target.bus, target.key);
  if (paths.length > 0) {
    const path = paths[Math.floor(Math.random() * paths.length)] ?? paths[0];
    const buffer = getSample(ctx, path);
    if (buffer) {
      diag.samplePlays += 1;
      playSample(ctx, path, buffer, destination, Math.random, spatial?.volumeDb ?? 0, spatial?.pan ?? 0);
      return;
    }
    diag.sampleMisses += 1;
  }
  // 采样未就绪：合成回退（保持旧测试语义）。
  buildSoundSpecs(name, options).forEach((spec) => {
    if (spec.kind === 'tone') {
      scheduleTone(ctx, spec, destination);
    } else {
      scheduleNoiseBurst(ctx, spec, destination);
    }
  });
}

/** 语义化音效 API：每个都是调好参数的短函数。 */
export const sfx = {
  /** 通用开火（旧名；具体炮塔用 fireGauss/fireLaser/fireMissile/firePlasma）。 */
  fire(spatial?: PlayOptions['spatial']) {
    play('fire', { spatial });
  },
  fireGauss(spatial?: PlayOptions['spatial']) {
    play('fireGauss', { spatial });
  },
  fireLaser(spatial?: PlayOptions['spatial']) {
    play('fireLaser', { spatial });
  },
  fireMissile(spatial?: PlayOptions['spatial']) {
    play('fireMissile', { spatial });
  },
  firePlasma(spatial?: PlayOptions['spatial']) {
    play('firePlasma', { spatial });
  },
  fireGeneric(spatial?: PlayOptions['spatial']) {
    play('fireGeneric', { spatial });
  },
  /** 爆炸；big = 击毁级大爆炸。 */
  explosion(big = false, spatial?: PlayOptions['spatial']) {
    play('explosion', { big, spatial });
  },
  /** 近距爆炸。 */
  explosionNear(spatial?: PlayOptions['spatial']) {
    play('explosionNear', { spatial });
  },
  /** 远距爆炸（低频闷响）。 */
  explosionFar(spatial?: PlayOptions['spatial']) {
    play('explosionFar', { spatial });
  },
  /** 按距画面中心格距分档的爆炸：≤ 12 格近、更远用闷响远档；big 只影响合成回退。 */
  explosionAt(distance: number, spatial?: PlayOptions['spatial'], big = false) {
    play(distance <= EXPLOSION_NEAR_TILES ? 'explosionNear' : 'explosionFar', { big, spatial });
  },
  /** 点防拦截：高频咔哒。 */
  intercept(spatial?: PlayOptions['spatial']) {
    play('intercept', { spatial });
  },
  /** 命中：短促金属声。 */
  hit(spatial?: PlayOptions['spatial']) {
    play('hit', { spatial });
  },
  /** 指令成功：双音上行。 */
  commandOk() {
    play('commandOk');
  },
  /** 指令失败：低音方波下行。 */
  commandFail() {
    play('commandFail');
  },
  /** 建造完成：三音和弦 chime（旧名，等同 constructionComplete）。 */
  buildComplete() {
    play('buildComplete');
  },
  /** 施工完成（落成）。 */
  constructionComplete() {
    play('constructionComplete');
  },
  /** 研究完成：上行琶音。 */
  researchComplete() {
    play('researchComplete');
  },
  /** 告警：双脉冲警示音。 */
  alert() {
    play('alert');
  },
  /** 通知提示。 */
  notify() {
    play('notify');
  },
  /** 建造放置（ghost 确认）。 */
  buildPlace() {
    play('buildPlace');
  },
  /** 拆除。 */
  demolish() {
    play('demolish');
  },
  /** 传送带放置。 */
  beltPlace() {
    play('beltPlace');
  },
  /** 单位选中。 */
  unitSelect() {
    play('unitSelect');
  },
  /** 单位应答。 */
  unitAck() {
    play('unitAck');
  },
  /** 移动指令。 */
  orderMove() {
    play('orderMove');
  },
  /** 攻击指令。 */
  orderAttack() {
    play('orderAttack');
  },
  /** UI 点按：极短 tick。 */
  uiClick() {
    play('uiClick');
  },
  /** UI 悬停。 */
  uiHover() {
    // 悬停是高频事件：限流窗口更宽（同 50ms 3 次对扫过按钮列太密）。
    if (!limiter.allow('uiHover-slow', now(), 120, 1)) return;
    play('uiHover');
  },
  /** 打开面板。 */
  uiPanelOpen() {
    play('uiPanelOpen');
  },
  /** 关闭面板。 */
  uiPanelClose() {
    play('uiPanelClose');
  },
} as const;

/** 编译期契约：每个 SoundName 都必须有对应的 sfx 方法（notifications 等按名字索引）。 */
const SOUND_API_COVERAGE: Record<SoundName, unknown> = sfx;
void SOUND_API_COVERAGE;

// ---------- 循环声床与配乐 ----------

export type AmbientName = 'wind' | 'factory' | 'space';
export type MusicName = 'calm' | 'tense' | 'combat';

interface LoopVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/** 正在播放的一路声床（风 / 基地嗡鸣 / 轨道低频各占一路，挂同一个 ambient 总线）。 */
interface AmbientVoice {
  name: AmbientName;
  voice: LoopVoice;
  level: number;
}

/** 想要的声床层（采样未就绪时只记下，tickAudioLoops 补起）。 */
export interface AmbientLayerWanted {
  name: AmbientName;
  level: number;
}

let ambientCurrent: AmbientVoice[] = [];
let musicCurrent: { name: MusicName; voice: LoopVoice; level: number } | null = null;
/** 目标声床层 / 配乐（即使采样未就绪也记下，加载完由 tickAudioLoops 起播）。 */
let ambientWanted: AmbientLayerWanted[] = [];
let musicWanted: { name: MusicName; level: number } | null = null;
let musicTargetLevel = 1;
/** 页面切换交叉淡化（1.5s）/ 配乐状态切换（3s）。 */
export const AMBIENT_CROSSFADE_SECONDS = 1.5;
export const MUSIC_CROSSFADE_SECONDS = 3;

function loopPath(bus: 'ambient' | 'music', name: string) {
  const group = bus === 'ambient' ? AUDIO_MANIFEST.ambient : AUDIO_MANIFEST.music;
  return (group as Record<string, readonly string[]>)[name]?.[0] ?? null;
}

function startLoop(ctx: AudioContext, bus: 'ambient' | 'music', name: string, level: number): LoopVoice | null {
  const path = loopPath(bus, name);
  if (!path) return null;
  const buffer = getSample(ctx, path);
  if (!buffer) return null; // 未就绪：等加载完下一次 setX 再起（调用方每 500ms 刷新一次状态）
  const destination = bus === 'ambient' ? busGains!.ambient : busGains!.music;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(destination);
  source.start();
  // 淡入（交叉淡化的一半；旧声床在 fadeOutLoop 里同时淡出）
  gain.gain.linearRampToValueAtTime(level, ctx.currentTime + (bus === 'ambient' ? AMBIENT_CROSSFADE_SECONDS : MUSIC_CROSSFADE_SECONDS));
  return { source, gain };
}

function fadeOutLoop(ctx: AudioContext, voice: LoopVoice, seconds: number) {
  voice.gain.gain.cancelScheduledValues(ctx.currentTime);
  voice.gain.gain.setValueAtTime(voice.gain.gain.value, ctx.currentTime);
  voice.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + seconds);
  voice.source.stop(ctx.currentTime + seconds + 0.05);
  // 循环节点停止后断开：每次切声床/配乐/页面都会换一对节点，不断开会一直挂在总线上。
  voice.source.onended = () => {
    voice.source.disconnect();
    voice.gain.disconnect();
  };
}

function applyMusicLevel() {
  const ctx = context;
  if (!ctx || !musicCurrent) return;
  musicCurrent.level = musicTargetLevel;
  musicCurrent.voice.gain.gain.setTargetAtTime(musicTargetLevel, ctx.currentTime, 0.2);
}

/**
 * 设置环境声床层（空数组 = 停止）。每层各占一路 BufferSource + GainNode，
 * 同时播放、各自增益（贴地时风与基地嗡鸣叠加）；消失的层 1.5s 淡出，新层 1.5s 淡入。
 */
export function setAmbientLayers(layers: readonly AmbientLayerWanted[]) {
  ambientWanted = layers.map((layer) => ({ name: layer.name, level: clamp01(layer.level) }));
  reconcileAmbient();
}

/**
 * 让实际声床跟上 ambientWanted：采样未就绪时先什么都不做，
 * 由 tickAudioLoops（调用方每 500ms 一次）在加载完后补起。
 */
function reconcileAmbient() {
  if (!isAudioSupported() || !unlocked) return;
  const ctx = ensureContext();
  if (!ctx || !busGains) return;
  const wantedNames = new Set(ambientWanted.map((layer) => layer.name));
  ambientCurrent = ambientCurrent.filter((voice) => {
    if (wantedNames.has(voice.name)) return true;
    fadeOutLoop(ctx, voice.voice, AMBIENT_CROSSFADE_SECONDS);
    return false;
  });
  for (const layer of ambientWanted) {
    const existing = ambientCurrent.find((voice) => voice.name === layer.name);
    if (existing) {
      existing.level = layer.level;
      existing.voice.gain.gain.setTargetAtTime(layer.level, ctx.currentTime, 0.2);
      continue;
    }
    const voice = startLoop(ctx, 'ambient', layer.name, layer.level);
    if (voice) ambientCurrent.push({ name: layer.name, voice, level: layer.level });
  }
}

/** 设置配乐状态（null = 停止）；状态切换走 3s 交叉淡化。 */
export function setMusic(name: MusicName | null, level = 1) {
  musicTargetLevel = name ? clamp01(level) : 0;
  musicWanted = name ? { name, level: musicTargetLevel } : null;
  reconcileMusic();
}

function reconcileMusic() {
  if (!isAudioSupported() || !unlocked) return;
  const ctx = ensureContext();
  if (!ctx || !busGains) return;
  const wanted = musicWanted;
  if (musicCurrent?.name === (wanted?.name ?? null)) {
    applyMusicLevel();
    return;
  }
  if (musicCurrent) {
    fadeOutLoop(ctx, musicCurrent.voice, MUSIC_CROSSFADE_SECONDS);
    musicCurrent = null;
  }
  if (wanted) {
    // 配乐懒加载：进入该状态时才取（low 档不预载，见 features/audio/quality.ts）。
    const voice = startLoop(ctx, 'music', wanted.name, musicTargetLevel);
    if (voice) musicCurrent = { name: wanted.name, voice, level: musicTargetLevel };
  }
}

/**
 * 周期调用（与场景状态刷新同频）：采样加载完成后补起目标声床 / 配乐。
 * 未 unlock / 无 AudioContext 时是 no-op。
 */
export function tickAudioLoops() {
  if (!unlocked) return;
  reconcileAmbient();
  reconcileMusic();
}

export function getAmbientNames(): AmbientName[] {
  return ambientCurrent.map((voice) => voice.name);
}

/** 各声床层当前的目标电平（风 / 机械 / 轨道各一路，测试与探针用）。 */
export function getAmbientLevels(): Partial<Record<AmbientName, number>> {
  return Object.fromEntries(ambientCurrent.map((voice) => [voice.name, voice.level]));
}

export function getMusicName(): MusicName | null {
  return musicCurrent?.name ?? null;
}

/** 测试用：当前声床/配乐状态重置（模块级单例）。 */
export function resetLoopsForTests() {
  ambientCurrent = [];
  musicCurrent = null;
  ambientWanted = [];
  musicWanted = null;
  musicTargetLevel = 1;
  spatialTrimDb = 0;
}

// ---------- 自动播放策略：首次手势解锁 ----------

function handleFirstGesture() {
  unlockAudio();
  if (unlocked && typeof window !== 'undefined') {
    window.removeEventListener('pointerdown', handleFirstGesture, { capture: true });
    window.removeEventListener('keydown', handleFirstGesture, { capture: true });
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', handleFirstGesture, { capture: true });
  window.addEventListener('keydown', handleFirstGesture, { capture: true });
}
