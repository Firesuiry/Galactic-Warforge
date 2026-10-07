import { isGameFinishedResult, isGameFinishedText, toPlayerFacingMessage } from '@/common/player-facing-error';

export type WarHintTone = 'success' | 'warning' | 'error';

export interface WarCommandHint {
  tone: WarHintTone;
  title: string;
  detail?: string;
  /** 终局拒令时指向结算页。 */
  href?: string;
}

export interface CommandResultLike {
  status?: string;
  code?: string;
  message?: string;
}

export function gameFinishedHint(): WarCommandHint {
  return {
    tone: 'error',
    title: '对局已结束',
    detail: '请前往结算页查看战报。',
    href: '/settlement',
  };
}

/** 服务端失败文案已是中文玩家口径：原样展示，终局拒令单独指向结算页。 */
export function resolveWarCommandHint(message?: string | null): WarCommandHint | undefined {
  const raw = message?.trim() ?? '';
  if (!raw) {
    return undefined;
  }
  if (isGameFinishedText(raw)) {
    return gameFinishedHint();
  }
  return {
    tone: 'error',
    title: toPlayerFacingMessage(raw),
  };
}

export function buildWarSuccessHint(message?: string | null): WarCommandHint {
  const title = message?.trim() || '命令已提交';
  return {
    tone: 'success',
    title,
  };
}

/** 战争页命令回执。code===GAME_FINISHED 优先于 status/message 的成功或其它失败文案。 */
export function resolveCommandResultHint(result?: CommandResultLike | null): WarCommandHint {
  if (isGameFinishedResult(result)) {
    return gameFinishedHint();
  }
  if (result?.status === 'executed' || result?.status === 'accepted' || result?.status === 'queued') {
    return buildWarSuccessHint(result.message);
  }
  return resolveWarCommandHint(result?.message) ?? {
    tone: 'warning',
    title: toPlayerFacingMessage(result?.message),
  };
}
