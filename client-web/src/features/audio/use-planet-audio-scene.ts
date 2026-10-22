/**
 * 行星页音频场景 hook（第 23 轮）：把「画面状态」接到声床与配乐。
 *
 * - 相机状态每 500ms 从 3D 场景快照拉一次（与场景已有的状态刷新同频），
 *   同时写进 spatial.ts 的监听器（空间化用）与 engine 的全球视角衰减（−10 dB）；
 * - 声床/配乐目标由纯函数 resolveAmbient / resolveMusic 算（见 ambient-music.ts），
 *   实际交叉淡化在 engine/audio.ts；采样未加载完时由 tickAudioLoops 补起；
 * - 战斗事件总线只用来记「最近一次己方参与的战斗时间」（配乐交战档）；
 *   己方参与判定见 battle-context.ts（按 attacker/target 实体归属反查）。
 *
 * 卸载时恢复配乐为 calm、清掉空间监听器与实体索引（离开行星页后声床由页面级 hook 接管）。
 */

import { useEffect, useRef } from 'react';

import type { PlanetRuntimeView } from '@shared/types';

import {
  noteSceneTick,
  preloadSamples,
  setAmbientLayers,
  setMusic,
  setSpatialTrimDb,
  tickAudioLoops,
} from '@/engine/audio';
import { AUDIO_MANIFEST } from '@/engine/audio-manifest';
import type { GameEventDetail } from '@shared/types';
import type { PlanetRenderView } from '@/features/planet-map/model';
import { subscribeBattleEvents } from '@/engine/battle-events';
import { resolveAmbient, resolveMusic } from '@/features/audio/ambient-music';
import { battleOwnInvolvement, buildBattleEntityIndex, getBattleEntityIndex, setBattleEntityIndex } from '@/features/audio/battle-context';
import { globalViewTrimDb, setAudioListener, type AudioListenerSnapshot } from '@/features/audio/spatial';
import { readAudioQuality, shouldPreloadMusic } from '@/features/audio/quality';

/** 相机快照轮询间隔（与场景状态刷新的 500ms 同频）。 */
export const AUDIO_CAMERA_POLL_MS = 500;

/** 音频只需要场景的三个只读能力（getCameraState / project），不依赖 Three 场景类型。 */
export interface AudioSceneHandle {
  getCameraState: () => {
    center: { x: number; y: number } | null;
    altitude: number;
    tilt: number;
    groundView: boolean;
  };
  project: (tile: { x: number; y: number }) => { x: number; y: number; visible: boolean } | null;
  /** 画布 CSS 尺寸（声相归一化口径与 project 一致）；缺省时退回 window 尺寸。 */
  getViewport?: () => { width: number; height: number } | null;
}

export interface PlanetAudioSceneInput {
  planet: PlanetRenderView | undefined;
  runtime: PlanetRuntimeView | undefined;
  /** 3D 场景句柄的 ref（未就绪时 current 为 null）：只用 getCameraState / project，不改场景逻辑。 */
  sceneRef: { current: AudioSceneHandle | null };
  playerId: string;
  /** 深链/截图冻结时不播（?freeze=1）。 */
  frozen?: boolean;
  /** 对局标识（started_at::map_seed）：换局时清「最近一次交战」，配乐不会带着上一局的交战档进新局。 */
  gameIdentity?: string;
}

/** 载入区域里运行中的己方建筑数（声床嗡鸣电平的输入）。 */
export function countRunningBuildings(planet: PlanetRenderView | undefined, playerId: string): number {
  if (!planet) return 0;
  let count = 0;
  for (const building of Object.values(planet.buildings ?? {})) {
    if (building.owner_id === playerId && building.hp > 0 && building.runtime?.state === 'running') count += 1;
  }
  return count;
}

export function usePlanetAudioScene({ planet, runtime, sceneRef, playerId, frozen = false, gameIdentity = '' }: PlanetAudioSceneInput): void {
  const lastCombatAt = useRef<number | null>(null);
  // 配乐状态只在实际变化时调 setMusic（setMix 等也会读它）；值本身仍是模块级状态。
  const musicRef = useRef<string | null>(null);
  const latest = useRef({ planet, runtime, playerId });
  latest.current = { planet, runtime, playerId };

  // 战斗事件：记最近一次「己方参与」的时间（受袭或己方开火都算）。
  // 行星战斗事件不带 owner 字段，按 attacker/target 实体归属从当前行星索引反查。
  useEffect(() => subscribeBattleEvents((event) => {
    if (battleOwnInvolvement(event, latest.current.playerId, getBattleEntityIndex())) {
      lastCombatAt.current = event.at;
    }
  }), []);

  // 换局：上一局的交战时间戳不能带进新局（否则新局开场就是 combat 档）。
  useEffect(() => {
    if (!gameIdentity) return;
    lastCombatAt.current = null;
  }, [gameIdentity]);

  // 实体索引：每来一帧行星窗口数据就整份换掉（AppShell 注入的 resolver 读它）。
  useEffect(() => {
    setBattleEntityIndex(buildBattleEntityIndex(planet));
    return () => setBattleEntityIndex(null);
  }, [planet]);

  useEffect(() => {
    if (frozen) {
      setAmbientLayers([]);
      setMusic(null);
      musicRef.current = null;
      return undefined;
    }
    const quality = readAudioQuality();
    // high / balanced 预载配乐；low 只在进入对应状态时懒加载（见 quality.ts）。
    if (shouldPreloadMusic(quality)) {
      preloadSamples(Object.values(AUDIO_MANIFEST.music).map((paths) => paths[0]));
    }
    const apply = () => {
      noteSceneTick();
      const { planet: currentPlanet, runtime: currentRuntime, playerId: own } = latest.current;
      const sceneHandle = sceneRef.current;
      const faceSize = currentPlanet?.surface?.face_size ?? 32;
      // 场景句柄由 PlanetPage 每 500ms 刷新；首帧可能还没就绪（capture 未上报），
      // 此时按「贴地、中心未知」给默认值——声床/配乐不依赖 3D 是否就绪，不能因为
      // 场景没起来就整个静音（真机排查：句柄为 null 时声床永远不起）。
      const state = sceneHandle?.getCameraState() ?? { center: null, altitude: 10, tilt: 0.65, groundView: true };
      if (sceneHandle) {
        // 声相归一化用画布 CSS 尺寸（与 scene.project 的坐标系一致），不是 window 尺寸。
        const viewport = sceneHandle.getViewport?.() ?? null;
        const snapshot: AudioListenerSnapshot = {
          center: state.center,
          altitude: state.altitude,
          globalView: state.altitude > 190,
          width: viewport?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 0),
          height: viewport?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 0),
          faceSize,
          project: (tile) => sceneHandle.project(tile),
        };
        setAudioListener(snapshot);
      }
      setSpatialTrimDb(globalViewTrimDb(state.altitude));
      const ambient = resolveAmbient({
        page: 'planet',
        altitude: state.altitude,
        runningBuildings: countRunningBuildings(currentPlanet, own),
      });
      setAmbientLayers(ambient.layers);
      const tick = currentRuntime?.tick ?? 0;
      const music = resolveMusic({
        // 黑雾敌对：dark_fog_provoked 给的 until_tick 还没过；威胁等级 ≥ 3 也算紧张。
        darkFogHostile: tenseUntilTick > tick,
        threatLevel: currentRuntime?.threat_level ?? 0,
        lastCombatAt: lastCombatAt.current,
        now: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      });
      if (musicRef.current !== music) {
        musicRef.current = music;
        setMusic(music);
      }
      // 采样加载完成后补起目标声床 / 配乐。
      tickAudioLoops();
    };
    apply();
    const timer = window.setInterval(apply, AUDIO_CAMERA_POLL_MS);
    return () => {
      window.clearInterval(timer);
      setAudioListener(null);
      setSpatialTrimDb(0);
      setAmbientLayers([]);
      setMusic(null);
      musicRef.current = null;
    };
  }, [frozen]);
}

/**
 * SSE 事件 → 配乐「紧张」信号：黑雾被激怒 / 敌军波次来袭。返回新的 lastCombatAt 或 null。
 * 纯函数（时间由调用方给），供 hook 与单测共用。
 */
export function tenseSignalFromEvent(
  event: GameEventDetail,
  current: { hostileUntilTick: number; nowTick: number } | null,
  nowTick: number,
): { hostileUntilTick: number } | null {
  if (event.event_type === 'dark_fog_provoked') {
    const until = event.payload?.until_tick;
    if (typeof until === 'number' && Number.isFinite(until)) {
      return { hostileUntilTick: until };
    }
  }
  if (event.event_type === 'enemy_wave_incoming') {
    // 波次来袭在直到「波次结束」都算紧张：给 600 tick 的保守窗口（服务端没有结束事件）。
    return { hostileUntilTick: Math.max(current?.hostileUntilTick ?? 0, nowTick + 600) };
  }
  return null;
}

/**
 * 模块级「紧张窗口」：SSE 回调（use-planet-realtime）写，音频场景 hook 读。
 * 换局必须由页面调 resetTenseWindow()——until_tick 是全局 tick，会跨局残留。
 */
let tenseUntilTick = 0;

export function noteTenseEvent(event: GameEventDetail, nowTick: number) {
  const next = tenseSignalFromEvent(event, { hostileUntilTick: tenseUntilTick, nowTick }, nowTick);
  if (next) tenseUntilTick = next.hostileUntilTick;
}

/** 换局时清空紧张窗口（上一局的 until_tick 不能残留到新局）。 */
export function resetTenseWindow() {
  tenseUntilTick = 0;
}

/** 测试用：清空紧张窗口。 */
export function resetTenseWindowForTests() {
  resetTenseWindow();
}
