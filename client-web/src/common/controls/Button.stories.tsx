import type { Meta, StoryObj } from '@storybook/react-vite';
import { Rocket, Save, Trash2 } from 'lucide-react';

import { Button } from '@/common/controls/Button';

const meta = {
  title: 'Common/Controls/Button',
  component: Button,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'radio', options: ['primary', 'secondary', 'danger'] },
    size: { control: 'radio', options: ['sm', 'md'] },
    disabled: { control: 'boolean' },
  },
  args: { variant: 'primary', size: 'md', children: '执行指令' },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  render: (args) => (
    <div style={{ display: 'flex', gap: 12, padding: 16, alignItems: 'center' }}>
      <Button {...args} variant="primary">主要行动</Button>
      <Button {...args} variant="secondary">次要行动</Button>
      <Button {...args} variant="danger">危险行动</Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div style={{ display: 'flex', gap: 12, padding: 16, alignItems: 'center' }}>
      <Button {...args} size="md">md 默认</Button>
      <Button {...args} size="sm" variant="secondary">sm 紧凑</Button>
    </div>
  ),
};

export const WithIcon: Story = {
  render: (args) => (
    <div style={{ display: 'flex', gap: 12, padding: 16, alignItems: 'center' }}>
      <Button {...args} icon={Rocket}>发起跃迁</Button>
      <Button {...args} variant="secondary" icon={Save}>保存</Button>
      <Button {...args} variant="danger" size="sm" icon={Trash2}>解散</Button>
    </div>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <div style={{ display: 'flex', gap: 12, padding: 16, alignItems: 'center' }}>
      <Button {...args} disabled>主要行动</Button>
      <Button {...args} variant="secondary" disabled>次要行动</Button>
      <Button {...args} variant="danger" disabled>危险行动</Button>
    </div>
  ),
};
