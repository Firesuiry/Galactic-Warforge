import type { Meta, StoryObj } from '@storybook/react-vite';

import { Icon } from '@/common/Icon';
import { ICON_MAP } from '@/common/icon-map';

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

/** 全套映射按语义分类（资源/建筑/单位/UI），key 与 ICON_MAP 一一对应。 */
const ICON_GROUPS: Array<{
  title: string;
  entries: Array<{ iconKey: string; color: string; label: string }>;
}> = [
  {
    title: '资源',
    entries: [
      { iconKey: 'iron_ore', color: '#9aa6b2', label: '铁矿' },
      { iconKey: 'copper_ore', color: '#e08a3c', label: '铜矿' },
      { iconKey: 'stone', color: '#c7bfa6', label: '石矿' },
      { iconKey: 'silicon_ore', color: '#5fb0ff', label: '硅矿' },
      { iconKey: 'coal', color: '#8b8f9b', label: '煤' },
      { iconKey: 'oil', color: '#a07830', label: '原油' },
      { iconKey: 'water', color: '#3aa6ff', label: '水' },
      { iconKey: 'fire_ice', color: '#9be7ff', label: '可燃冰' },
      { iconKey: 'gear', color: '#8fa3c8', label: '齿轮' },
    ],
  },
  {
    title: '建筑 · 采集/生产',
    entries: [
      { iconKey: 'mining_machine', color: '#ffb454', label: '采矿机' },
      { iconKey: 'advanced_mining_machine', color: '#63e6be', label: '高级采矿机' },
      { iconKey: 'oil_extractor', color: '#9c8ade', label: '原油萃取' },
      { iconKey: 'water_pump', color: '#74c0fc', label: '水泵' },
      { iconKey: 'assembling_machine_mk1', color: '#5fb0ff', label: '组装机' },
      { iconKey: 'arc_smelter', color: '#ffa94d', label: '电弧熔炉' },
      { iconKey: 'chemical_plant', color: '#94d82d', label: '化工厂' },
      { iconKey: 'oil_refinery', color: '#ff8787', label: '炼油厂' },
      { iconKey: 'fractionator', color: '#ffa94d', label: '分馏塔' },
      { iconKey: 'spray_coater', color: '#94d82d', label: '喷涂机' },
      { iconKey: 'miniature_particle_collider', color: '#b197fc', label: '粒子对撞机' },
    ],
  },
  {
    title: '建筑 · 能源',
    entries: [
      { iconKey: 'solar_panel', color: '#ffd66b', label: '太阳能板' },
      { iconKey: 'wind_turbine', color: '#e8f4ff', label: '风力涡轮' },
      { iconKey: 'tesla_tower', color: '#39e6d0', label: '特斯拉塔' },
      { iconKey: 'wireless_power_tower', color: '#74c0fc', label: '无线输电塔' },
      { iconKey: 'thermal_power_plant', color: '#ff8787', label: '火电厂' },
      { iconKey: 'geothermal_power_station', color: '#ff922b', label: '地热电站' },
      { iconKey: 'mini_fusion_power_plant', color: '#ffe066', label: '聚变电站' },
      { iconKey: 'accumulator', color: '#ffe066', label: '蓄电器' },
      { iconKey: 'energy_exchanger', color: '#ffa94d', label: '能量枢纽' },
    ],
  },
  {
    title: '建筑 · 科研/情报',
    entries: [
      { iconKey: 'lab', color: '#6ee7b7', label: '研究站' },
      { iconKey: 'matrix_lab', color: '#7dd3fc', label: '矩阵研究站' },
      { iconKey: 'self_evolution_lab', color: '#b197fc', label: '自演化研究站' },
      { iconKey: 'battlefield_analysis_base', color: '#c4b5fd', label: '战情分析基地' },
    ],
  },
  {
    title: '建筑 · 仓储/物流',
    entries: [
      { iconKey: 'depot_mk1', color: '#ffd43b', label: '仓库' },
      { iconKey: 'storage_tank', color: '#74c0fc', label: '储液罐' },
      { iconKey: 'logistics_station', color: '#5fb0ff', label: '物流站' },
      { iconKey: 'interstellar_logistics_station', color: '#4dd4fa', label: '星际物流站' },
      { iconKey: 'logistics_distributor', color: '#63e6be', label: '物流配送器' },
      { iconKey: 'conveyor_belt_mk1', color: '#8fa3c8', label: '传送带' },
      { iconKey: 'splitter', color: '#8fa3c8', label: '分流器' },
      { iconKey: 'sorter_mk1', color: '#8fa3c8', label: '分拣器' },
      { iconKey: 'traffic_monitor', color: '#8fa3c8', label: '流量监测器' },
    ],
  },
  {
    title: '建筑 · 防御/军事',
    entries: [
      { iconKey: 'laser_turret', color: '#ff8787', label: '激光塔' },
      { iconKey: 'gauss_turret', color: '#ffa94d', label: '高斯塔' },
      { iconKey: 'missile_turret', color: '#ff8787', label: '导弹塔' },
      { iconKey: 'plasma_turret', color: '#b197fc', label: '等离子塔' },
      { iconKey: 'implosion_cannon', color: '#ff6b6b', label: '内爆炮' },
      { iconKey: 'planetary_shield_generator', color: '#63e6be', label: '行星护盾' },
      { iconKey: 'signal_tower', color: '#ffd43b', label: '信号塔' },
      { iconKey: 'jammer_tower', color: '#b197fc', label: '干扰塔' },
    ],
  },
  {
    title: '建筑 · 戴森球/航天',
    entries: [
      { iconKey: 'em_rail_ejector', color: '#fcd34d', label: '电磁弹射器' },
      { iconKey: 'vertical_launching_silo', color: '#ffa94d', label: '垂直发射井' },
      { iconKey: 'ray_receiver', color: '#c4b5fd', label: '射线接收站' },
      { iconKey: 'artificial_star', color: '#ffd66b', label: '人造恒星' },
      { iconKey: 'orbital_collector', color: '#ffe066', label: '轨道采集器' },
    ],
  },
  {
    title: '单位',
    entries: [
      { iconKey: 'worker', color: '#6ee7b7', label: '工程兵' },
      { iconKey: 'soldier', color: '#ff5757', label: '士兵' },
      { iconKey: 'executor', color: '#39e6d0', label: '执行者' },
    ],
  },
  {
    title: 'UI 语义',
    entries: [
      { iconKey: 'build', color: '#ffb454', label: '建造' },
      { iconKey: 'tech', color: '#5fb0ff', label: '科技' },
      { iconKey: 'power', color: '#39e6d0', label: '电力' },
      { iconKey: 'energy', color: '#ffe066', label: '能量' },
      { iconKey: 'logistics', color: '#5fb0ff', label: '物流' },
      { iconKey: 'fleet', color: '#8fa3c8', label: '舰队' },
      { iconKey: 'planet', color: '#6ee7b7', label: '行星' },
      { iconKey: 'galaxy', color: '#b197fc', label: '星系' },
      { iconKey: 'alert', color: '#ffb020', label: '告警' },
      { iconKey: 'intel', color: '#7dd3fc', label: '情报' },
    ],
  },
];

function IconGrid({ entries }: { entries: Array<{ iconKey: string; color: string; label: string }> }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
        gap: 14,
      }}
    >
      {entries.map(({ iconKey, color, label }) => (
        <div key={iconKey} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <Icon iconKey={iconKey} color={color} size={36} label={label} />
          <code style={{ color: '#8fa3c8', fontSize: 11 }}>{iconKey}</code>
        </div>
      ))}
    </div>
  );
}

export const CatalogGrid: Story = {
  render: () => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        padding: 16,
        width: 720,
        background: 'rgba(8,16,32,0.6)',
        borderRadius: 12,
      }}
    >
      {ICON_GROUPS.map((group) => (
        <section key={group.title}>
          <h3 style={{ color: '#c7d2e8', fontSize: 13, margin: '0 0 10px' }}>{group.title}</h3>
          <IconGrid entries={group.entries} />
        </section>
      ))}
    </div>
  ),
};

/** 映射完整性：展示 ICON_MAP 全量 key（含别名），便于核对遗漏。 */
export const FullMap: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
        gap: 10,
        padding: 16,
        width: 820,
        background: 'rgba(8,16,32,0.6)',
        borderRadius: 12,
      }}
    >
      {Object.keys(ICON_MAP).map((iconKey) => (
        <div key={iconKey} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <Icon iconKey={iconKey} size={28} label={iconKey} />
          <code style={{ color: '#8fa3c8', fontSize: 10 }}>{iconKey}</code>
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
      <Icon iconKey="accumulator" color="#ffb454" size={40} label="能量" />
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
