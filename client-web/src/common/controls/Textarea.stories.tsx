import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Textarea } from '@/common/controls/Textarea';

const meta = {
  title: 'Common/Controls/Textarea',
  component: Textarea,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    rows: { control: 'number' },
    disabled: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
  args: { rows: 4, placeholder: '输入多行指令内容', 'aria-label': '演示多行输入' },
} satisfies Meta<typeof Textarea>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function DefaultTextarea() {
    const [value, setValue] = useState('');
    return (
      <div style={{ padding: 16, width: 320 }}>
        <Textarea
          aria-label="多行输入"
          placeholder="例如：@建造官 每五分钟同步一次当前状态"
          rows={4}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
    );
  },
};

export const Disabled: Story = {
  render: (args) => (
    <div style={{ padding: 16, width: 320 }}>
      <Textarea {...args} disabled value="离线样例模式不可编辑" onChange={() => undefined} />
    </div>
  ),
};
