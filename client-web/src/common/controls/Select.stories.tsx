import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Select } from '@/common/controls/Select';

const meta = {
  title: 'Common/Controls/Select',
  component: Select,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof Select>;

export default meta;

type Story = StoryObj<typeof meta>;

const DOMAIN_OPTIONS = [
  { value: 'ground', label: 'ground 地面' },
  { value: 'air', label: 'air 空中' },
  { value: 'orbital', label: 'orbital 轨道' },
  { value: 'space', label: 'space 深空' },
];

export const Controlled: Story = {
  render: function ControlledSelect() {
    const [value, setValue] = useState('space');
    return (
      <div style={{ display: 'grid', gap: 10, padding: 16, width: 280 }}>
        <span style={{ color: '#8fa3c8', fontSize: 12 }}>当前值：{value}</span>
        <Select aria-label="作战域" value={value} onChange={(event) => setValue(event.target.value)}>
          {DOMAIN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <div style={{ padding: 16, width: 280 }}>
      <Select aria-label="禁用下拉" disabled value="space" onChange={() => undefined}>
        {DOMAIN_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </Select>
    </div>
  ),
};
