import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Input } from '@/common/controls/Input';

const meta = {
  title: 'Common/Controls/Input',
  component: Input,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    type: { control: 'radio', options: ['text', 'number', 'checkbox'] },
    disabled: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
  args: { type: 'text', placeholder: '输入指令参数', 'aria-label': '演示输入框' },
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Text: Story = {
  render: function TextInput() {
    const [value, setValue] = useState('');
    return (
      <div style={{ padding: 16, width: 280 }}>
        <Input
          aria-label="文本输入"
          placeholder="例如 tf-strike"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
    );
  },
};

export const Numeric: Story = {
  render: function NumberInput() {
    const [value, setValue] = useState(8);
    return (
      <div style={{ padding: 16, width: 280 }}>
        <Input
          aria-label="数值输入"
          type="number"
          min={1}
          value={value}
          onChange={(event) => setValue(Number(event.target.value))}
        />
      </div>
    );
  },
};

export const Checkbox: Story = {
  render: function CheckboxInput() {
    const [checked, setChecked] = useState(true);
    return (
      <div style={{ display: 'flex', gap: 16, padding: 16, alignItems: 'center', color: '#e8f1ff' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Input
            aria-label="勾选开关"
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          校验 snapshot digest（{checked ? '开' : '关'}）
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
          <Input aria-label="禁用勾选" type="checkbox" disabled checked={false} onChange={() => undefined} />
          禁用态
        </label>
      </div>
    );
  },
};

export const Disabled: Story = {
  render: (args) => (
    <div style={{ padding: 16, width: 280 }}>
      <Input {...args} disabled value="不可编辑" onChange={() => undefined} />
    </div>
  ),
};
