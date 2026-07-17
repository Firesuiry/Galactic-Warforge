/**
 * WebAudio 程序化音效引擎：零音频资源文件，全部用振荡器 + 白噪声实时合成。
 *
 * 设计约束：
 * - 惰性创建 AudioContext，遵循浏览器自动播放策略：首次用户手势
 *   （pointerdown/keydown，捕获阶段）后 unlock；unlock 之前所有播放调用静默丢弃。
 * - 主 GainNode → destination；静音状态持久化到 localStorage（sw.audio.muted）。
 * - 合成原语只有两个：tone（振荡器 + 指数包络）与 noiseBurst（预生成 1s 白噪声
 *   buffer 循环 + BiquadFilter 扫频）；对外语义 API 全部映射为纯数据 SoundSpec，
 *   由 buildSoundSpecs 纯函数生成，便于测试断言。
 * - 并发保护：同类音效 50ms 窗口内最多播 3 次（SSE 批量战斗事件同帧到达时
 *   不炸耳朵）；战斗音效带 ±30 音分随机 detune，避免机关枪感。
 * - 无 AudioContext 的环境（jsdom、旧浏览器）整体降级为 no-op：所有 API 可调用、
 *   不抛错、不创建任何节点。
 */

// ---------- 音效规格（纯数据） ----------

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

export type SoundName =
  | 'fire'
  | 'explosion'
  | 'intercept'
  | 'commandOk'
  | 'commandFail'
  | 'buildComplete'
  | 'researchComplete'
  | 'alert'
  | 'uiClick';

export interface BuildSoundOptions {
  /** explosion 专用：大爆炸（击毁）更久更沉。 */
  big?: boolean;
  /** 注入随机源便于测试（默认 Math.random）。 */
  random?: () => number;
}

/** 战斗音效的随机 detune 幅度（±30 音分）。 */
const COMBAT_DETUNE_CENTS = 30;

/**
 * 语义音效 → 合成参数映射（纯函数）。音量克制：单音 peak 均 ≤ 0.22；
 * 除大爆炸（0.8s）外所有音效总时长 < 1s。
 */
export function buildSoundSpecs(name: SoundName, options: BuildSoundOptions = {}): SoundSpec[] {
  const random = options.random ?? Math.random;
  const combatDetune = () => Math.round((random() - 0.5) * 2 * COMBAT_DETUNE_CENTS);

  switch (name) {
    // 导弹/火箭发射：短促下滑音
    case 'fire':
      return [
        { kind: 'tone', type: 'sawtooth', freq: 720, freqEnd: 160, duration: 0.15, gain: 0.16, detune: combatDetune() },
      ];
    // 爆炸：噪声低通扫频；big 追加一记低频下潜
    case 'explosion': {
      const big = options.big === true;
      const specs: SoundSpec[] = [
        {
          kind: 'noise',
          duration: big ? 0.8 : 0.4,
          filterFreq: big ? 4200 : 2600,
          filterEnd: big ? 120 : 240,
          filterType: 'lowpass',
          gain: big ? 0.2 : 0.18,
        },
      ];
      if (big) {
        specs.push({ kind: 'tone', type: 'sine', freq: 110, freqEnd: 38, duration: 0.6, gain: 0.18 });
      }
      return specs;
    }
    // 点防拦截：高频咔哒
    case 'intercept':
      return [
        { kind: 'tone', type: 'square', freq: 2400, freqEnd: 1700, duration: 0.08, gain: 0.1, detune: combatDetune() },
      ];
    // 指令成功：双音上行
    case 'commandOk':
      return [
        { kind: 'tone', type: 'sine', freq: 660, duration: 0.07, gain: 0.14 },
        { kind: 'tone', type: 'sine', freq: 880, duration: 0.1, gain: 0.14, delay: 0.07 },
      ];
    // 指令失败：低音方波下行
    case 'commandFail':
      return [
        { kind: 'tone', type: 'square', freq: 200, freqEnd: 95, duration: 0.24, gain: 0.14 },
      ];
    // 建造完成：三音和弦 chime（C5/E5/G5 齐响）
    case 'buildComplete':
      return [523.25, 659.25, 783.99].map((freq): ToneSpec => ({
        kind: 'tone', type: 'sine', freq, duration: 0.35, gain: 0.07,
      }));
    // 研究完成：上行琶音
    case 'researchComplete':
      return [523.25, 659.25, 783.99, 1046.5].map((freq, index): ToneSpec => ({
        kind: 'tone', type: 'triangle', freq, duration: 0.1, gain: 0.12, delay: index * 0.08,
      }));
    // 告警：双脉冲警示音
    case 'alert':
      return [0, 0.16].map((delay): ToneSpec => ({
        kind: 'tone', type: 'square', freq: 740, duration: 0.09, gain: 0.13, delay,
      }));
    // UI 点按：极短 tick
    case 'uiClick':
      return [
        { kind: 'tone', type: 'square', freq: 1250, duration: 0.03, gain: 0.07 },
      ];
  }
}

// ---------- 限流（纯逻辑，便于测试） ----------

export interface SoundRateLimiter {
  /** nowMs 时刻 key 类音效是否允许播放（窗口内计数 +1）。 */
  allow(key: string, nowMs: number): boolean;
}

/** 同类音效 windowMs 毫秒内最多播 maxPlays 次，超出的直接丢弃。 */
export function createRateLimiter(windowMs = 50, maxPlays = 3): SoundRateLimiter {
  const buckets = new Map<string, { windowStart: number; count: number }>();
  return {
    allow(key, nowMs) {
      const bucket = buckets.get(key);
      if (!bucket || nowMs - bucket.windowStart >= windowMs) {
        buckets.set(key, { windowStart: nowMs, count: 1 });
        return true;
      }
      if (bucket.count >= maxPlays) {
        return false;
      }
      bucket.count += 1;
      return true;
    },
  };
}

// ---------- 引擎状态 ----------

const MUTED_STORAGE_KEY = 'sw.audio.muted';
const MIN_GAIN = 0.0001;

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

let context: AudioContext | null = null;
let masterGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let unlocked = false;
let muted = readPersistedMuted();
let volume = 1;
const limiter = createRateLimiter();

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
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
  masterGain.gain.value = muted ? 0 : volume;
  masterGain.connect(context.destination);
  return context;
}

function applyMasterGain() {
  if (masterGain) {
    masterGain.gain.value = muted ? 0 : volume;
  }
}

// ---------- 对外控制 API ----------

export function setMuted(next: boolean) {
  muted = next;
  persistMuted(next);
  applyMasterGain();
}

export function isMuted(): boolean {
  return muted;
}

export function setVolume(next: number) {
  volume = Math.min(1, Math.max(0, next));
  applyMasterGain();
}

export function getVolume(): number {
  return volume;
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

// ---------- 合成原语 ----------

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

function scheduleTone(ctx: AudioContext, spec: ToneSpec) {
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
  gain.connect(masterGain!);
  oscillator.start(startAt);
  oscillator.stop(startAt + spec.duration + 0.05);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}

function scheduleNoiseBurst(ctx: AudioContext, spec: NoiseSpec) {
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
  gain.connect(masterGain!);
  source.start(startAt);
  source.stop(startAt + spec.duration + 0.05);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}

// ---------- 播放入口 ----------

function play(name: SoundName, options?: { big?: boolean }) {
  if (!isAudioSupported() || muted || !unlocked) {
    return;
  }
  if (!limiter.allow(name, now())) {
    return;
  }
  const ctx = ensureContext();
  if (!ctx) {
    return;
  }
  if (ctx.state === 'suspended') {
    // 非手势上下文 resume 可能被拒；本次播放丢弃，下个手势可恢复
    void ctx.resume().catch(() => {});
    return;
  }
  buildSoundSpecs(name, options).forEach((spec) => {
    if (spec.kind === 'tone') {
      scheduleTone(ctx, spec);
    } else {
      scheduleNoiseBurst(ctx, spec);
    }
  });
}

/** 语义化音效 API：每个都是调好参数的短函数。 */
export const sfx = {
  /** 导弹/火箭发射：短促下滑音。 */
  fire() {
    play('fire');
  },
  /** 爆炸；big = 击毁级大爆炸。 */
  explosion(big = false) {
    play('explosion', { big });
  },
  /** 点防拦截：高频咔哒。 */
  intercept() {
    play('intercept');
  },
  /** 指令成功：双音上行。 */
  commandOk() {
    play('commandOk');
  },
  /** 指令失败：低音方波下行。 */
  commandFail() {
    play('commandFail');
  },
  /** 建造完成：三音和弦 chime。 */
  buildComplete() {
    play('buildComplete');
  },
  /** 研究完成：上行琶音。 */
  researchComplete() {
    play('researchComplete');
  },
  /** 告警：双脉冲警示音。 */
  alert() {
    play('alert');
  },
  /** UI 点按：极短 tick。 */
  uiClick() {
    play('uiClick');
  },
} as const;

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
