import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { getMix, getMusicName, isMuted, setMix, setMuted, setMusic, sfx, unlockAudio, type MusicName } from '@/engine/audio';
import { AudioMixSliders } from '@/widgets/TopNav';

/**
 * 音频试听板（第 23 轮）：列出全部采样音效、声床与配乐，供人工试听与验收。
 * 点击任意按钮即触发浏览器手势解锁（unlockAudio），之后声音才可播。
 * 混音滑条与顶栏设置面板同一组件（AudioMixSliders），方便听不同总线的相对电平。
 */
const meta = {
  title: 'Audio/SoundBoard',
  component: SoundBoard,
  parameters: { layout: 'centered', backgrounds: { default: 'deep-space' } },
} satisfies Meta<typeof SoundBoard>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 试听板只列「点一下就能播」的音效（explosionAt 需要距离参数，由战斗映射调用）。 */
type SfxKey = Exclude<keyof typeof sfx, 'explosionAt'>;

const SFX_GROUPS: ReadonlyArray<{ title: string; items: SfxKey[] }> = [
  { title: '开火（按炮塔）', items: ['fireGauss', 'fireLaser', 'fireMissile', 'firePlasma', 'fireGeneric'] },
  { title: '战斗', items: ['explosion', 'explosionNear', 'explosionFar', 'intercept', 'hit'] },
  { title: '建造', items: ['buildPlace', 'beltPlace', 'demolish', 'buildComplete', 'constructionComplete'] },
  { title: '指令与单位', items: ['commandOk', 'commandFail', 'unitSelect', 'unitAck', 'orderMove', 'orderAttack'] },
  { title: '提示与 UI', items: ['alert', 'notify', 'uiClick', 'uiHover', 'uiPanelOpen', 'uiPanelClose', 'researchComplete'] },
];

const MUSIC: MusicName[] = ['calm', 'tense', 'combat'];

function SoundBoard() {
  const [mix, setMixState] = useState(getMix());
  const [muted, setMutedState] = useState(isMuted());
  const [music, setMusicState] = useState<MusicName | null>(getMusicName());
  const [lastPlayed, setLastPlayed] = useState<string>('—');

  // 首次交互解锁（浏览器自动播放策略）。
  useEffect(() => {
    unlockAudio();
  }, []);

  function play(name: SfxKey) {
    unlockAudio();
    (sfx[name] as () => void)();
    setLastPlayed(name);
  }

  return (
    <div style={{ display: 'grid', gap: 18, width: 720, padding: 20, color: 'var(--text)' }}>
      <div className="panel" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <strong>混音</strong>
        <AudioMixSliders
          mix={mix}
          muted={muted}
          onChange={(bus, value) => {
            setMix({ [bus]: value });
            setMixState(getMix());
          }}
          onToggleMute={() => {
            const next = !muted;
            setMuted(next);
            setMutedState(next);
          }}
        />
      </div>

      {SFX_GROUPS.map((group) => (
        <div className="panel" key={group.title} style={{ padding: 14, display: 'grid', gap: 8 }}>
          <strong>{group.title}</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {group.items.map((name) => (
              <button className="secondary-button" key={name} onClick={() => play(name)} type="button">
                {name}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="panel" style={{ padding: 14, display: 'grid', gap: 8 }}>
        <strong>配乐（3s 交叉淡化）</strong>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {MUSIC.map((name) => (
            <button
              className={music === name ? 'primary-button' : 'secondary-button'}
              key={name}
              onClick={() => {
                unlockAudio();
                setMusic(name);
                setMusicState(name);
              }}
              type="button"
            >
              {name}
            </button>
          ))}
          <button
            className="secondary-button"
            onClick={() => {
              setMusic(null);
              setMusicState(null);
            }}
            type="button"
          >
            停止配乐
          </button>
        </div>
      </div>

      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>最近播放：{lastPlayed}</div>
    </div>
  );
}

export const Board: Story = { render: () => <SoundBoard /> };
