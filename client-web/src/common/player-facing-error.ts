const GENERIC_FALLBACK = "操作未成功，请稍后重试。";

/**
 * 把服务端 / 网络层的原始错误文本翻译成玩家可理解的中文口径。
 *
 * 原始文本（协议错误码、HTTP 状态行、上游代理日志等）只属于调试信息，
 * 不应直接渲染给玩家；无法识别时一律回退到通用文案。
 */
export function toPlayerFacingMessage(raw?: string | null): string {
  const source = raw?.trim() ?? "";
  if (!source) {
    return GENERIC_FALLBACK;
  }
  const normalized = source.toLowerCase();

  // 服务端本就返回中文玩家文案时原样放行，不做二次翻译。
  if (/[一-鿿]/.test(source)) {
    return source;
  }

  const missingLabItem = source.match(/missing\s+(.+?)\s+in\s+research\s+labs/i);
  if (missingLabItem) {
    return `研究站缺少物料：${missingLabItem[1]}，请先把对应物品装入研究站。`;
  }

  if (/executor out of range/i.test(source)) {
    return "目标位置超出当前执行体的可操作范围，请先移动执行体再试。";
  }

  if (/unauthorized|forbidden|invalid api key|invalid player key/.test(normalized)) {
    return "登录状态失效，请重新登录。";
  }

  if (
    /bad gateway|502|503|504|failed to fetch|fetch failed|network|econnreset|econnrefused|etimedout|timeout/.test(
      normalized,
    )
  ) {
    return "服务器连接异常，请稍后重试。";
  }

  if (
    /validation_failed|action\.type is required|invalid|missing required|bad request/.test(
      normalized,
    )
  ) {
    return "命令参数未通过校验，请检查输入后重试。";
  }

  if (/not found/.test(normalized)) {
    return "请求的内容不存在或已被移除。";
  }

  return GENERIC_FALLBACK;
}
