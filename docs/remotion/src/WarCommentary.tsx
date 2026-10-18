import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {theme} from './theme';
import battleJson from './data/battle.json';
import commentaryJson from './data/commentary.json';

// ─────────────────────────────────────────────────────────────
// 类型与静态数据
// ─────────────────────────────────────────────────────────────
type RecUnit = {
  id: string;
  o: string;
  t: string;
  x: number;
  y: number;
  hp: number;
  mhp: number;
};
type RecBuilding = RecUnit & {s?: string};
type BattleFrame = {tick: number; units: RecUnit[]; buildings: RecBuilding[]};
type SeriesRow = {
  tick: number;
  [key: string]: number;
};
type TickerEvent = {tick: number; type: string; text: string};
type BattleData = {
  meta: {
    players: {player_id: string; team_id: string}[];
    planet_id: string;
    map: {width: number; height: number};
    viewport: {x: number; y: number; w: number; h: number};
    sample_interval: number;
  };
  frames: BattleFrame[];
  series: SeriesRow[];
  events: TickerEvent[];
  victory: {tick: number; winner_id?: string; reason?: string} | null;
};
type CommentarySegment = {
  tick: number;
  text: string;
  audio: string;
  duration_sec: number;
};

const battle = battleJson as unknown as BattleData;
const commentary = commentaryJson as unknown as CommentarySegment[];

const TICK_RATE = 10; // 服务端 tick/s
const FPS = 30;
// 视频时间压缩倍速：比赛真实时长 / 倍速 = 视频主段时长
const SPEED = 8;
const INTRO_FRAMES = FPS * 5;
const OUTRO_FRAMES = FPS * 7;

const lastTick = battle.frames.length
  ? battle.frames[battle.frames.length - 1].tick
  : 0;
const matchSeconds = lastTick / TICK_RATE;
const MAIN_FRAMES = Math.max(1, Math.round((matchSeconds / SPEED) * FPS));
export const warCommentaryDurationInFrames =
  INTRO_FRAMES + MAIN_FRAMES + OUTRO_FRAMES;

// frame(主段内) → tick
const frameToTick = (mainFrame: number) =>
  Math.round((mainFrame / MAIN_FRAMES) * lastTick);

// tick → 最近的状态采样帧下标（采样间隔固定）
const tickToFrameIdx = (tick: number) => {
  const interval = battle.meta.sample_interval || 10;
  let lo = 0;
  let hi = battle.frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (battle.frames[mid].tick < tick) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && battle.frames[lo].tick > tick) lo -= 1;
  return lo;
};

// 实体最后已知位置（用于死亡后仍然渲染击杀闪光）
const lastKnownPos = (() => {
  const m = new Map<string, {x: number; y: number}>();
  for (const fr of battle.frames) {
    for (const e of [...fr.units, ...fr.buildings]) {
      m.set(e.id, {x: e.x, y: e.y});
    }
  }
  return m;
})();

const PLAYER_COLORS: Record<string, string> = {};
{
  const palette = [theme.cyan, theme.coral, theme.mint, theme.gold];
  battle.meta.players.forEach((p, i) => {
    PLAYER_COLORS[p.player_id] = palette[i % palette.length];
  });
}

const UNIT_ZH: Record<string, string> = {
  soldier: '士兵',
  mecha: '机甲',
  executor: '执行体',
  worker: '工程机',
};

// ─────────────────────────────────────────────────────────────
// 战术地图
// ─────────────────────────────────────────────────────────────
const TacticalMap: React.FC<{tick: number; size: number}> = ({tick, size}) => {
  const vp = battle.meta.viewport;
  const scale = size / Math.max(vp.w, vp.h);
  const frame = battle.frames[tickToFrameIdx(tick)];

  const px = (x: number) => (x - vp.x) * scale;
  const py = (y: number) => (y - vp.y) * scale;

  // 当前 tick 附近的伤害事件 → 闪光
  const flashes = battle.events.filter(
    (e) => e.type === 'damage_applied' && Math.abs(e.tick - tick) <= 25,
  );

  return (
    <div
      style={{
        width: size,
        height: size,
        position: 'relative',
        background:
          'radial-gradient(circle at 50% 40%, rgba(23,48,82,0.55), rgba(5,12,24,0.95))',
        border: `1px solid ${theme.line}`,
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* 网格 */}
      {Array.from({length: Math.ceil(vp.w / 4) + 1}).map((_, i) => (
        <div
          key={`v${i}`}
          style={{
            position: 'absolute',
            left: i * 4 * scale,
            top: 0,
            bottom: 0,
            width: 1,
            background: 'rgba(134,201,255,0.06)',
          }}
        />
      ))}
      {Array.from({length: Math.ceil(vp.h / 4) + 1}).map((_, i) => (
        <div
          key={`h${i}`}
          style={{
            position: 'absolute',
            top: i * 4 * scale,
            left: 0,
            right: 0,
            height: 1,
            background: 'rgba(134,201,255,0.06)',
          }}
        />
      ))}

      {/* 建筑 */}
      {frame.buildings.map((b) => {
        const isBase = b.t === 'battlefield_analysis_base';
        const s = isBase ? 18 : 9;
        return (
          <div
            key={b.id}
            style={{
              position: 'absolute',
              left: px(b.x) - s / 2,
              top: py(b.y) - s / 2,
              width: s,
              height: s,
              background: PLAYER_COLORS[b.o] ?? theme.muted,
              opacity: isBase ? 1 : 0.75,
              borderRadius: isBase ? 3 : 2,
              boxShadow: isBase
                ? `0 0 12px ${PLAYER_COLORS[b.o] ?? theme.muted}`
                : 'none',
            }}
          />
        );
      })}

      {/* 单位 */}
      {frame.units.map((u) => {
        const isExec = u.t === 'executor';
        const s = isExec ? 9 : 6;
        return (
          <div
            key={u.id}
            style={{
              position: 'absolute',
              left: px(u.x) - s / 2,
              top: py(u.y) - s / 2,
              width: s,
              height: s,
              background: PLAYER_COLORS[u.o] ?? theme.muted,
              borderRadius: isExec ? 2 : '50%',
              transform: isExec ? 'rotate(45deg)' : undefined,
              boxShadow: `0 0 6px ${PLAYER_COLORS[u.o] ?? theme.muted}`,
            }}
          />
        );
      })}

      {/* 伤害闪光 */}
      {flashes.map((e, i) => {
        const tgt = (e as any).payload?.target_id as string | undefined;
        const pos = tgt ? lastKnownPos.get(tgt) : undefined;
        if (!pos) return null;
        const age = Math.abs(e.tick - tick) / 25;
        const r = 26 - age * 18;
        return (
          <div
            key={`${e.tick}-${i}`}
            style={{
              position: 'absolute',
              left: px(pos.x) - r / 2,
              top: py(pos.y) - r / 2,
              width: r,
              height: r,
              borderRadius: '50%',
              border: `2px solid rgba(255,140,106,${0.85 - age * 0.7})`,
              boxShadow: `0 0 ${r}px rgba(255,140,106,0.5)`,
            }}
          />
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// 数据面板：基地 HP 条 + 兵力数字 + 兵力曲线
// ─────────────────────────────────────────────────────────────
const StatsPanel: React.FC<{tick: number; width: number}> = ({tick, width}) => {
  const players = battle.meta.players.map((p) => p.player_id);
  const idx = tickToFrameIdx(tick);
  const row = battle.series[idx] ?? battle.series[battle.series.length - 1];

  const sparkW = width - 48;
  const sparkH = 150;
  const seriesUpTo = battle.series.slice(0, idx + 1);
  const maxArmy = Math.max(
    4,
    ...battle.series.map((r) =>
      Math.max(...players.map((p) => r[`${p}_army`] ?? 0)),
    ),
  );
  const xOf = (i: number) =>
    (i / Math.max(1, battle.series.length - 1)) * sparkW;
  const yOf = (v: number) => sparkH - (v / maxArmy) * (sparkH - 12);

  return (
    <div style={{width, color: theme.text, fontFamily: theme.sans}}>
      {players.map((pid) => {
        const hp = row[`${pid}_base_hp`] ?? 0;
        const hpPct = Math.max(0, hp / 700);
        return (
          <div key={pid} style={{marginBottom: 18}}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 20,
                marginBottom: 6,
              }}
            >
              <span style={{color: PLAYER_COLORS[pid], fontWeight: 700}}>
                {pid} 基地
              </span>
              <span style={{color: theme.muted}}>{Math.max(0, hp)} / 700</span>
            </div>
            <div
              style={{
                height: 16,
                borderRadius: 8,
                background: 'rgba(255,255,255,0.08)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${hpPct * 100}%`,
                  height: '100%',
                  background: `linear-gradient(90deg, ${PLAYER_COLORS[pid]}, ${PLAYER_COLORS[pid]}cc)`,
                  transition: 'width 0.2s',
                }}
              />
            </div>
          </div>
        );
      })}

      {/* 兵力大数字 */}
      <div style={{display: 'flex', gap: 16, margin: '22px 0'}}>
        {players.map((pid) => (
          <div
            key={pid}
            style={{
              flex: 1,
              background: theme.surface,
              border: `1px solid ${theme.line}`,
              borderRadius: 10,
              padding: '12px 16px',
            }}
          >
            <div style={{fontSize: 14, color: theme.muted}}>{pid} 兵力</div>
            <div
              style={{
                fontSize: 40,
                fontWeight: 800,
                color: PLAYER_COLORS[pid],
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {row[`${pid}_army`] ?? 0}
            </div>
            <div style={{fontSize: 13, color: theme.muted}}>
              总 HP {row[`${pid}_army_hp`] ?? 0} · 建筑{' '}
              {row[`${pid}_buildings`] ?? 0}
            </div>
          </div>
        ))}
      </div>

      {/* 兵力曲线 */}
      <div
        style={{
          background: theme.surface,
          border: `1px solid ${theme.line}`,
          borderRadius: 10,
          padding: 16,
        }}
      >
        <div style={{fontSize: 14, color: theme.muted, marginBottom: 8}}>
          兵力曲线
        </div>
        <svg width={sparkW} height={sparkH}>
          {players.map((pid) => (
            <polyline
              key={pid}
              fill="none"
              stroke={PLAYER_COLORS[pid]}
              strokeWidth={2.5}
              points={seriesUpTo
                .map((r, i) => `${xOf(i)},${yOf(r[`${pid}_army`] ?? 0)}`)
                .join(' ')}
            />
          ))}
          {/* 全程参考线（淡） */}
          {players.map((pid) => (
            <polyline
              key={`${pid}-ghost`}
              fill="none"
              stroke={PLAYER_COLORS[pid]}
              strokeOpacity={0.15}
              strokeWidth={1.5}
              points={battle.series
                .map((r, i) => `${xOf(i)},${yOf(r[`${pid}_army`] ?? 0)}`)
                .join(' ')}
            />
          ))}
        </svg>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// 底部：事件条 + 解说字幕
// ─────────────────────────────────────────────────────────────
const BottomBar: React.FC<{tick: number}> = ({tick}) => {
  const recent = battle.events
    .filter((e) => e.tick <= tick)
    .slice(-4);
  const seg = commentary
    .filter((c) => c.tick <= tick)
    .slice(-1)[0];

  return (
    <div style={{width: '100%'}}>
      {seg && (
        <div
          style={{
            margin: '0 auto 14px',
            maxWidth: 1500,
            background: 'rgba(5,12,24,0.85)',
            border: `1px solid ${theme.line}`,
            borderRadius: 12,
            padding: '14px 28px',
            fontSize: 30,
            lineHeight: 1.45,
            color: theme.text,
            fontFamily: theme.sans,
            textAlign: 'center',
          }}
        >
          {seg.text}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          gap: 14,
          padding: '0 8px',
          fontFamily: theme.sans,
        }}
      >
        {recent.map((e, i) => (
          <div
            key={`${e.tick}-${i}`}
            style={{
              flex: i === recent.length - 1 ? 2 : 1,
              background:
                i === recent.length - 1
                  ? 'rgba(255,140,106,0.16)'
                  : theme.surface,
              border: `1px solid ${theme.line}`,
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 16,
              color: i === recent.length - 1 ? theme.text : theme.muted,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {e.text}
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// 主合成
// ─────────────────────────────────────────────────────────────
export const WarCommentaryVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const p1 = battle.meta.players[0]?.player_id ?? 'p1';
  const p2 = battle.meta.players[1]?.player_id ?? 'p2';

  return (
    <AbsoluteFill style={{background: theme.bg, fontFamily: theme.sans}}>
      {/* 片头 */}
      <Sequence durationInFrames={INTRO_FRAMES}>
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            color: theme.text,
          }}
        >
          <div style={{fontSize: 26, color: theme.muted, letterSpacing: 6}}>
            SILICONWORLD · AI 对抗赛
          </div>
          <div style={{fontSize: 84, fontWeight: 900, marginTop: 18}}>
            <span style={{color: PLAYER_COLORS[p1]}}>{p1}</span>
            <span style={{color: theme.muted, fontSize: 48}}> VS </span>
            <span style={{color: PLAYER_COLORS[p2]}}>{p2}</span>
          </div>
          <div style={{fontSize: 24, color: theme.muted, marginTop: 22}}>
            单行星 · 歼灭战 · 摧毁对方基地者胜
          </div>
        </AbsoluteFill>
      </Sequence>

      {/* 正片 */}
      <Sequence from={INTRO_FRAMES} durationInFrames={MAIN_FRAMES}>
        <AbsoluteFill style={{padding: 28}}>
          <MainScene />
        </AbsoluteFill>
      </Sequence>

      {/* 片尾 */}
      <Sequence
        from={INTRO_FRAMES + MAIN_FRAMES}
        durationInFrames={OUTRO_FRAMES}
      >
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            color: theme.text,
          }}
        >
          <div style={{fontSize: 30, color: theme.muted, letterSpacing: 4}}>
            比赛结果
          </div>
          <div
            style={{
              fontSize: 72,
              fontWeight: 900,
              marginTop: 16,
              color: battle.victory?.winner_id
                ? PLAYER_COLORS[battle.victory.winner_id]
                : theme.text,
            }}
          >
            {battle.victory?.winner_id
              ? `${battle.victory.winner_id} 获胜`
              : '平局 / 未分胜负'}
          </div>
          <div style={{fontSize: 22, color: theme.muted, marginTop: 18}}>
            {battle.victory
              ? `第 ${battle.victory.tick} tick · ${Math.round(
                  battle.victory.tick / TICK_RATE / 60,
                )} 分钟 · ${battle.victory.reason ?? ''}`
              : ''}
          </div>
        </AbsoluteFill>
      </Sequence>

      {/* 解说配音 */}
      {commentary.map((seg, i) => {
        const startFrame =
          INTRO_FRAMES +
          Math.min(
            MAIN_FRAMES - 1,
            Math.round((seg.tick / Math.max(1, lastTick)) * MAIN_FRAMES),
          );
        return (
          <Sequence
            key={i}
            from={startFrame}
            durationInFrames={Math.ceil(seg.duration_sec * FPS) + 6}
          >
            <Audio src={staticFile(seg.audio)} volume={1} />
          </Sequence>
        );
      })}

      {/* BGM */}
      <Audio src={staticFile('audio/bgm/ambient-bed.mp3')} volume={0.12} loop />
    </AbsoluteFill>
  );
};

const MainScene: React.FC = () => {
  const frame = useCurrentFrame();
  const tick = frameToTick(frame);
  const gameSec = tick / TICK_RATE;
  const mm = String(Math.floor(gameSec / 60)).padStart(2, '0');
  const ss = String(Math.floor(gameSec % 60)).padStart(2, '0');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        gap: 14,
      }}
    >
      {/* 顶栏 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          color: theme.muted,
          fontSize: 18,
          fontFamily: theme.sans,
        }}
      >
        <span>
          SiliconWorld AI 对抗赛 · {battle.meta.planet_id}
        </span>
        <span style={{fontVariantNumeric: 'tabular-nums'}}>
          比赛时间 {mm}:{ss} · tick {tick}
        </span>
      </div>

      {/* 中部：地图 + 数据 */}
      <div style={{display: 'flex', gap: 22, flex: 1, minHeight: 0}}>
        <TacticalMap tick={tick} size={860} />
        <StatsPanel tick={tick} width={940} />
      </div>

      <BottomBar tick={tick} />
    </div>
  );
};
