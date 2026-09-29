import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UnitCard } from '@/features/war/components/UnitCard';
import type { UnitCardModel } from '@/features/war/unit-card-model';

function card(overrides: Partial<UnitCardModel> = {}): UnitCardModel {
  return {
    title: '剃刀突击机甲',
    subtitle: 'bp-razor',
    domain: 'ground',
    runtimeClass: 'combat_squad',
    stats: [
      { key: 'hp', label: 'HP', value: '240/300' },
      { key: 'attack', label: '攻击', value: '22' },
      { key: 'range', label: '射程', value: '9' },
    ],
    statsSource: 'runtime',
    weaponClass: 'cannon',
    countersText: '地面单位擅长占领与推进（精确克制系数表待服务端目录暴露，以上为方向性说明）',
    ...overrides,
  };
}

describe('UnitCard', () => {
  it('渲染名称/域/数值/武器类别/克制说明', () => {
    render(<UnitCard card={card()} />);
    expect(screen.getByTestId('unit-card')).toBeInTheDocument();
    expect(screen.getByText('剃刀突击机甲')).toBeInTheDocument();
    expect(screen.getByText('地面')).toBeInTheDocument();
    expect(screen.getByText('240/300')).toBeInTheDocument();
    expect(screen.getByText('cannon')).toBeInTheDocument();
    expect(screen.getByText('目录未暴露')).toBeInTheDocument(); // 护甲类别
    expect(screen.getByText(/克制系数表待服务端/)).toBeInTheDocument();
  });

  it('科技门槛：锁定态显示门槛 tech', () => {
    render(<UnitCard card={card({
      techGate: { techId: 'mil-ground-1', techName: '地面军事 I', unlocked: false },
    })} />);
    expect(screen.getByText(/需要科技：地面军事 I/)).toBeInTheDocument();
  });

  it('目录未暴露数值时的降级展示', () => {
    render(<UnitCard card={card({ stats: [], statsSource: 'none', weaponClass: undefined })} />);
    expect(screen.getByText(/战斗数值由服务端运行时决定/)).toBeInTheDocument();
    expect(screen.getAllByText('目录未暴露')).toHaveLength(2);
  });

  it('紧凑模式隐藏克制说明', () => {
    render(<UnitCard card={card()} compact />);
    expect(screen.queryByText(/克制系数表/)).not.toBeInTheDocument();
  });
});
