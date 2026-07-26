import React, {CSSProperties} from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {theme} from './theme';

// ─────────────────────────────────────────────────────────────
// 时间轴采样数据（来自 public/timeline.json，内联以避免 public/ 导入）
// ─────────────────────────────────────────────────────────────
type TimelineSample = {
  tick: number;
  p1_soldiers: number;
  p2_soldiers: number;
  b1_hp: number;
  b3_hp: number;
};

const startTick = 18670;
const endTick = 19944;
const tickSpan = endTick - startTick;

const samples: TimelineSample[] = [
  {tick: 18670, p1_soldiers: 0, p2_soldiers: 0, b1_hp: 700, b3_hp: 700},
  {tick: 18697, p1_soldiers: 0, p2_soldiers: 0, b1_hp: 700, b3_hp: 700},
  {tick: 18724, p1_soldiers: 2, p2_soldiers: 2, b1_hp: 700, b3_hp: 700},
  {tick: 18752, p1_soldiers: 4, p2_soldiers: 4, b1_hp: 700, b3_hp: 700},
  {tick: 18779, p1_soldiers: 6, p2_soldiers: 6, b1_hp: 700, b3_hp: 700},
  {tick: 18807, p1_soldiers: 8, p2_soldiers: 8, b1_hp: 700, b3_hp: 700},
  {tick: 18835, p1_soldiers: 10, p2_soldiers: 10, b1_hp: 700, b3_hp: 700},
  {tick: 18860, p1_soldiers: 12, p2_soldiers: 12, b1_hp: 700, b3_hp: 700},
  {tick: 18885, p1_soldiers: 14, p2_soldiers: 14, b1_hp: 700, b3_hp: 700},
  {tick: 18910, p1_soldiers: 16, p2_soldiers: 16, b1_hp: 700, b3_hp: 700},
  {tick: 18935, p1_soldiers: 18, p2_soldiers: 18, b1_hp: 700, b3_hp: 700},
  {tick: 18962, p1_soldiers: 20, p2_soldiers: 20, b1_hp: 700, b3_hp: 700},
  {tick: 18988, p1_soldiers: 22, p2_soldiers: 22, b1_hp: 700, b3_hp: 700},
  {tick: 19014, p1_soldiers: 24, p2_soldiers: 24, b1_hp: 700, b3_hp: 700},
  {tick: 19040, p1_soldiers: 26, p2_soldiers: 26, b1_hp: 700, b3_hp: 700},
  {tick: 19068, p1_soldiers: 28, p2_soldiers: 28, b1_hp: 700, b3_hp: 700},
  {tick: 19093, p1_soldiers: 30, p2_soldiers: 30, b1_hp: 700, b3_hp: 700},
  {tick: 19119, p1_soldiers: 32, p2_soldiers: 32, b1_hp: 700, b3_hp: 700},
  {tick: 19147, p1_soldiers: 34, p2_soldiers: 34, b1_hp: 700, b3_hp: 700},
  {tick: 19177, p1_soldiers: 36, p2_soldiers: 36, b1_hp: 700, b3_hp: 700},
  {tick: 19206, p1_soldiers: 38, p2_soldiers: 38, b1_hp: 700, b3_hp: 700},
  {tick: 19235, p1_soldiers: 40, p2_soldiers: 40, b1_hp: 700, b3_hp: 700},
  {tick: 19261, p1_soldiers: 42, p2_soldiers: 42, b1_hp: 700, b3_hp: 700},
  {tick: 19286, p1_soldiers: 44, p2_soldiers: 44, b1_hp: 700, b3_hp: 700},
  {tick: 19316, p1_soldiers: 46, p2_soldiers: 46, b1_hp: 700, b3_hp: 700},
  {tick: 19346, p1_soldiers: 48, p2_soldiers: 48, b1_hp: 700, b3_hp: 700},
  {tick: 19375, p1_soldiers: 50, p2_soldiers: 50, b1_hp: 700, b3_hp: 700},
  {tick: 19402, p1_soldiers: 52, p2_soldiers: 52, b1_hp: 700, b3_hp: 700},
  {tick: 19428, p1_soldiers: 54, p2_soldiers: 54, b1_hp: 700, b3_hp: 700},
  {tick: 19453, p1_soldiers: 56, p2_soldiers: 56, b1_hp: 700, b3_hp: 700},
  {tick: 19483, p1_soldiers: 58, p2_soldiers: 58, b1_hp: 700, b3_hp: 700},
  {tick: 19511, p1_soldiers: 60, p2_soldiers: 60, b1_hp: 700, b3_hp: 700},
  {tick: 19539, p1_soldiers: 62, p2_soldiers: 62, b1_hp: 700, b3_hp: 700},
  {tick: 19567, p1_soldiers: 64, p2_soldiers: 64, b1_hp: 700, b3_hp: 700},
  {tick: 19596, p1_soldiers: 66, p2_soldiers: 66, b1_hp: 700, b3_hp: 700},
  {tick: 19621, p1_soldiers: 68, p2_soldiers: 68, b1_hp: 700, b3_hp: 700},
  {tick: 19646, p1_soldiers: 70, p2_soldiers: 70, b1_hp: 700, b3_hp: 700},
  {tick: 19673, p1_soldiers: 72, p2_soldiers: 72, b1_hp: 700, b3_hp: 700},
  {tick: 19703, p1_soldiers: 74, p2_soldiers: 74, b1_hp: 700, b3_hp: 700},
  {tick: 19729, p1_soldiers: 76, p2_soldiers: 76, b1_hp: 700, b3_hp: 700},
  {tick: 19754, p1_soldiers: 78, p2_soldiers: 78, b1_hp: 700, b3_hp: 687},
  {tick: 19781, p1_soldiers: 80, p2_soldiers: 80, b1_hp: 700, b3_hp: 648},
  {tick: 19811, p1_soldiers: 82, p2_soldiers: 82, b1_hp: 700, b3_hp: 583},
  {tick: 19839, p1_soldiers: 84, p2_soldiers: 84, b1_hp: 700, b3_hp: 492},
  {tick: 19867, p1_soldiers: 86, p2_soldiers: 86, b1_hp: 700, b3_hp: 375},
  {tick: 19887, p1_soldiers: 88, p2_soldiers: 88, b1_hp: 596, b3_hp: 232},
  {tick: 19907, p1_soldiers: 90, p2_soldiers: 90, b1_hp: 596, b3_hp: 232},
  {tick: 19927, p1_soldiers: 92, p2_soldiers: 90, b1_hp: 466, b3_hp: 63},
  {tick: 19944, p1_soldiers: 92, p2_soldiers: 90, b1_hp: 466, b3_hp: -2},
];

// 6 个场景的时长（30 fps）
const OPENING_DURATION = 150; // 5s
const INTRO_DURATION = 300; // 10s
const BUILD_DURATION = 450; // 15s
const SIEGE_DURATION = 600; // 20s
const VERDICT_DURATION = 300; // 10s
const RECAP_DURATION = 300; // 10s

export const aiBattleDurationInFrames =
  OPENING_DURATION +
  INTRO_DURATION +
  BUILD_DURATION +
  SIEGE_DURATION +
  VERDICT_DURATION +
  RECAP_DURATION;

// 关键时间点（来自真实战斗日志）
const KEY_TICKS = {
  p1ReachB3: 19743,
  p2ReachB1: 19886,
  b3Destroyed: 19944,
};

// ─────────────────────────────────────────────────────────────
// 通用动画 helpers
// ─────────────────────────────────────────────────────────────
const clampProgress = (frame: number, delay = 0, duration = 18) =>
  interpolate(frame, [delay, delay + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const entranceStyle = (
  frame: number,
  delay = 0,
  duration = 18,
  distance = 48,
): CSSProperties => {
  const progress = clampProgress(frame, delay, duration);
  const eased = Easing.out(Easing.cubic)(progress);
  return {
    opacity: progress,
    transform: `translateY(${(1 - eased) * distance}px) scale(${0.96 + eased * 0.04})`,
  };
};

const panelBase: CSSProperties = {
  background: theme.surface,
  border: `1px solid ${theme.line}`,
  borderRadius: 24,
  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.35)',
  backdropFilter: 'blur(12px)',
};

// ─────────────────────────────────────────────────────────────
// 星点背景
// ─────────────────────────────────────────────────────────────
const stars = Array.from({length: 90}, (_, i) => ({
  id: i,
  left: ((i * 73) % 1000) / 10,
  top: ((i * 41 + 17) % 1000) / 10,
  size: 1.5 + (i % 4),
  speed: 0.2 + (i % 5) * 0.06,
  opacity: 0.15 + (i % 5) * 0.12,
}));

const Starfield: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      {stars.map((s) => {
        const twinkle = 0.5 + Math.sin(frame * s.speed * 0.18 + s.id) * 0.3;
        return (
          <div
            key={s.id}
            style={{
              position: 'absolute',
              left: `${s.left}%`,
              top: `${s.top}%`,
              width: s.size,
              height: s.size,
              borderRadius: s.size,
              backgroundColor: '#fff',
              boxShadow: `0 0 ${s.size * 6}px rgba(255,255,255,0.65)`,
              opacity: s.opacity * twinkle,
            }}
          />
        );
      })}
    </>
  );
};

// ─────────────────────────────────────────────────────────────
// 场景容器（统一背景）
// ─────────────────────────────────────────────────────────────
const SceneFrame: React.FC<{
  accent: string;
  children: React.ReactNode;
}> = ({accent, children}) => {
  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        background: theme.bg,
        fontFamily: theme.sans,
      }}
    >
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at 20% 20%, rgba(119, 242, 255, 0.12), transparent 32%), radial-gradient(circle at 80% 75%, rgba(255, 140, 106, 0.10), transparent 32%), linear-gradient(180deg, #09182d 0%, #050a13 100%)',
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(rgba(134, 201, 255, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(134, 201, 255, 0.06) 1px, transparent 1px)',
          backgroundSize: '120px 120px',
          opacity: 0.3,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, ${accent}18 0%, transparent 55%)`,
        }}
      />
      <Starfield />
      <AbsoluteFill style={{padding: '80px 100px'}}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────
// 场景 1：开场
// ─────────────────────────────────────────────────────────────
const OpeningScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const fadeIn = spring({
    fps,
    frame,
    config: {damping: 22, stiffness: 80, mass: 1},
  });

  const titleOpacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const subtitleOpacity = interpolate(frame, [30, 60], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <SceneFrame accent={theme.cyan}>
      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            opacity: titleOpacity,
            transform: `scale(${0.94 + fadeIn * 0.06})`,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              color: theme.cyan,
              fontSize: 24,
              letterSpacing: 8,
              fontFamily: theme.sans,
              marginBottom: 32,
            }}
          >
            SILICONWORLD · REAL AI MATCH REPLAY
          </div>
          <div
            style={{
              color: theme.text,
              fontSize: 148,
              fontWeight: 700,
              fontFamily: theme.serif,
              lineHeight: 1.05,
              letterSpacing: 4,
              textShadow: '0 0 60px rgba(119, 242, 255, 0.4)',
            }}
          >
            两个 AI 的战争
          </div>
        </div>
        <div
          style={{
            marginTop: 56,
            opacity: subtitleOpacity,
            color: theme.muted,
            fontSize: 34,
            fontFamily: theme.sans,
            letterSpacing: 2,
          }}
        >
          SiliconWorld AI Battle · 真实对局回放
        </div>
      </AbsoluteFill>
    </SceneFrame>
  );
};

// ─────────────────────────────────────────────────────────────
// 场景 2：选手介绍
// ─────────────────────────────────────────────────────────────
const PlayerCard: React.FC<{
  side: 'p1' | 'p2';
  title: string;
  subtitle: string;
  color: string;
  delay: number;
}> = ({side, title, subtitle, color, delay}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const progress = spring({
    fps,
    frame: Math.max(0, frame - delay),
    config: {damping: 20, stiffness: 100},
  });

  const isP1 = side === 'p1';
  const filter = isP1
    ? 'hue-rotate(180deg) saturate(1.4) brightness(0.9)'
    : 'hue-rotate(-30deg) saturate(1.6) brightness(0.85) sepia(0.2)';

  return (
    <div
      style={{
        ...panelBase,
        flex: 1,
        overflow: 'hidden',
        position: 'relative',
        opacity: progress,
        transform: `translateY(${(1 - progress) * 40}px)`,
        border: `2px solid ${color}66`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{position: 'relative', flexShrink: 0}}>
        <Img
          src={staticFile('battle_planet.png')}
          style={{
            width: '100%',
            height: 420,
            objectFit: 'cover',
            filter,
            display: 'block',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(180deg, transparent 30%, ${theme.bg}f2 100%)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: 24,
            padding: '8px 18px',
            borderRadius: 999,
            background: `${color}22`,
            border: `1px solid ${color}`,
            color,
            fontSize: 22,
            letterSpacing: 3,
            fontWeight: 700,
          }}
        >
          {side.toUpperCase()}
        </div>
      </div>
      <div style={{padding: '28px 32px', flex: 1}}>
        <div
          style={{
            color: theme.text,
            fontSize: 44,
            fontFamily: theme.serif,
            fontWeight: 700,
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: 12,
            color: theme.muted,
            fontSize: 24,
            fontFamily: theme.sans,
          }}
        >
          {subtitle}
        </div>
      </div>
    </div>
  );
};

const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const vsProgress = clampProgress(frame, 30, 20);
  const vsScale = 0.5 + vsProgress * 0.5 + Math.sin(frame / 6) * 0.02;

  return (
    <SceneFrame accent={theme.gold}>
      <div style={{display: 'flex', flexDirection: 'column', height: '100%', gap: 28}}>
        <div style={entranceStyle(frame, 0, 16, 24)}>
          <div
            style={{
              color: theme.muted,
              fontSize: 22,
              letterSpacing: 4,
              fontFamily: theme.sans,
            }}
          >
            MATCH SETUP · 对战配置
          </div>
          <div
            style={{
              marginTop: 8,
              color: theme.text,
              fontSize: 64,
              fontFamily: theme.serif,
              fontWeight: 700,
            }}
          >
            选手入场
          </div>
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            gap: 32,
            alignItems: 'stretch',
            position: 'relative',
          }}
        >
          <PlayerCard
            side="p1"
            title="侵略型"
            subtitle="先手突击 / 全军压上 / 不打退路"
            color={theme.cyan}
            delay={6}
          />

          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: `translate(-50%, -50%) scale(${vsScale})`,
              opacity: vsProgress,
              zIndex: 10,
              width: 140,
              height: 140,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${theme.gold}, #b87300)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 0 60px ${theme.gold}aa`,
              border: '4px solid #fff8',
            }}
          >
            <div
              style={{
                color: '#000',
                fontSize: 56,
                fontWeight: 900,
                fontFamily: theme.serif,
                letterSpacing: 2,
              }}
            >
              VS
            </div>
          </div>

          <PlayerCard
            side="p2"
            title="防守反击型"
            subtitle="稳守主基地 / 反扑反打 / 略慢半拍"
            color={theme.coral}
            delay={14}
          />
        </div>

        <div
          style={{
            ...entranceStyle(frame, 40, 16, 24),
            textAlign: 'center',
            color: theme.muted,
            fontSize: 26,
            fontFamily: theme.sans,
            letterSpacing: 2,
          }}
        >
          48 × 48 行星 · 对角基地 · 700 HP 主基地
        </div>
      </div>
    </SceneFrame>
  );
};

// ─────────────────────────────────────────────────────────────
// SVG 折线图（双方 soldier 数量）
// ─────────────────────────────────────────────────────────────
const CHART_W = 1640;
const CHART_H = 600;
const CHART_PAD = {left: 90, right: 40, top: 40, bottom: 60};

const tickToX = (tick: number) => {
  const t = (tick - startTick) / tickSpan;
  return CHART_PAD.left + t * (CHART_W - CHART_PAD.left - CHART_PAD.right);
};

const SoldierChart: React.FC<{progress: number}> = ({progress}) => {
  // 当前进度下应该显示到哪个 tick
  const visibleTick = startTick + tickSpan * progress;

  const maxSoldiers = 100;
  const valueToY = (v: number) => {
    return (
      CHART_PAD.top +
      (1 - v / maxSoldiers) * (CHART_H - CHART_PAD.top - CHART_PAD.bottom)
    );
  };

  const buildPath = (key: 'p1_soldiers' | 'p2_soldiers') => {
    const pts: string[] = [];
    for (const s of samples) {
      if (s.tick > visibleTick) break;
      pts.push(`${pts.length === 0 ? 'M' : 'L'} ${tickToX(s.tick)} ${valueToY(s[key])}`);
    }
    return pts.join(' ');
  };

  // y 轴网格线
  const yTicks = [0, 25, 50, 75, 100];

  return (
    <svg
      width={CHART_W}
      height={CHART_H}
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      style={{overflow: 'visible'}}
    >
      {/* 网格 */}
      {yTicks.map((v) => (
        <g key={v}>
          <line
            x1={CHART_PAD.left}
            x2={CHART_W - CHART_PAD.right}
            y1={valueToY(v)}
            y2={valueToY(v)}
            stroke="rgba(134,201,255,0.12)"
            strokeWidth={1}
            strokeDasharray="4 6"
          />
          <text
            x={CHART_PAD.left - 16}
            y={valueToY(v) + 6}
            fill={theme.muted}
            fontSize={20}
            textAnchor="end"
            fontFamily={theme.sans}
          >
            {v}
          </text>
        </g>
      ))}

      {/* x 轴标签（tick） */}
      {[startTick, 19000, 19500, endTick].map((t) => (
        <text
          key={t}
          x={tickToX(t)}
          y={CHART_H - 20}
          fill={theme.muted}
          fontSize={20}
          textAnchor="middle"
          fontFamily={theme.sans}
        >
          tick {t}
        </text>
      ))}

      {/* p1 蓝线 */}
      <path
        d={buildPath('p1_soldiers')}
        stroke={theme.cyan}
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{filter: `drop-shadow(0 0 8px ${theme.cyan}88)`}}
      />
      {/* p2 红线 */}
      <path
        d={buildPath('p2_soldiers')}
        stroke={theme.coral}
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{filter: `drop-shadow(0 0 8px ${theme.coral}88)`}}
      />

      {/* 末端数据点 */}
      {progress > 0.02 && (
        <>
          {samples
            .filter((s) => s.tick <= visibleTick)
            .slice(-1)
            .map((s) => (
              <g key={s.tick}>
                <circle
                  cx={tickToX(s.tick)}
                  cy={valueToY(s.p1_soldiers)}
                  r={10}
                  fill={theme.cyan}
                  stroke="#fff"
                  strokeWidth={3}
                />
                <circle
                  cx={tickToX(s.tick)}
                  cy={valueToY(s.p2_soldiers)}
                  r={10}
                  fill={theme.coral}
                  stroke="#fff"
                  strokeWidth={3}
                />
              </g>
            ))}
        </>
      )}
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────
// 场景 3：暴兵阶段
// ─────────────────────────────────────────────────────────────
const BuildScene: React.FC = () => {
  const frame = useCurrentFrame();
  const progress = clampProgress(frame, 20, 380); // 慢速展开

  // 副标题"擦肩而过"的提示（在图表中段）
  const midNoteOpacity = interpolate(frame, [200, 230, 350, 380], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // 当前应该显示的 soldier 数
  const visibleTick = startTick + tickSpan * progress;
  let cur = samples[0];
  for (const s of samples) {
    if (s.tick > visibleTick) break;
    cur = s;
  }

  return (
    <SceneFrame accent={theme.mint}>
      <div style={{display: 'flex', flexDirection: 'column', height: '100%', gap: 22}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end'}}>
          <div style={entranceStyle(frame, 0, 16, 24)}>
            <div
              style={{
                color: theme.muted,
                fontSize: 22,
                letterSpacing: 4,
              }}
            >
              PHASE 1 · 暴兵阶段
            </div>
            <div
              style={{
                marginTop: 8,
                color: theme.text,
                fontSize: 60,
                fontFamily: theme.serif,
                fontWeight: 700,
              }}
            >
              双方全力暴兵
            </div>
            <div
              style={{
                marginTop: 10,
                color: theme.muted,
                fontSize: 24,
              }}
            >
              平均每秒 4–5 个 soldier 出厂
            </div>
          </div>

          {/* 实时数据 */}
          <div
            style={{
              display: 'flex',
              gap: 32,
              ...entranceStyle(frame, 10, 16, 24),
            }}
          >
            <div style={{textAlign: 'right'}}>
              <div style={{color: theme.cyan, fontSize: 18, letterSpacing: 2}}>p1 soldiers</div>
              <div
                style={{
                  color: theme.text,
                  fontSize: 64,
                  fontFamily: theme.serif,
                  fontWeight: 700,
                }}
              >
                {cur.p1_soldiers}
              </div>
            </div>
            <div style={{textAlign: 'right'}}>
              <div style={{color: theme.coral, fontSize: 18, letterSpacing: 2}}>p2 soldiers</div>
              <div
                style={{
                  color: theme.text,
                  fontSize: 64,
                  fontFamily: theme.serif,
                  fontWeight: 700,
                }}
              >
                {cur.p2_soldiers}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            ...panelBase,
            flex: 1,
            padding: 28,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SoldierChart progress={progress} />

          {/* 擦肩而过提示 */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 40,
              transform: 'translateX(-50%)',
              padding: '14px 24px',
              borderRadius: 999,
              background: `${theme.gold}22`,
              border: `1px solid ${theme.gold}`,
              color: theme.gold,
              fontSize: 24,
              letterSpacing: 2,
              opacity: midNoteOpacity,
              fontFamily: theme.sans,
            }}
          >
            两支军队擦肩而过于地图中央
          </div>
        </div>

        {/* 图例 */}
        <div
          style={{
            display: 'flex',
            gap: 40,
            justifyContent: 'center',
            ...entranceStyle(frame, 30, 16, 20),
          }}
        >
          <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
            <div
              style={{
                width: 32,
                height: 4,
                background: theme.cyan,
                boxShadow: `0 0 10px ${theme.cyan}`,
              }}
            />
            <span style={{color: theme.text, fontSize: 22}}>p1 · 侵略型</span>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
            <div
              style={{
                width: 32,
                height: 4,
                background: theme.coral,
                boxShadow: `0 0 10px ${theme.coral}`,
              }}
            />
            <span style={{color: theme.text, fontSize: 22}}>p2 · 防守反击型</span>
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

// ─────────────────────────────────────────────────────────────
// HP 双折线图（围攻阶段）
// ─────────────────────────────────────────────────────────────
const HpChart: React.FC<{progress: number; frame: number}> = ({progress, frame}) => {
  // 围攻阶段聚焦于 19500-19960（HP 实际开始下降的区段），让曲线变化更醒目
  const chartStart = 19500;
  const chartEnd = 19960;
  const chartSpan = chartEnd - chartStart;

  const localTickToX = (tick: number) => {
    const t = (tick - chartStart) / chartSpan;
    return CHART_PAD.left + t * (CHART_W - CHART_PAD.left - CHART_PAD.right);
  };

  const visibleTick = chartStart + chartSpan * progress;

  // HP 范围：-50 ~ 750
  const valueToY = (v: number) => {
    const min = -50;
    const max = 750;
    return (
      CHART_PAD.top +
      (1 - (v - min) / (max - min)) * (CHART_H - CHART_PAD.top - CHART_PAD.bottom)
    );
  };

  const buildPath = (key: 'b1_hp' | 'b3_hp') => {
    const pts: string[] = [];
    for (const s of samples) {
      if (s.tick < chartStart) continue;
      if (s.tick > visibleTick) break;
      pts.push(`${pts.length === 0 ? 'M' : 'L'} ${localTickToX(s.tick)} ${valueToY(s[key])}`);
    }
    return pts.join(' ');
  };

  const yTicks = [0, 200, 400, 600, 700];

  // 关键时间点
  const markers: {tick: number; label: string; color: string}[] = [
    {tick: KEY_TICKS.p1ReachB3, label: 'p1 先锋抵达 p2 主基地', color: theme.coral},
    {tick: KEY_TICKS.p2ReachB1, label: 'p2 反扑部队抵达 p1 主基地', color: theme.cyan},
    {tick: KEY_TICKS.b3Destroyed, label: 'b-3 被摧毁', color: '#ff3355'},
  ];

  return (
    <svg
      width={CHART_W}
      height={CHART_H}
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      style={{overflow: 'visible'}}
    >
      {yTicks.map((v) => (
        <g key={v}>
          <line
            x1={CHART_PAD.left}
            x2={CHART_W - CHART_PAD.right}
            y1={valueToY(v)}
            y2={valueToY(v)}
            stroke="rgba(134,201,255,0.12)"
            strokeWidth={1}
            strokeDasharray="4 6"
          />
          <text
            x={CHART_PAD.left - 16}
            y={valueToY(v) + 6}
            fill={theme.muted}
            fontSize={20}
            textAnchor="end"
            fontFamily={theme.sans}
          >
            {v}
          </text>
        </g>
      ))}

      {[chartStart, 19600, 19700, 19800, 19900, chartEnd].map((t) => (
        <text
          key={t}
          x={localTickToX(t)}
          y={CHART_H - 20}
          fill={theme.muted}
          fontSize={20}
          textAnchor="middle"
          fontFamily={theme.sans}
        >
          tick {t}
        </text>
      ))}

      {/* 0 线（摧毁线） */}
      <line
        x1={CHART_PAD.left}
        x2={CHART_W - CHART_PAD.right}
        y1={valueToY(0)}
        y2={valueToY(0)}
        stroke="#ff335566"
        strokeWidth={2}
      />

      {/* 关键时刻标记 */}
      {markers.map((m) => {
        const x = localTickToX(m.tick);
        const visible = visibleTick >= m.tick;
        if (!visible) return null;
        const isDestroyed = m.tick === KEY_TICKS.b3Destroyed;
        const flash = isDestroyed ? 0.5 + Math.sin(frame / 4) * 0.5 : 1;
        return (
          <g key={m.tick} opacity={flash}>
            <line
              x1={x}
              x2={x}
              y1={CHART_PAD.top}
              y2={CHART_H - CHART_PAD.bottom}
              stroke={m.color}
              strokeWidth={2}
              strokeDasharray="6 6"
            />
            <circle cx={x} cy={CHART_PAD.top - 12} r={8} fill={m.color} stroke="#fff" strokeWidth={2} />
            <text
              x={x}
              y={CHART_PAD.top - 32}
              fill={m.color}
              fontSize={18}
              textAnchor="middle"
              fontFamily={theme.sans}
              fontWeight={700}
            >
              {m.label}
            </text>
          </g>
        );
      })}

      {/* b-1 蓝线 */}
      <path
        d={buildPath('b1_hp')}
        stroke={theme.cyan}
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{filter: `drop-shadow(0 0 8px ${theme.cyan}88)`}}
      />
      {/* b-3 红线 */}
      <path
        d={buildPath('b3_hp')}
        stroke={theme.coral}
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{filter: `drop-shadow(0 0 8px ${theme.coral}88)`}}
      />
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────
// 场景 4：围攻阶段
// ─────────────────────────────────────────────────────────────
const SiegeScene: React.FC = () => {
  const frame = useCurrentFrame();
  const progress = clampProgress(frame, 20, 520);

  // 与 HpChart 保持一致的聚焦区段
  const chartStart = 19500;
  const chartEnd = 19960;
  const visibleTick = chartStart + (chartEnd - chartStart) * progress;
  let cur = samples[0];
  for (const s of samples) {
    if (s.tick > visibleTick) break;
    cur = s;
  }

  return (
    <SceneFrame accent={theme.coral}>
      <div style={{display: 'flex', flexDirection: 'column', height: '100%', gap: 22}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end'}}>
          <div style={entranceStyle(frame, 0, 16, 24)}>
            <div
              style={{
                color: theme.muted,
                fontSize: 22,
                letterSpacing: 4,
              }}
            >
              PHASE 2 · 围攻阶段
            </div>
            <div
              style={{
                marginTop: 8,
                color: theme.text,
                fontSize: 60,
                fontFamily: theme.serif,
                fontWeight: 700,
              }}
            >
              消耗战 · 主基地血量
            </div>
            <div
              style={{
                marginTop: 10,
                color: theme.muted,
                fontSize: 24,
              }}
            >
              谁先手 250 tick，谁就赢
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 32,
              ...entranceStyle(frame, 10, 16, 24),
            }}
          >
            <div style={{textAlign: 'right'}}>
              <div style={{color: theme.cyan, fontSize: 18, letterSpacing: 2}}>b-1 (p1) HP</div>
              <div
                style={{
                  color: theme.text,
                  fontSize: 64,
                  fontFamily: theme.serif,
                  fontWeight: 700,
                }}
              >
                {cur.b1_hp}
              </div>
            </div>
            <div style={{textAlign: 'right'}}>
              <div style={{color: theme.coral, fontSize: 18, letterSpacing: 2}}>b-3 (p2) HP</div>
              <div
                style={{
                  color: cur.b3_hp < 100 ? '#ff3355' : theme.text,
                  fontSize: 64,
                  fontFamily: theme.serif,
                  fontWeight: 700,
                  textShadow: cur.b3_hp < 100 ? '0 0 30px #ff3355aa' : undefined,
                }}
              >
                {cur.b3_hp}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            ...panelBase,
            flex: 1,
            padding: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <HpChart progress={progress} frame={frame} />
        </div>

        <div
          style={{
            display: 'flex',
            gap: 40,
            justifyContent: 'center',
            ...entranceStyle(frame, 30, 16, 20),
          }}
        >
          <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
            <div
              style={{
                width: 32,
                height: 4,
                background: theme.cyan,
                boxShadow: `0 0 10px ${theme.cyan}`,
              }}
            />
            <span style={{color: theme.text, fontSize: 22}}>b-1 · p1 主基地</span>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
            <div
              style={{
                width: 32,
                height: 4,
                background: theme.coral,
                boxShadow: `0 0 10px ${theme.coral}`,
              }}
            />
            <span style={{color: theme.text, fontSize: 22}}>b-3 · p2 主基地</span>
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

// ─────────────────────────────────────────────────────────────
// 场景 5：胜负判定
// ─────────────────────────────────────────────────────────────
const VerdictScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const scaleIn = spring({
    fps,
    frame,
    config: {damping: 12, stiffness: 90, mass: 1},
  });

  const subOpacity = interpolate(frame, [40, 70], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const statsOpacity = interpolate(frame, [90, 130], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const flash = 0.85 + Math.sin(frame / 8) * 0.15;

  return (
    <SceneFrame accent={theme.gold}>
      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 40,
        }}
      >
        <div
          style={{
            color: theme.muted,
            fontSize: 28,
            letterSpacing: 8,
            fontFamily: theme.sans,
            opacity: subOpacity,
          }}
        >
          FINAL RESULT · 战斗结果
        </div>

        <div
          style={{
            transform: `scale(${0.5 + scaleIn * 0.5})`,
            opacity: scaleIn,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 220,
              fontWeight: 900,
              fontFamily: theme.serif,
              background: `linear-gradient(180deg, ${theme.gold}, #ff7a3d)`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: 6,
              lineHeight: 1,
              textShadow: `0 0 ${80 * flash}px ${theme.gold}66`,
            }}
          >
            WINNER
          </div>
          <div
            style={{
              marginTop: 16,
              fontSize: 200,
              fontWeight: 900,
              fontFamily: theme.serif,
              color: theme.cyan,
              letterSpacing: 8,
              lineHeight: 1,
              textShadow: `0 0 60px ${theme.cyan}aa`,
            }}
          >
            p1
          </div>
        </div>

        <div
          style={{
            opacity: subOpacity,
            color: theme.text,
            fontSize: 36,
            fontFamily: theme.sans,
            letterSpacing: 2,
          }}
        >
          以 <span style={{color: theme.gold, fontWeight: 700}}>elimination</span> 击败 p2
        </div>

        <div
          style={{
            opacity: statsOpacity,
            display: 'flex',
            gap: 32,
            marginTop: 12,
          }}
        >
          {[
            {label: '总时长', value: '1274 tick'},
            {label: 'soldier 对比', value: '92 vs 90'},
            {label: '最后一击', value: 'u-118'},
          ].map((s) => (
            <div
              key={s.label}
              style={{
                ...panelBase,
                padding: '22px 32px',
                textAlign: 'center',
                minWidth: 220,
              }}
            >
              <div
                style={{
                  color: theme.muted,
                  fontSize: 18,
                  letterSpacing: 2,
                  marginBottom: 8,
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  color: theme.text,
                  fontSize: 34,
                  fontFamily: theme.serif,
                  fontWeight: 700,
                }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </SceneFrame>
  );
};

// ─────────────────────────────────────────────────────────────
// 场景 6：复盘 / 收尾
// ─────────────────────────────────────────────────────────────
const RecapScene: React.FC = () => {
  const frame = useCurrentFrame();

  const stats = [
    {label: '总时长', value: '2 分 7 秒', sub: 'wall-clock @ 10 tick/s', color: theme.cyan},
    {label: '总生产', value: '182 soldier', sub: 'p1: 92 · p2: 90', color: theme.mint},
    {label: '总攻击', value: '94 次', sub: '双方合计输出', color: theme.gold},
    {label: '总伤害事件', value: '218 次', sub: '含围攻与反扑', color: theme.coral},
  ];

  return (
    <SceneFrame accent={theme.violet}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          gap: 32,
        }}
      >
        <div style={entranceStyle(frame, 0, 16, 24)}>
          <div
            style={{
              color: theme.muted,
              fontSize: 22,
              letterSpacing: 4,
            }}
          >
            RECAP · 战斗复盘
          </div>
          <div
            style={{
              marginTop: 8,
              color: theme.text,
              fontSize: 60,
              fontFamily: theme.serif,
              fontWeight: 700,
            }}
          >
            一场 250 tick 的先手胜利
          </div>
        </div>

        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gridTemplateRows: 'repeat(2, 1fr)',
            gap: 24,
          }}
        >
          {stats.map((s, i) => (
            <div
              key={s.label}
              style={{
                ...panelBase,
                ...entranceStyle(frame, 10 + i * 5, 16, 28),
                padding: '32px 36px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: `1px solid ${s.color}44`,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div
                  style={{
                    color: theme.muted,
                    fontSize: 22,
                    letterSpacing: 3,
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    background: s.color,
                    boxShadow: `0 0 16px ${s.color}`,
                  }}
                />
              </div>
              <div
                style={{
                  color: theme.text,
                  fontSize: 72,
                  fontFamily: theme.serif,
                  fontWeight: 700,
                  lineHeight: 1,
                  marginTop: 12,
                }}
              >
                {s.value}
              </div>
              <div
                style={{
                  color: theme.muted,
                  fontSize: 20,
                  marginTop: 8,
                }}
              >
                {s.sub}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            ...entranceStyle(frame, 50, 18, 24),
            textAlign: 'center',
            padding: '20px 0',
          }}
        >
          <div
            style={{
              color: theme.muted,
              fontSize: 22,
              letterSpacing: 6,
              fontFamily: theme.sans,
            }}
          >
            由 AI 编排 · Remotion 渲染
          </div>
          <div
            style={{
              marginTop: 10,
              color: theme.text,
              fontSize: 30,
              letterSpacing: 3,
              fontFamily: theme.serif,
            }}
          >
            SiliconWorld · Galactic Warforge
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

// ─────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────
export const AiBattleVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{backgroundColor: theme.bg}}>
      <Sequence durationInFrames={OPENING_DURATION}>
        <OpeningScene />
      </Sequence>
      <Sequence from={OPENING_DURATION} durationInFrames={INTRO_DURATION}>
        <IntroScene />
      </Sequence>
      <Sequence from={OPENING_DURATION + INTRO_DURATION} durationInFrames={BUILD_DURATION}>
        <BuildScene />
      </Sequence>
      <Sequence
        from={OPENING_DURATION + INTRO_DURATION + BUILD_DURATION}
        durationInFrames={SIEGE_DURATION}
      >
        <SiegeScene />
      </Sequence>
      <Sequence
        from={OPENING_DURATION + INTRO_DURATION + BUILD_DURATION + SIEGE_DURATION}
        durationInFrames={VERDICT_DURATION}
      >
        <VerdictScene />
      </Sequence>
      <Sequence
        from={OPENING_DURATION + INTRO_DURATION + BUILD_DURATION + SIEGE_DURATION + VERDICT_DURATION}
        durationInFrames={RECAP_DURATION}
      >
        <RecapScene />
      </Sequence>
    </AbsoluteFill>
  );
};
