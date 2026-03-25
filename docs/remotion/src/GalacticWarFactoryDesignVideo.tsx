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
  aiCommandExamples,
  aiPipeline,
  aiPrinciples,
  communityBadges,
  communityGroupNumber,
  designHeroTags,
  designOfficialName,
  roadmapItems,
  warCards,
  warStages,
} from './galacticWarFactoryData';
import {theme} from './theme';

const heroDuration = 204;
const aiDuration = 336;
const warDuration = 360;
const roadmapDuration = 324;
const communityDuration = 336;

export const galacticWarFactoryDesignDurationInFrames =
  heroDuration + aiDuration + warDuration + roadmapDuration + communityDuration;

const voiceoverTracks = [
  {from: 12, src: 'audio/design/voiceover/scene-01-hero.mp3'},
  {from: heroDuration + 12, src: 'audio/design/voiceover/scene-02-ai.mp3'},
  {
    from: heroDuration + aiDuration + 12,
    src: 'audio/design/voiceover/scene-03-war.mp3',
  },
  {
    from: heroDuration + aiDuration + warDuration + 12,
    src: 'audio/design/voiceover/scene-04-roadmap.mp3',
  },
  {
    from: heroDuration + aiDuration + warDuration + roadmapDuration + 12,
    src: 'audio/design/voiceover/scene-05-community.mp3',
  },
] as const;

const stars = Array.from({length: 80}, (_, index) => ({
  id: index,
  left: ((index * 73 + 19) % 1000) / 10,
  top: ((index * 47 + 83) % 1000) / 10,
  size: 2 + (index % 4),
  speed: 0.22 + (index % 5) * 0.05,
  opacity: 0.14 + (index % 6) * 0.1,
}));

const battleNodes = [
  {id: 'north', x: 23, y: 18, color: theme.coral, label: '玩家 A'},
  {id: 'east', x: 79, y: 34, color: theme.gold, label: '玩家 B'},
  {id: 'south', x: 65, y: 78, color: theme.cyan, label: '玩家 C'},
  {id: 'west', x: 18, y: 66, color: theme.mint, label: '玩家 D'},
];

const panelBase: CSSProperties = {
  background: 'rgba(19, 17, 24, 0.76)',
  border: '1px solid rgba(255, 205, 168, 0.14)',
  borderRadius: 28,
  boxShadow: '0 26px 90px rgba(0, 0, 0, 0.34)',
  backdropFilter: 'blur(14px)',
};

const scenePadding: CSSProperties = {
  padding: '90px 104px',
};

const entranceStyle = (
  frame: number,
  delay = 0,
  duration = 18,
  distance = 40,
): CSSProperties => {
  const progress = interpolate(frame, [delay, delay + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const eased = Easing.out(Easing.cubic)(progress);

  return {
    opacity: progress,
    transform: `translateY(${(1 - eased) * distance}px) scale(${0.96 + eased * 0.04})`,
  };
};

const pulse = (frame: number, offset = 0) =>
  0.65 + ((Math.sin((frame + offset) / 16) + 1) / 2) * 0.35;

const lineBetween = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
): CSSProperties => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

  return {
    position: 'absolute',
    left: `${x1}%`,
    top: `${y1}%`,
    width: `${length}%`,
    height: 2,
    transformOrigin: '0 50%',
    transform: `rotate(${angle}deg)`,
    background: `linear-gradient(90deg, ${color}, rgba(255,255,255,0.08))`,
    opacity: 0.7,
  };
};

const Starfield: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <>
      {stars.map((star) => {
        const drift = ((frame * star.speed + star.id * 9) % 220) / 18;
        const twinkle = 0.48 + Math.sin(frame * star.speed * 0.15 + star.id) * 0.22;

        return (
          <div
            key={star.id}
            style={{
              position: 'absolute',
              left: `${star.left}%`,
              top: `calc(${star.top}% + ${drift}px)`,
              width: star.size,
              height: star.size,
              borderRadius: star.size,
              backgroundColor: '#fff7e9',
              boxShadow: `0 0 ${star.size * 8}px rgba(255, 236, 214, 0.75)`,
              opacity: star.opacity * twinkle,
            }}
          />
        );
      })}
    </>
  );
};

const SceneFrame: React.FC<{accent: string; children: React.ReactNode}> = ({
  accent,
  children,
}) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 42) * 90;

  return (
    <AbsoluteFill style={{overflow: 'hidden', background: '#080a10'}}>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at 16% 18%, rgba(255, 140, 106, 0.18), transparent 28%), radial-gradient(circle at 82% 18%, rgba(255, 213, 106, 0.16), transparent 26%), radial-gradient(circle at 58% 78%, rgba(119, 242, 255, 0.14), transparent 30%), linear-gradient(180deg, #1a1013 0%, #070a10 58%, #04070d 100%)',
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(rgba(255, 214, 166, 0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 214, 166, 0.07) 1px, transparent 1px)',
          backgroundSize: '124px 124px',
          opacity: 0.18,
          transform: `translate3d(${drift * 0.05}px, ${drift * 0.03}px, 0)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, ${accent}20 0%, transparent 50%)`,
          filter: 'blur(48px)',
          transform: `scale(${1.03 + Math.sin(frame / 28) * 0.02})`,
        }}
      />
      <Starfield />
      <AbsoluteFill style={scenePadding}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

const SectionKicker: React.FC<{label: string; accent: string}> = ({
  label,
  accent,
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
      }}
    >
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 999,
          background: accent,
          boxShadow: `0 0 18px ${accent}`,
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
      <div style={entranceStyle(frame, 0, 18, 22)}>
        <SectionKicker label={label} accent={accent} />
      </div>
      <div style={entranceStyle(frame, 6, 18, 38)}>
        <h2
          style={{
            margin: '28px 0 18px',
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
      <div style={entranceStyle(frame, 12, 18, 44)}>
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
  const reveal = spring({
    fps,
    frame,
    config: {damping: 18, stiffness: 84},
  });

  return (
    <SceneFrame accent={theme.coral}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.14fr 0.86fr',
          height: '100%',
          alignItems: 'center',
          gap: 42,
        }}
      >
        <div>
          <div style={entranceStyle(frame, 0, 18, 22)}>
            <SectionKicker label="正式名称" accent={theme.coral} />
          </div>
          <div style={entranceStyle(frame, 6, 18, 38)}>
            <h1
              style={{
                margin: '30px 0 18px',
                fontSize: 120,
                lineHeight: 0.98,
                color: theme.text,
                fontFamily: theme.serif,
              }}
            >
              {designOfficialName}
            </h1>
          </div>
          <div style={entranceStyle(frame, 12, 18, 44)}>
            <p
              style={{
                margin: 0,
                maxWidth: 860,
                color: theme.muted,
                fontSize: 34,
                lineHeight: 1.58,
                fontFamily: theme.sans,
              }}
            >
              一款围绕星系扩张、AI 自动施工和多人战争展开的游戏。它想做的不是“更忙的摆放模拟”，而是“更聪明的宇宙战争工厂”。
            </p>
          </div>
          <div
            style={{
              marginTop: 42,
              display: 'flex',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            {designHeroTags.map((tag, index) => (
              <div
                key={tag}
                style={{
                  ...entranceStyle(frame, 18 + index * 4, 14, 18),
                  padding: '14px 22px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(255,255,255,0.04)',
                  color: theme.text,
                  fontSize: 24,
                  fontFamily: theme.sans,
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
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            transform: `scale(${0.94 + reveal * 0.06})`,
          }}
        >
          {[0, 1, 2].map((ring) => {
            const size = 290 + ring * 110;
            const rotation = frame * (0.12 + ring * 0.04);

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
                      ? '2px solid rgba(255, 140, 106, 0.45)'
                      : '1px solid rgba(255, 236, 214, 0.12)',
                  transform: `rotate(${rotation}deg)`,
                }}
              >
                {[0, 1, 2, 3].map((node) => (
                  <div
                    key={`${ring}-${node}`}
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background:
                        node % 2 === 0 ? theme.coral : node % 3 === 0 ? theme.cyan : theme.gold,
                      boxShadow: `0 0 16px ${
                        node % 2 === 0 ? theme.coral : node % 3 === 0 ? theme.cyan : theme.gold
                      }`,
                      transform: `rotate(${node * 90}deg) translateX(${size / 2}px)`,
                    }}
                  />
                ))}
              </div>
            );
          })}

          <div
            style={{
              ...panelBase,
              width: 410,
              padding: '36px 34px',
              textAlign: 'center',
              transform: `translateY(${Math.sin(frame / 24) * 10}px)`,
            }}
          >
            <div
              style={{
                color: theme.coral,
                fontFamily: theme.sans,
                fontSize: 22,
                letterSpacing: 4,
              }}
            >
              CORE CONCEPT
            </div>
            <div
              style={{
                marginTop: 16,
                color: theme.text,
                fontFamily: theme.serif,
                fontSize: 58,
                lineHeight: 1.12,
              }}
            >
              玩家给方向
              <br />
              AI 去干活
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
              在大星系里扩基地、抢资源、造舰队，
              <br />
              最终打成一场多人混战。
            </div>
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

const AIDrivenScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame accent={theme.gold}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '0.94fr 1.06fr',
          gap: 40,
          height: '100%',
          alignItems: 'center',
        }}
      >
        <SceneHeading
          label="设计核心 01"
          title="用户不再精确摆位，而是让 AI 执行意图"
          body="玩家的输入从“怎么摆每个建筑”，转成“我要达成什么结果”。AI 负责规划布局、施工顺序、基础布线与运营细节。"
          accent={theme.gold}
        />

        <div style={{display: 'grid', gridTemplateRows: 'auto auto auto', gap: 24}}>
          <div
            style={{
              ...panelBase,
              ...entranceStyle(frame, 10, 18, 28),
              padding: '28px 28px 30px',
            }}
          >
            <div
              style={{
                color: theme.gold,
                fontSize: 22,
                letterSpacing: 3,
                fontFamily: theme.sans,
              }}
            >
              INTENT PIPELINE
            </div>
            <div
              style={{
                marginTop: 22,
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 16,
              }}
            >
              {aiPipeline.map((item, index) => (
                <div
                  key={item}
                  style={{
                    padding: '22px 18px',
                    borderRadius: 22,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background:
                      index === 1 || index === 2
                        ? 'rgba(255, 213, 106, 0.08)'
                        : 'rgba(255,255,255,0.04)',
                    color: theme.text,
                    fontSize: 26,
                    lineHeight: 1.45,
                    fontFamily: theme.sans,
                    textAlign: 'center',
                  }}
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 18,
            }}
          >
            {aiPrinciples.map((item, index) => (
              <div
                key={item.title}
                style={{
                  ...panelBase,
                  ...entranceStyle(frame, 18 + index * 4, 16, 22),
                  padding: '26px 24px',
                  minHeight: 250,
                }}
              >
                <div
                  style={{
                    color: theme.text,
                    fontSize: 38,
                    fontFamily: theme.serif,
                  }}
                >
                  {item.title}
                </div>
                <div
                  style={{
                    marginTop: 14,
                    color: theme.muted,
                    fontSize: 24,
                    lineHeight: 1.7,
                    fontFamily: theme.sans,
                  }}
                >
                  {item.body}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              ...panelBase,
              ...entranceStyle(frame, 32, 18, 24),
              padding: '22px 24px',
              display: 'flex',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            {aiCommandExamples.map((item) => (
              <div
                key={item}
                style={{
                  padding: '14px 18px',
                  borderRadius: 999,
                  border: `1px solid ${theme.gold}55`,
                  background: 'rgba(255, 213, 106, 0.08)',
                  color: theme.text,
                  fontSize: 22,
                  fontFamily: theme.sans,
                }}
              >
                指令示例：{item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

const MultiplayerWarScene: React.FC = () => {
  const frame = useCurrentFrame();
  const centerX = 50;
  const centerY = 50;

  return (
    <SceneFrame accent={theme.cyan}>
      <div style={{display: 'grid', gridTemplateRows: 'auto 1fr', gap: 30, height: '100%'}}>
        <SceneHeading
          label="设计核心 02"
          title="庞大星系里的多人混战，从零开局打到星际会战"
          body="这不是单人后勤模拟，而是多名玩家在同一片星系内扩张、争夺、压制与反扑。最终形态，是一场跨星球、跨轨道的星际红警式混战。"
          accent={theme.cyan}
        />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.06fr 0.94fr',
            gap: 24,
          }}
        >
          <div
            style={{
              ...panelBase,
              ...entranceStyle(frame, 12, 18, 24),
              minHeight: 560,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'radial-gradient(circle at 50% 50%, rgba(119, 242, 255, 0.12), transparent 42%)',
              }}
            />

            {battleNodes.map((node) => (
              <div key={`line-${node.id}`} style={lineBetween(node.x, node.y, centerX, centerY, node.color)} />
            ))}

            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: 140,
                height: 140,
                marginLeft: -70,
                marginTop: -70,
                borderRadius: '50%',
                background:
                  'radial-gradient(circle, rgba(255, 245, 220, 0.92), rgba(255, 174, 102, 0.38) 62%, transparent 72%)',
                boxShadow: '0 0 36px rgba(255, 206, 138, 0.38)',
              }}
            />

            {battleNodes.map((node, index) => (
              <div
                key={node.id}
                style={{
                  position: 'absolute',
                  left: `${node.x}%`,
                  top: `${node.y}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div
                  style={{
                    width: 68,
                    height: 68,
                    borderRadius: '50%',
                    background: node.color,
                    boxShadow: `0 0 24px ${node.color}`,
                    opacity: pulse(frame, index * 7),
                  }}
                />
                <div
                  style={{
                    marginTop: 12,
                    padding: '8px 14px',
                    borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(0,0,0,0.24)',
                    color: theme.text,
                    fontSize: 20,
                    fontFamily: theme.sans,
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {node.label}
                </div>
              </div>
            ))}

            {battleNodes.map((node, index) => {
              const travel = ((frame * (0.35 + index * 0.03)) % 100) / 100;
              const x = node.x + (centerX - node.x) * travel;
              const y = node.y + (centerY - node.y) * travel;

              return (
                <div
                  key={`pulse-${node.id}`}
                  style={{
                    position: 'absolute',
                    left: `${x}%`,
                    top: `${y}%`,
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: '#fff4e0',
                    boxShadow: '0 0 14px rgba(255,255,255,0.9)',
                  }}
                />
              );
            })}

            <div
              style={{
                position: 'absolute',
                left: 26,
                right: 26,
                bottom: 24,
                display: 'flex',
                gap: 14,
                flexWrap: 'wrap',
              }}
            >
              {warStages.map((item, index) => (
                <div
                  key={item}
                  style={{
                    padding: '12px 16px',
                    borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background:
                      index === warStages.length - 1
                        ? 'rgba(255, 140, 106, 0.14)'
                        : 'rgba(255,255,255,0.05)',
                    color: theme.text,
                    fontSize: 22,
                    fontFamily: theme.sans,
                  }}
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateRows: 'repeat(4, minmax(0, 1fr))',
              gap: 18,
            }}
          >
            {warCards.map((item, index) => (
              <div
                key={item.title}
                style={{
                  ...panelBase,
                  ...entranceStyle(frame, 18 + index * 4, 16, 18),
                  padding: '24px 24px 26px',
                }}
              >
                <div
                  style={{
                    color: theme.text,
                    fontSize: 34,
                    fontFamily: theme.serif,
                  }}
                >
                  {item.title}
                </div>
                <div
                  style={{
                    marginTop: 10,
                    color: theme.muted,
                    fontSize: 22,
                    lineHeight: 1.7,
                    fontFamily: theme.sans,
                  }}
                >
                  {item.body}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

const RoadmapScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame accent={theme.mint}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '0.92fr 1.08fr',
          gap: 36,
          height: '100%',
          alignItems: 'center',
        }}
      >
        <SceneHeading
          label="设计补充"
          title="完全开源，先把逻辑服务器做扎实，再推进渲染层"
          body="开发路线会刻意避免“先堆画面、后补规则”。项目会优先把游戏逻辑服务器、多人与 AI 行为规则打牢，再继续做渲染服务器与引擎。"
          accent={theme.mint}
        />

        <div style={{display: 'grid', gridTemplateRows: 'auto auto', gap: 22}}>
          <div
            style={{
              ...panelBase,
              ...entranceStyle(frame, 10, 18, 24),
              padding: '26px 28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 20,
            }}
          >
            <div>
              <div
                style={{
                  color: theme.text,
                  fontSize: 56,
                  fontFamily: theme.serif,
                }}
              >
                开源优先
              </div>
              <div
                style={{
                  marginTop: 10,
                  color: theme.muted,
                  fontSize: 24,
                  lineHeight: 1.7,
                  fontFamily: theme.sans,
                  maxWidth: 620,
                }}
              >
                玩法设计、规则验证、AI 工作流和服务器实现都会公开协作，方便更多人一起迭代。
              </div>
            </div>
            <div
              style={{
                width: 148,
                height: 148,
                borderRadius: 28,
                background: 'linear-gradient(135deg, rgba(142,247,165,0.18), rgba(119,242,255,0.12))',
                border: '1px solid rgba(142,247,165,0.28)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: theme.mint,
                fontSize: 34,
                fontFamily: theme.sans,
                fontWeight: 700,
              }}
            >
              OPEN
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 18,
            }}
          >
            {roadmapItems.map((item, index) => (
              <div
                key={item.title}
                style={{
                  ...panelBase,
                  ...entranceStyle(frame, 18 + index * 4, 16, 20),
                  padding: '24px 22px 26px',
                  minHeight: 320,
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background:
                      index === 0 ? theme.mint : index === 1 ? theme.gold : theme.cyan,
                    boxShadow: `0 0 14px ${
                      index === 0 ? theme.mint : index === 1 ? theme.gold : theme.cyan
                    }`,
                  }}
                />
                <div
                  style={{
                    marginTop: 18,
                    color: theme.text,
                    fontSize: 38,
                    lineHeight: 1.2,
                    fontFamily: theme.serif,
                  }}
                >
                  {item.title}
                </div>
                <div
                  style={{
                    marginTop: 14,
                    color: theme.muted,
                    fontSize: 23,
                    lineHeight: 1.68,
                    fontFamily: theme.sans,
                  }}
                >
                  {item.body}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

const CommunityScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame accent={theme.rose}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 36,
          height: '100%',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={entranceStyle(frame, 0, 18, 20)}>
            <SectionKicker label="一起共建" accent={theme.rose} />
          </div>
          <div style={entranceStyle(frame, 6, 18, 34)}>
            <h2
              style={{
                margin: '28px 0 18px',
                color: theme.text,
                fontFamily: theme.serif,
                fontSize: 94,
                lineHeight: 1.04,
              }}
            >
              欢迎一起交流，
              <br />
              共建这款游戏。
            </h2>
          </div>
          <div style={entranceStyle(frame, 12, 18, 40)}>
            <p
              style={{
                margin: 0,
                color: theme.muted,
                fontSize: 30,
                lineHeight: 1.72,
                fontFamily: theme.sans,
                maxWidth: 820,
              }}
            >
              如果你对玩法设计、服务器架构、AI 自动化、多人的战争系统，或者开源协作本身感兴趣，这个项目欢迎你一起加入。
            </p>
          </div>
          <div
            style={{
              marginTop: 40,
              display: 'flex',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            {communityBadges.map((item, index) => (
              <div
                key={item}
                style={{
                  ...entranceStyle(frame, 18 + index * 4, 14, 18),
                  padding: '14px 18px',
                  borderRadius: 999,
                  border: `1px solid ${theme.rose}55`,
                  background: 'rgba(255, 148, 182, 0.08)',
                  color: theme.text,
                  fontSize: 22,
                  fontFamily: theme.sans,
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            ...panelBase,
            ...entranceStyle(frame, 10, 20, 18),
            minHeight: 620,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '34px 38px',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'radial-gradient(circle at 50% 28%, rgba(255, 148, 182, 0.16), transparent 32%), radial-gradient(circle at 50% 78%, rgba(255, 213, 106, 0.1), transparent 28%)',
            }}
          />
          <div
            style={{
              position: 'relative',
              color: theme.rose,
              fontSize: 22,
              letterSpacing: 4,
              fontFamily: theme.sans,
            }}
          >
            QQ GROUP
          </div>
          <div
            style={{
              position: 'relative',
              marginTop: 24,
              color: theme.text,
              fontSize: 100,
              lineHeight: 1,
              fontFamily: theme.serif,
            }}
          >
            {communityGroupNumber}
          </div>
          <div
            style={{
              position: 'relative',
              marginTop: 26,
              color: theme.text,
              fontSize: 40,
              lineHeight: 1.4,
              fontFamily: theme.serif,
            }}
          >
            {designOfficialName}
          </div>
          <div
            style={{
              position: 'relative',
              marginTop: 16,
              color: theme.muted,
              fontSize: 26,
              lineHeight: 1.7,
              fontFamily: theme.sans,
            }}
          >
            欢迎加入群聊交流玩法、架构与实现。
            <br />
            这场战争，欢迎一起把它做出来。
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

export const GalacticWarFactoryDesignVideo: React.FC = () => {
  return (
    <AbsoluteFill>
      <Audio
        src={staticFile('audio/design/bgm/war-room-bed.mp3')}
        volume={(f) =>
          interpolate(
            f,
            [0, 45, galacticWarFactoryDesignDurationInFrames - 60, galacticWarFactoryDesignDurationInFrames],
            [0, 0.1, 0.1, 0],
            {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            },
          )
        }
      />
      {voiceoverTracks.map((track) => (
        <Sequence key={track.src} from={track.from}>
          <Audio src={staticFile(track.src)} volume={0.96} />
        </Sequence>
      ))}

      <Sequence durationInFrames={heroDuration}>
        <HeroScene />
      </Sequence>
      <Sequence from={heroDuration} durationInFrames={aiDuration}>
        <AIDrivenScene />
      </Sequence>
      <Sequence from={heroDuration + aiDuration} durationInFrames={warDuration}>
        <MultiplayerWarScene />
      </Sequence>
      <Sequence
        from={heroDuration + aiDuration + warDuration}
        durationInFrames={roadmapDuration}
      >
        <RoadmapScene />
      </Sequence>
      <Sequence
        from={heroDuration + aiDuration + warDuration + roadmapDuration}
        durationInFrames={communityDuration}
      >
        <CommunityScene />
      </Sequence>
    </AbsoluteFill>
  );
};
