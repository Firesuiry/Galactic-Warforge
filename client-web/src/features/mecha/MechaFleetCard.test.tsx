import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MechaFleetCard } from './MechaFleetCard';
import { allMechas, planetNames } from './mecha-stories-fixture';

describe('MechaFleetCard 操作者列（契约 §7.3 第 4 条）', () => {
  function renderCard() {
    return render(<MechaFleetCard mechas={allMechas} playerId="p1" planetNames={planetNames} />);
  }

  function row(unitId: string) {
    return screen.getByRole('row', { name: new RegExp(`^${unitId}`) });
  }

  it('只有我那一行显示「我」并加粗、保留青色；整行底色高亮', () => {
    renderCard();
    const mine = row('u-3');
    const me = within(mine).getByText('我');
    expect(me.tagName).toBe('STRONG');
    expect(me.className).toContain('command-mechas__operator--me');
    expect(mine.className).toContain('command-mechas__row--mine');
  });

  it('别人的操作者名正常字重（不是 strong），也没有「我」的强调类', () => {
    renderCard();
    // u-6 阵亡但操作者是 builder-b：操作者名原样显示，不能也挂在 p1 名下
    const other = within(row('u-6')).getByText('builder-b');
    expect(other.tagName).toBe('SPAN');
    expect(other.className).not.toContain('command-mechas__operator--me');
    expect(row('u-6').className).not.toContain('command-mechas__row--mine');
    expect(within(row('u-4')).getByText('builder-a').tagName).toBe('SPAN');
  });

  it('空闲行显示灰色「空闲」', () => {
    renderCard();
    const idle = within(row('u-5')).getByText('空闲');
    expect(idle.className).toContain('command-mechas__idle');
  });
});
