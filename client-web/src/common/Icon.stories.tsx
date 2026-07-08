import type { Meta, StoryObj } from '@storybook/react-vite';

import { Icon } from '@/common/Icon';

const meta = {
  title: 'Common/Icon',
  component: Icon,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    iconKey: { control: 'text' },
    color: { control: 'color' },
    size: { control: { type: 'number', min: 12, max: 96, step: 4 } },
    label: { control: 'text' },
  },
  args: { iconKey: 'mining_machine', color: '#39e6d0', size: 32 },
} satisfies Meta<typeof Icon>;

export default meta;

type Story = StoryObj<typeof meta>;

const CATALOG_SAMPLES: Array<{ iconKey: string; color: string; label: string }> = [
  { iconKey: 'mining_machine', color: '#ffb454', label: '采矿机' },
  { iconKey: 'assembling_machine_mk1', color: '#5fb0ff', label: '组装机' },
  { iconKey: 'tesla_tower', color: '#39e6d0', label: '特斯拉塔' },
  { iconKey: 'lab', color: '#6ee7b7', label: '研究站' },
  { iconKey: 'logistics_station', color: '#5fb0ff', label: '物流站' },
  { iconKey: 'em_rail_ejector', color: '#39e6d0', label: '电磁弹射器' },
  { iconKey: 'vertical_launching_silo', color: '#ffb454', label: '垂直发射井' },
  { iconKey: 'ray_receiver', color: '#5fb0ff', label: '射线接收塔' },
  { iconKey: 'artificial_star', color: '#ffd66b', label: '人造恒星' },
  { iconKey: 'iron_ore', color: '#9aa6b2', label: '铁矿' },
  { iconKey: 'copper_ore', color: '#e08a3c', label: '铜矿' },
  { iconKey: 'coal', color: '#5a5f6b', label: '煤' },
  { iconKey: 'stone', color: '#c7bfa6', label: '石矿' },
  { iconKey: 'oil', color: '#6b4f2a', label: '原油' },
  { iconKey: 'silicon_ore', color: '#5fb0ff', label: '硅矿' },
  { iconKey: 'water', color: '#3aa6ff', label: '水' },
  { iconKey: 'gear', color: '#8fa3c8', label: '齿轮' },
  { iconKey: 'worker', color: '#6ee7b7', label: '工程兵' },
  { iconKey: 'soldier', color: '#ff5757', label: '士兵' },
  { iconKey: 'executor', color: '#39e6d0', label: '执行者' },
];

export const CatalogGrid: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
        gap: 14,
        padding: 16,
        width: 640,
        background: 'rgba(8,16,32,0.6)',
        borderRadius: 12,
      }}
    >
      {CATALOG_SAMPLES.map(({ iconKey, color, label }) => (
        <div key={iconKey} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <Icon iconKey={iconKey} color={color} size={36} label={label} />
          <code style={{ color: '#8fa3c8', fontSize: 11 }}>{iconKey}</code>
        </div>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, padding: 16 }}>
      {[16, 24, 32, 48, 64].map((s) => (
        <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <Icon iconKey="tesla_tower" color="#39e6d0" size={s} />
          <code style={{ color: '#8fa3c8', fontSize: 11 }}>{s}px</code>
        </div>
      ))}
    </div>
  ),
};

export const Colors: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, padding: 16 }}>
      <Icon iconKey="executor" color="#39e6d0" size={40} label="己方" />
      <Icon iconKey="soldier" color="#ff5757" size={40} label="敌方" />
      <Icon iconKey="lab" color="#ffb454" size={40} label="能量" />
      <Icon iconKey="logistics_station" color="#5fb0ff" size={40} label="物流" />
      <Icon iconKey="mining_machine" size={40} label="默认色" />
    </div>
  ),
};

export const Fallback: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, padding: 16, alignItems: 'center' }}>
      <Icon iconKey="unknown_future_building" color="#5fb0ff" size={36} label="未知 key 回退首字母" />
      <Icon color="#5fb0ff" size={36} label="缺 key 回退问号" />
      <span style={{ color: '#8fa3c8', fontSize: 13 }}>↑ 未命中映射：首字母大写 / 缺省问号</span>
    </div>
  ),
};
