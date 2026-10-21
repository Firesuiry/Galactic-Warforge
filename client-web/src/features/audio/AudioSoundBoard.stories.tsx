import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import {
  getAmbientNames,
  getMix,
  getMusicName,
  isMuted,
  setAmbientLayers,
  setMix,
  setMuted,
  setMusic,
  sfx,
  unlockAudio,
  type AmbientName,
  type MusicName,
} from '@/engine/audio';
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
/** 声床层预设：贴地（风 + 机械两路叠加）/ 中空 / 轨道。 */
const AMBIENT_PRESETS: ReadonlyArray<{ label: string; layers: Array<{ name: AmbientName; level: number }> }> = [
  { label: '贴地（风 1.0 + 机械 0.126）', layers: [{ name: 'wind', level: 1 }, { name: 'factory', level: 0.126 }] },
  { label: '中空（风 0.5）', layers: [{ name: 'wind', level: 0.5 }] },
  { label: '轨道（space 1.0）', layers: [{ name: 'space', level: 1 }] },
];

function SoundBoard() {
  const [mix, setMixState] = useState(getMix());
  const [muted, setMutedState] = useState(isMuted());
  const [music, setMusicState] = useState<MusicName | null>(getMusicName());
  const [ambient, setAmbientState] = useState<AmbientName[]>(getAmbientNames());
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
        <strong>环境声床（可叠加；1.5s 交叉淡化）</strong>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {AMBIENT_PRESETS.map((preset) => (
            <button
              className="secondary-button"
              key={preset.label}
              onClick={() => {
                unlockAudio();
                setAmbientLayers(preset.layers);
                setAmbientState(getAmbientNames());
              }}
              type="button"
            >
              {preset.label}
            </button>
          ))}
          <button
            className="secondary-button"
            onClick={() => {
              setAmbientLayers([]);
              setAmbientState([]);
            }}
            type="button"
          >
            停止声床
          </button>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          当前：{ambient.length > 0 ? ambient.join(' + ') : '无'}
        </span>
      </div>

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
