import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { Dna, Factory, ScrollText, Target } from 'lucide-react';

import { Tabs, type HoloTabItem } from '@/common/controls/Tabs';

const WAR_TABS: HoloTabItem[] = [
  { id: 'blueprint', icon: Dna, label: '蓝图' },
  { id: 'industry', icon: Factory, label: '军工' },
  { id: 'theater', icon: Target, label: '战区' },
  { id: 'reports', icon: ScrollText, label: '战报' },
];

const meta = {
  title: 'Common/Controls/Tabs',
  component: Tabs,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: {
    tabs: WAR_TABS,
    activeId: 'blueprint',
    onChange: () => undefined,
    ariaLabel: '战争工作台面板',
  },
} satisfies Meta<typeof Tabs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const IconTabs: Story = {
  render: function IconTabsDemo() {
    const [activeId, setActiveId] = useState('blueprint');
    return (
      <div style={{ padding: 16, width: 420 }}>
        <Tabs
          ariaLabel="战争工作台面板"
          idPrefix="war-drawer"
          tabs={WAR_TABS}
          activeId={activeId}
          onChange={setActiveId}
        />
        <p style={{ color: '#8fa3c8', fontSize: 12, marginTop: 10 }}>当前分组：{activeId}</p>
      </div>
    );
  },
};

export const TextOnly: Story = {
  render: function TextTabsDemo() {
    const [activeId, setActiveId] = useState('overview');
    return (
      <div style={{ padding: 16, width: 360 }}>
        <Tabs
          ariaLabel="演示分组"
          tabs={[
            { id: 'overview', label: '总览' },
            { id: 'detail', label: '明细' },
            { id: 'history', label: '历史', disabled: true },
          ]}
          activeId={activeId}
          onChange={setActiveId}
        />
      </div>
    );
  },
};
