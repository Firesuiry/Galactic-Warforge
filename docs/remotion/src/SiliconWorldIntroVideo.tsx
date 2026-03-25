import React, {CSSProperties} from 'react';
import {Audio} from '@remotion/media';
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  architectureLayers,
  futureFocus,
  heroTags,
  loopSteps,
  metrics,
  snapshotDate,
  statusHighlights,
  systemCards,
  worldLayers,
} from './data';
import {theme} from './theme';

const heroDuration = 192;
const architectureDuration = 270;
const systemsDuration = 249;
const loopDuration = 267;
const metricsDuration = 273;
const closingDuration = 297;

export const introDurationInFrames =
  heroDuration +
  architectureDuration +
  systemsDuration +
  loopDuration +
  metricsDuration +
  closingDuration;

const voiceoverTracks = [
  {from: 10, src: 'audio/voiceover/scene-01-hero.mp3'},
  {from: heroDuration + 10, src: 'audio/voiceover/scene-02-architecture.mp3'},
  {
    from: heroDuration + architectureDuration + 10,
    src: 'audio/voiceover/scene-03-systems.mp3',
  },
  {
    from: heroDuration + architectureDuration + systemsDuration + 10,
    src: 'audio/voiceover/scene-04-loop.mp3',
  },
  {
    from:
      heroDuration + architectureDuration + systemsDuration + loopDuration + 10,
    src: 'audio/voiceover/scene-05-metrics.mp3',
  },
  {
    from:
      heroDuration +
      architectureDuration +
      systemsDuration +
      loopDuration +
      metricsDuration +
      10,
    src: 'audio/voiceover/scene-06-closing.mp3',
  },
] as const;

const stars = Array.from({length: 72}, (_, index) => ({
  id: index,
  left: ((index * 83) % 1000) / 10,
  top: ((index * 61 + 17) % 1000) / 10,
  size: 2 + (index % 4),
  speed: 0.2 + (index % 6) * 0.06,
  opacity: 0.18 + (index % 5) * 0.12,
}));

const orbitNodes = Array.from({length: 18}, (_, index) => ({
  id: index,
  angle: (index / 18) * Math.PI * 2,
}));

const panelBase: CSSProperties = {
  background: theme.surface,
  border: `1px solid ${theme.line}`,
  borderRadius: 28,
  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.28)',
  backdropFilter: 'blur(12px)',
};

const scenePadding: CSSProperties = {
  padding: '92px 108px',
};

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

const pulseStyle = (frame: number, offset = 0) => {
  const oscillation = Math.sin((frame + offset) / 14);
  return 0.7 + (oscillation + 1) * 0.15;
};

const SceneFrame: React.FC<{
  accent: string;
  children: React.ReactNode;
}> = ({accent, children}) => {
  const frame = useCurrentFrame();
  const overlayShift = Math.sin(frame / 48) * 120;

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        background: theme.bg,
      }}
    >
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at 18% 18%, rgba(119, 242, 255, 0.18), transparent 30%), radial-gradient(circle at 80% 20%, rgba(255, 148, 182, 0.14), transparent 30%), radial-gradient(circle at 60% 78%, rgba(255, 140, 106, 0.12), transparent 28%), linear-gradient(180deg, #09182d 0%, #050a13 100%)',
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(rgba(134, 201, 255, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(134, 201, 255, 0.08) 1px, transparent 1px)',
          backgroundSize: '120px 120px',
          opacity: 0.2,
          transform: `translate3d(${overlayShift * 0.04}px, ${overlayShift * 0.02}px, 0)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, ${accent}20 0%, transparent 48%)`,
          filter: 'blur(40px)',
          transform: `scale(${1.04 + Math.sin(frame / 30) * 0.02})`,
        }}
      />
      <Starfield />
      <AbsoluteFill style={scenePadding}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

const Starfield: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <>
      {stars.map((star) => {
        const twinkle = 0.45 + Math.sin(frame * star.speed * 0.18 + star.id) * 0.25;
        const yOffset = ((frame * star.speed + star.id * 11) % 240) / 20;

        return (
          <div
            key={star.id}
            style={{
              position: 'absolute',
              left: `${star.left}%`,
              top: `calc(${star.top}% + ${yOffset}px)`,
              width: star.size,
              height: star.size,
              borderRadius: star.size,
              backgroundColor: '#ffffff',
              boxShadow: `0 0 ${star.size * 8}px rgba(255,255,255,0.65)`,
              opacity: star.opacity * twinkle,
            }}
          />
        );
      })}
    </>
  );
};

const SectionKicker: React.FC<{label: string; accent: string; style?: CSSProperties}> = ({
  label,
  accent,
  style,
}) => {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 22px',
        borderRadius: 999,
        border: `1px solid ${accent}55`,
        background: `${accent}12`,
        color: theme.text,
        fontSize: 24,
        letterSpacing: 3,
        fontFamily: theme.sans,
        ...style,
      }}
    >
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 999,
          background: accent,
          boxShadow: `0 0 16px ${accent}`,
        }}
      />
      {label}
    </div>
  );
};

const SceneHeading: React.FC<{
  label: string;
  title: string;
  body: string;
  accent: string;
}> = ({label, title, body, accent}) => {
  const frame = useCurrentFrame();

  return (
    <div style={{maxWidth: 760}}>
      <div style={entranceStyle(frame, 0, 18, 26)}>
        <SectionKicker label={label} accent={accent} />
      </div>
      <div style={entranceStyle(frame, 6, 18, 46)}>
        <h2
          style={{
            margin: '28px 0 20px',
            fontSize: 84,
            lineHeight: 1.05,
            fontWeight: 700,
            color: theme.text,
            fontFamily: theme.serif,
          }}
        >
          {title}
        </h2>
      </div>
      <div style={entranceStyle(frame, 12, 18, 54)}>
        <p
          style={{
            margin: 0,
            color: theme.muted,
            fontSize: 30,
            lineHeight: 1.65,
            fontFamily: theme.sans,
          }}
        >
          {body}
        </p>
      </div>
    </div>
  );
};

const HeroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const heroReveal = spring({
    fps,
    frame,
    config: {damping: 18, stiffness: 90, mass: 0.9},
  });

  return (
    <SceneFrame accent={theme.cyan}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.25fr 0.95fr',
          height: '100%',
          alignItems: 'center',
          gap: 40,
        }}
      >
        <div>
          <div style={entranceStyle(frame, 0, 18, 26)}>
            <SectionKicker label={`状态快照 ${snapshotDate}`} accent={theme.cyan} />
          </div>
          <div style={entranceStyle(frame, 6, 18, 46)}>
            <h1
              style={{
                margin: '28px 0 16px',
                fontSize: 122,
                lineHeight: 0.96,
                color: theme.text,
                fontFamily: theme.serif,
                letterSpacing: 1,
              }}
            >
              硅基世界
            </h1>
          </div>
          <div style={entranceStyle(frame, 12, 18, 52)}>
            <p
              style={{
                margin: 0,
                maxWidth: 880,
                color: theme.muted,
                fontSize: 34,
                lineHeight: 1.58,
                fontFamily: theme.sans,
              }}
            >
              一个把戴森球风格的工业、物流、能源、科技、战斗和回放系统，压进同一条服务端 Tick 结算链里的游戏项目。
            </p>
          </div>
          <div
            style={{
              marginTop: 44,
              display: 'flex',
              gap: 18,
              flexWrap: 'wrap',
            }}
          >
            {heroTags.map((tag, index) => (
              <div
                key={tag}
                style={{
                  ...entranceStyle(frame, 20 + index * 4, 14, 24),
                  padding: '16px 24px',
                  borderRadius: 999,
                  border: `1px solid ${theme.line}`,
                  background: 'rgba(255, 255, 255, 0.04)',
                  color: theme.text,
                  fontFamily: theme.sans,
                  fontSize: 25,
                }}
              >
                {tag}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `scale(${0.92 + heroReveal * 0.08})`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              width: 660,
              height: 660,
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.08)',
              background:
                'radial-gradient(circle at 50% 50%, rgba(119, 242, 255, 0.24), rgba(10, 24, 44, 0.04) 58%, transparent 70%)',
              filter: 'blur(1px)',
            }}
          />
          {[0, 1, 2].map((ring) => {
            const rotation = frame * (0.18 + ring * 0.05);
            const size = 460 + ring * 92;

            return (
              <div
                key={ring}
                style={{
                  position: 'absolute',
                  width: size,
                  height: size,
                  borderRadius: '50%',
                  border: `2px solid ${ring === 0 ? '#77f2ff88' : ring === 1 ? '#ff8c6a55' : '#a794ff55'}`,
                  transform: `rotate(${rotation}deg)`,
                }}
              >
                {orbitNodes.map((node, index) => (
                  <div
                    key={`${ring}-${node.id}`}
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: 14 + (index % 2) * 4,
                      height: 14 + (index % 2) * 4,
                      borderRadius: '50%',
                      background:
                        ring === 0 ? theme.cyan : ring === 1 ? theme.coral : theme.violet,
                      boxShadow: `0 0 14px ${ring === 0 ? theme.cyan : ring === 1 ? theme.coral : theme.violet}`,
                      transform: `rotate(${(node.angle * 180) / Math.PI}deg) translateX(${size / 2}px)`,
                      opacity: 0.7 + Math.sin(frame / 12 + index) * 0.2,
                    }}
                  />
                ))}
              </div>
            );
          })}
          <div
            style={{
              ...panelBase,
              width: 360,
              padding: '34px 32px',
              textAlign: 'center',
              transform: `translateY(${Math.sin(frame / 22) * 10}px)`,
            }}
          >
            <div
              style={{
                color: theme.cyan,
                fontSize: 20,
                letterSpacing: 4,
                fontFamily: theme.sans,
                textTransform: 'uppercase',
              }}
            >
              SiliconWorld
            </div>
            <div
              style={{
                marginTop: 18,
                color: theme.text,
                fontSize: 56,
                lineHeight: 1.2,
                fontWeight: 700,
                fontFamily: theme.serif,
              }}
            >
              服务端宇宙
            </div>
            <div
              style={{
                marginTop: 16,
                color: theme.muted,
                fontSize: 24,
                lineHeight: 1.6,
                fontFamily: theme.sans,
              }}
            >
              API、CLI 与 AI 只提交意图
              <br />
              真正的世界状态由服务器推进
            </div>
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

const ArchitectureScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame accent={theme.violet}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '0.95fr 1.05fr',
          gap: 48,
          height: '100%',
          alignItems: 'center',
        }}
      >
        <SceneHeading
          label="架构骨架"
          title="先搭好宇宙，再允许玩家发出意图"
          body="玩家、CLI 与外部 AI 不直接改写状态。所有行为都先变成命令，进入网关、审计与去重，再在 Tick 边界统一执行。"
          accent={theme.violet}
        />

        <div
          style={{
            ...panelBase,
            padding: 36,
            minHeight: 690,
            display: 'grid',
            gridTemplateColumns: '1.1fr 0.9fr',
            gap: 28,
          }}
        >
          <div>
            {architectureLayers.map((layer, index) => (
              <div
                key={layer}
                style={{
                  ...entranceStyle(frame, 8 + index * 5, 16, 26),
                  marginBottom: 18,
                  padding: '20px 24px',
                  borderRadius: 22,
                  background:
                    index === architectureLayers.length - 1
                      ? 'linear-gradient(135deg, rgba(119,242,255,0.2), rgba(167,148,255,0.1))'
                      : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${index === 3 ? theme.violet : theme.line}`,
                  color: theme.text,
                  fontFamily: theme.sans,
                  fontSize: 28,
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    letterSpacing: 2,
                    color: index === 3 ? theme.violet : theme.muted,
                    marginBottom: 10,
                  }}
                >
                  {`0${index + 1}`}
                </div>
                {layer}
              </div>
            ))}
          </div>

          <div
            style={{
              position: 'relative',
              borderRadius: 26,
              overflow: 'hidden',
              border: `1px solid ${theme.line}`,
              background:
                'radial-gradient(circle at 50% 40%, rgba(119,242,255,0.14), rgba(7,17,31,0.92) 60%)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {[0, 1, 2].map((ring) => {
                const size = 220 + ring * 120;
                const rotation = frame * (0.14 + ring * 0.03);

                return (
                  <div
                    key={ring}
                    style={{
                      position: 'absolute',
                      width: size,
                      height: size,
                      borderRadius: '50%',
                      border:
                        ring === 0
                          ? '2px solid rgba(119,242,255,0.55)'
                          : '1px solid rgba(255,255,255,0.14)',
                      transform: `rotate(${rotation}deg)`,
                    }}
                  />
                );
              })}
              <div
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(255,213,106,0.95), rgba(255,140,106,0.55) 64%, transparent 72%)',
                  boxShadow: '0 0 40px rgba(255, 196, 104, 0.45)',
                }}
              />
            </div>

            <div
              style={{
                position: 'absolute',
                right: 26,
                top: 26,
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              {worldLayers.map((label, index) => (
                <div
                  key={label}
                  style={{
                    ...entranceStyle(frame, 18 + index * 5, 14, 16),
                    padding: '14px 18px',
                    minWidth: 188,
                    borderRadius: 18,
                    background: 'rgba(10, 24, 44, 0.78)',
                    border: `1px solid ${theme.line}`,
                    color: theme.text,
                    fontSize: 24,
                    fontFamily: theme.sans,
                  }}
                >
                  {label}
                </div>
              ))}
            </div>

            <div
              style={{
                position: 'absolute',
                left: 28,
                right: 28,
                bottom: 28,
                padding: '22px 24px',
                borderRadius: 22,
                background: 'rgba(10, 24, 44, 0.78)',
                border: `1px solid ${theme.line}`,
                color: theme.muted,
                fontSize: 24,
                lineHeight: 1.6,
                fontFamily: theme.sans,
              }}
            >
              世界结构采用
              <span style={{color: theme.text}}> 星系 - 恒星系 - 行星二维网格 </span>
              分层模型，查询和事件再按可见域裁剪下发。
            </div>
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

const SystemsScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame accent={theme.mint}>
      <div style={{display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 34, height: '100%'}}>
        <SceneHeading
          label="系统闭环"
          title="六套玩法系统，被压在同一条 Tick 链里"
          body="重点不是把模块写全，而是让它们在服务端里真正互相约束。电力限制生产，物流决定吞吐，科技改变能力，战斗与戴森系统反过来影响全局节奏。"
          accent={theme.mint}
        />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 24,
          }}
        >
          {systemCards.map((card, index) => (
            <div
              key={card.title}
              style={{
                ...panelBase,
                ...entranceStyle(frame, 18 + index * 4, 16, 34),
                padding: '28px 28px 30px',
                minHeight: 260,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: `radial-gradient(circle at 88% 14%, ${card.accent}22, transparent 34%)`,
                }}
              />
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  background: card.accent,
                  boxShadow: `0 0 20px ${card.accent}`,
                }}
              />
              <div
                style={{
                  marginTop: 18,
                  color: theme.text,
                  fontSize: 42,
                  fontFamily: theme.serif,
                  fontWeight: 700,
                }}
              >
                {card.title}
              </div>
              <div
                style={{
                  marginTop: 16,
                  color: theme.muted,
                  fontSize: 26,
                  lineHeight: 1.72,
                  fontFamily: theme.sans,
                }}
              >
                {card.body}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            ...panelBase,
            ...entranceStyle(frame, 38, 18, 26),
            padding: '24px 30px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
          }}
        >
          <div
            style={{
              color: theme.text,
              fontSize: 30,
              fontFamily: theme.sans,
              fontWeight: 600,
            }}
          >
            命令、事件、快照、回放、审计，不是附属工具，而是整个世界可验证的骨架。
          </div>
          <div
            style={{
              padding: '14px 22px',
              borderRadius: 999,
              border: `1px solid ${theme.mint}55`,
              color: theme.mint,
              fontSize: 22,
              fontFamily: theme.sans,
              letterSpacing: 2,
            }}
          >
            API / CLI / SSE
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

const LoopScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame accent={theme.gold}>
      <div style={{display: 'grid', gridTemplateRows: 'auto 1fr', gap: 32, height: '100%'}}>
        <SceneHeading
          label="运行路径"
          title="主循环不是一句口号，而是一条可推进的流水线"
          body="当前项目的关键价值，是让研究、建造、生产和扩产不再只是文档里的模块，而是在统一结算顺序中真正跑起来。"
          accent={theme.gold}
        />

        <div
          style={{
            ...panelBase,
            padding: '42px 38px',
            display: 'grid',
            gridTemplateRows: 'auto 1fr auto',
            gap: 30,
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
                color: theme.text,
                fontFamily: theme.serif,
                fontSize: 48,
              }}
            >
              统一 Tick 结算顺序
            </div>
            <div
              style={{
                padding: '12px 18px',
                borderRadius: 999,
                border: `1px solid ${theme.gold}55`,
                color: theme.gold,
                fontSize: 20,
                fontFamily: theme.sans,
              }}
            >
              命令进入 / 事件流出
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 26,
              alignItems: 'stretch',
            }}
          >
            {loopSteps.map((step, index) => (
              <div
                key={step}
                style={{
                  ...entranceStyle(frame, 12 + index * 4, 14, 24),
                  position: 'relative',
                  padding: '28px 24px',
                  borderRadius: 24,
                  border: `1px solid ${theme.line}`,
                  background:
                    index % 2 === 0
                      ? 'rgba(255,255,255,0.04)'
                      : 'rgba(255, 213, 106, 0.06)',
                }}
              >
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: theme.bg,
                    fontSize: 20,
                    fontFamily: theme.sans,
                    fontWeight: 700,
                    background: theme.gold,
                    boxShadow: `0 0 20px rgba(255, 213, 106, ${pulseStyle(frame, index * 5)})`,
                  }}
                >
                  {index + 1}
                </div>
                <div
                  style={{
                    marginTop: 20,
                    color: theme.text,
                    fontSize: 36,
                    fontFamily: theme.serif,
                  }}
                >
                  {step}
                </div>
                <div
                  style={{
                    marginTop: 10,
                    color: theme.muted,
                    fontSize: 22,
                    fontFamily: theme.sans,
                  }}
                >
                  {index < 4 ? '影响下游吞吐' : '推动下一轮能力增长'}
                </div>
                {index < loopSteps.length - 1 ? (
                  <div
                    style={{
                      position: 'absolute',
                      right: -14,
                      top: '50%',
                      width: 28,
                      height: 2,
                      background: `linear-gradient(90deg, ${theme.gold}, transparent)`,
                      opacity: 0.75,
                    }}
                  />
                ) : null}
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.05fr 0.95fr',
              gap: 24,
            }}
          >
            <div
              style={{
                padding: '24px 28px',
                borderRadius: 24,
                border: `1px solid ${theme.line}`,
                background: 'rgba(255,255,255,0.04)',
                color: theme.muted,
                fontSize: 24,
                lineHeight: 1.65,
                fontFamily: theme.sans,
              }}
            >
              所有状态变化都能通过 SSE 事件、快照、审计和回放复盘。这意味着玩法问题不是“看感觉调”，而是可以被定位、回放和验证。
            </div>
            <div
              style={{
                padding: '24px 28px',
                borderRadius: 24,
                border: `1px solid ${theme.gold}33`,
                background: 'rgba(255, 213, 106, 0.06)',
                color: theme.text,
                fontSize: 24,
                lineHeight: 1.7,
                fontFamily: theme.sans,
              }}
            >
              当前已确认跑通：
              <span style={{color: theme.gold}}> 研究 → 解锁 → 建造 → 生产 </span>
              主循环。
            </div>
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

const MetricsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <SceneFrame accent={theme.rose}>
      <div style={{display: 'grid', gridTemplateRows: 'auto 1fr', gap: 32, height: '100%'}}>
        <SceneHeading
          label="当前进度"
          title="这不是概念验证，它已经有一组可量化的骨架"
          body="截至 2026-03-22，文档和代码都已经沉淀出明确的规模。下面这些数字，代表它已经从零散模块，进入可持续演进的阶段。"
          accent={theme.rose}
        />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
            gap: 24,
          }}
        >
          {metrics.map((metric, index) => {
            const progress = spring({
              fps,
              frame: Math.max(0, frame - 14 - index * 5),
              config: {damping: 18, stiffness: 110},
            });

            const rawValue =
              metric.label === '物品 / 配方'
                ? metric.value
                : Math.round(metric.value * Math.min(progress, 1));

            return (
              <div
                key={metric.label}
                style={{
                  ...panelBase,
                  ...entranceStyle(frame, 10 + index * 4, 16, 28),
                  padding: '30px 32px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div
                  style={{
                    color: theme.muted,
                    fontSize: 24,
                    fontFamily: theme.sans,
                    letterSpacing: 2,
                  }}
                >
                  {metric.label}
                </div>
                <div
                  style={{
                    color: theme.text,
                    fontSize: 92,
                    lineHeight: 1,
                    fontFamily: theme.serif,
                    marginTop: 22,
                  }}
                >
                  {metric.label === '物品 / 配方' ? `${rawValue}${metric.suffix}` : `${rawValue}${metric.suffix}`}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            position: 'absolute',
            left: 108,
            right: 108,
            bottom: 92,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 18,
          }}
        >
          {statusHighlights.map((highlight, index) => (
            <div
              key={highlight}
              style={{
                ...entranceStyle(frame, 24 + index * 4, 14, 20),
                padding: '18px 20px',
                borderRadius: 20,
                border: `1px solid ${theme.rose}44`,
                background: 'rgba(255, 148, 182, 0.07)',
                color: theme.text,
                fontSize: 22,
                fontFamily: theme.sans,
                textAlign: 'center',
              }}
            >
              {highlight}
            </div>
          ))}
        </div>
      </div>
    </SceneFrame>
  );
};

const ClosingScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame accent={theme.coral}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.15fr 0.85fr',
          gap: 42,
          height: '100%',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={entranceStyle(frame, 0, 16, 26)}>
            <SectionKicker label="结语" accent={theme.coral} />
          </div>
          <div style={entranceStyle(frame, 6, 18, 42)}>
            <h2
              style={{
                margin: '28px 0 20px',
                color: theme.text,
                fontFamily: theme.serif,
                fontSize: 98,
                lineHeight: 1.04,
              }}
            >
              它不是一个前端壳，
              <br />
              而是一台正在成型的宇宙模拟器。
            </h2>
          </div>
          <div style={entranceStyle(frame, 12, 18, 46)}>
            <p
              style={{
                margin: 0,
                color: theme.muted,
                fontSize: 31,
                lineHeight: 1.7,
                fontFamily: theme.sans,
                maxWidth: 860,
              }}
            >
              如果说前面的系统是在解决“做什么”，那么命令、可见性、事件、审计与回放，解决的是“怎么让它长期演进而不失控”。
            </p>
          </div>

          <div
            style={{
              marginTop: 44,
              display: 'flex',
              gap: 18,
              flexWrap: 'wrap',
            }}
          >
            {futureFocus.map((item, index) => (
              <div
                key={item}
                style={{
                  ...entranceStyle(frame, 18 + index * 4, 14, 22),
                  padding: '18px 22px',
                  borderRadius: 20,
                  border: `1px solid ${theme.coral}55`,
                  background: 'rgba(255, 140, 106, 0.08)',
                  color: theme.text,
                  fontFamily: theme.sans,
                  fontSize: 24,
                }}
              >
                下一步：{item}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            ...panelBase,
            minHeight: 620,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              width: 720,
              height: 720,
              borderRadius: '50%',
              background:
                'radial-gradient(circle at 50% 50%, rgba(255,140,106,0.22), transparent 48%)',
              filter: 'blur(40px)',
            }}
          />
          {[0, 1, 2, 3].map((ring) => {
            const size = 210 + ring * 86;
            const rotation = frame * (0.08 + ring * 0.03);

            return (
              <div
                key={ring}
                style={{
                  position: 'absolute',
                  width: size,
                  height: size,
                  borderRadius: '50%',
                  border:
                    ring % 2 === 0
                      ? '2px solid rgba(255, 140, 106, 0.44)'
                      : '1px solid rgba(255, 255, 255, 0.1)',
                  transform: `rotate(${rotation}deg)`,
                }}
              />
            );
          })}
          <div
            style={{
              textAlign: 'center',
              padding: '0 40px',
            }}
          >
            <div
              style={{
                color: theme.coral,
                fontSize: 24,
                letterSpacing: 4,
                fontFamily: theme.sans,
              }}
            >
              SiliconWorld
            </div>
            <div
              style={{
                marginTop: 20,
                color: theme.text,
                fontSize: 74,
                lineHeight: 1.14,
                fontFamily: theme.serif,
              }}
            >
              硅基世界
            </div>
            <div
              style={{
                marginTop: 18,
                color: theme.muted,
                fontSize: 26,
                lineHeight: 1.7,
                fontFamily: theme.sans,
              }}
            >
              Go 服务端
              <br />
              TypeScript CLI
              <br />
              Remotion 项目介绍片
            </div>
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

export const SiliconWorldIntroVideo: React.FC = () => {
  return (
    <AbsoluteFill>
      <Audio
        src={staticFile('audio/bgm/ambient-bed.mp3')}
        volume={(f) =>
          interpolate(f, [0, 45, introDurationInFrames - 60, introDurationInFrames], [0, 0.09, 0.09, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
        }
      />
      {voiceoverTracks.map((track) => (
        <Sequence key={track.src} from={track.from}>
          <Audio src={staticFile(track.src)} volume={0.95} />
        </Sequence>
      ))}
      <Sequence durationInFrames={heroDuration}>
        <HeroScene />
      </Sequence>
      <Sequence from={heroDuration} durationInFrames={architectureDuration}>
        <ArchitectureScene />
      </Sequence>
      <Sequence
        from={heroDuration + architectureDuration}
        durationInFrames={systemsDuration}
      >
        <SystemsScene />
      </Sequence>
      <Sequence
        from={heroDuration + architectureDuration + systemsDuration}
        durationInFrames={loopDuration}
      >
        <LoopScene />
      </Sequence>
      <Sequence
        from={heroDuration + architectureDuration + systemsDuration + loopDuration}
        durationInFrames={metricsDuration}
      >
        <MetricsScene />
      </Sequence>
      <Sequence
        from={
          heroDuration +
          architectureDuration +
          systemsDuration +
          loopDuration +
          metricsDuration
        }
        durationInFrames={closingDuration}
      >
        <ClosingScene />
      </Sequence>
    </AbsoluteFill>
  );
};
