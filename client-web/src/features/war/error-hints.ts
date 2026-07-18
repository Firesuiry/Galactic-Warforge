import { toPlayerFacingMessage } from '@/common/player-facing-error';

export type WarHintTone = 'success' | 'warning' | 'error';

export interface WarCommandHint {
  tone: WarHintTone;
  title: string;
  detail?: string;
}

function includes(raw: string, fragment: string) {
  return raw.toLowerCase().includes(fragment.toLowerCase());
}

export function resolveWarCommandHint(message?: string | null): WarCommandHint | undefined {
  const raw = message?.trim() ?? '';
  if (!raw) {
    return undefined;
  }

  if (includes(raw, 'cannot deploy blueprint')) {
    return {
      tone: 'error',
      title: '当前部署枢纽不支持该蓝图',
    };
  }

  if (includes(raw, 'lacks transport capacity for landing')) {
    return {
      tone: 'error',
      title: '当前任务群缺少登陆运力',
    };
  }

  if (includes(raw, 'has no fleet members for blockade')) {
    return {
      tone: 'error',
      title: '当前任务群没有可用于封锁的舰队成员',
    };
  }

  if (includes(raw, 'deployment does not match blockade system')) {
    return {
      tone: 'error',
      title: '任务群部署星系与目标封锁星系不一致',
    };
  }

  if (includes(raw, 'invalid')) {
    return {
      tone: 'warning',
      title: '当前动作未通过服务器校验，请检查输入后重试。',
    };
  }

  return {
    tone: 'warning',
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
