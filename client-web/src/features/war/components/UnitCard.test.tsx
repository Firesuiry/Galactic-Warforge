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
    armorClass: 'heavy',
    countersText: '加农克制重甲、建筑；被轻甲、空中克制',
    ...overrides,
  };
}

describe('UnitCard', () => {
  it('渲染名称/域/数值/类别/克制说明', () => {
    render(<UnitCard card={card()} />);
    expect(screen.getByTestId('unit-card')).toBeInTheDocument();
    expect(screen.getByText('剃刀突击机甲')).toBeInTheDocument();
    expect(screen.getByText('地面')).toBeInTheDocument();
    expect(screen.getByText('240/300')).toBeInTheDocument();
    expect(screen.getByText('加农')).toBeInTheDocument();
    expect(screen.getByText('重甲')).toBeInTheDocument();
    expect(screen.getByText(/加农克制重甲/)).toBeInTheDocument();
  });

  it('科技门槛：锁定态显示门槛 tech', () => {
    render(<UnitCard card={card({
      techGate: { techId: 'mil-ground-1', techName: '地面军事 I', unlocked: false },
    })} />);
    expect(screen.getByText(/需要科技：地面军事 I/)).toBeInTheDocument();
  });

  it('缺数值与类别时显示未知', () => {
    render(<UnitCard card={card({
      stats: [],
      statsSource: 'none',
      weaponClass: undefined,
      armorClass: undefined,
    })} />);
    expect(screen.getByText('战斗数值未知')).toBeInTheDocument();
    expect(screen.getAllByText('未知')).toHaveLength(2);
    expect(screen.queryByText('目录未暴露')).not.toBeInTheDocument();
  });

  it('紧凑模式隐藏克制说明', () => {
    render(<UnitCard card={card()} compact />);
    expect(screen.queryByText(/加农克制/)).not.toBeInTheDocument();
  });
});
