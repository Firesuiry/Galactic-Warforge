export type PublicTurnErrorCode =
  | 'provider_schema_invalid'
  | 'provider_unavailable'
  | 'provider_start_failed'
  | 'permission_denied'
  | 'unsupported_action'
  | 'unknown';

const PUBLIC_ERROR_MESSAGES: Record<PublicTurnErrorCode, string> = {
  provider_schema_invalid: '模型返回结构无效，请稍后重试。',
  provider_unavailable: '模型服务暂时不可用，请稍后重试。',
  provider_start_failed: '模型执行器启动失败，请检查 provider 配置。',
  permission_denied: '当前智能体权限不足，无法执行该操作。',
  unsupported_action: '当前智能体返回了不支持的动作。',
  unknown: '执行失败，请稍后重试。',
};

export class PublicTurnError extends Error {
  code: PublicTurnErrorCode;
  rawMessage: string;

  constructor(code: PublicTurnErrorCode, rawMessage: string) {
    super(PUBLIC_ERROR_MESSAGES[code]);
    this.name = 'PublicTurnError';
    this.code = code;
    this.rawMessage = rawMessage;
  }
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof PublicTurnError) {
    return error.rawMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function classifyPublicTurnError(error: unknown): PublicTurnError {
  if (error instanceof PublicTurnError) {
    return error;
  }

  const rawMessage = normalizeErrorMessage(error);
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes('actions must be an array')
    || normalized.includes('done must be a boolean')
    || normalized.includes('http api response missing content')
    || normalized.includes('unexpected token')
    || normalized.includes('unexpected end of json')
    || normalized.includes('json')
  ) {
    return new PublicTurnError('provider_schema_invalid', rawMessage);
  }

  if (
    normalized.includes('502')
    || normalized.includes('bad gateway')
    || normalized.includes('timeout')
    || normalized.includes('timed out')
    || normalized.includes('econnreset')
    || normalized.includes('connection reset')
    || normalized.includes('fetch failed')
    || normalized.includes('network')
    || normalized.includes('enotfound')
  ) {
    return new PublicTurnError('provider_unavailable', rawMessage);
  }

  if (
    normalized.includes('spawn')
    || normalized.includes('enoent')
    || normalized.includes('eacces')
    || normalized.includes('failed to start')
    || normalized.includes('missing exec subcommand')
  ) {
    return new PublicTurnError('provider_start_failed', rawMessage);
  }

  if (
    normalized.includes('not allowed')
    || normalized.includes('permission denied')
    || normalized.includes('complete policy')
    || normalized.includes('exceed')
    || normalized.includes('creator policy')
    || normalized.includes('scope exceeds')
  ) {
    return new PublicTurnError('permission_denied', rawMessage);
  }

  if (normalized.includes('not supported')) {
    return new PublicTurnError('unsupported_action', rawMessage);
  }

  return new PublicTurnError('unknown', rawMessage);
}
