import { describe, expect, it } from 'vitest';

import { resolveCommandResultHint, resolveWarCommandHint } from '@/features/war/error-hints';

describe('war command GAME_FINISHED', () => {
  it('code 优先于成功状态，并给出结算页链接', () => {
    expect(resolveCommandResultHint({
      status: 'accepted',
      code: 'GAME_FINISHED',
      message: 'accepted',
    })).toMatchObject({
      title: '对局已结束',
      href: '/settlement',
    });
  });

  it('仅 message 含 game finished 时同样引导结算页', () => {
    expect(resolveWarCommandHint('game finished: victory already declared')).toMatchObject({
      title: '对局已结束',
      href: '/settlement',
    });
  });
});
