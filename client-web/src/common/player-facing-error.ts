/**
 * 玩家可读的错误文案。
 *
 * 服务端命令回执/错误已是中文玩家文案，原样显示；提示推导一律基于错误码（code），不匹配文案。
 * 这里只处理两类非服务端文案：终局拒令（GAME_FINISHED）与传输层错误（网络/鉴权/HTTP 状态行）。
 */
const GENERIC_FALLBACK = "操作未成功，请稍后重试。";

/** 终局拒令的玩家文案。results[].code===GAME_FINISHED 时优先使用。 */
export const GAME_FINISHED_MESSAGE = "对局已结束，请前往结算页查看战报。";

export function isGameFinishedCode(code?: string | null): boolean {
  return (code ?? "").trim().toUpperCase() === "GAME_FINISHED";
}

/** HTTP 错误体里只带错误码文本（如 "GAME_FINISHED: …"）时的兜底识别。 */
export function isGameFinishedText(raw?: string | null): boolean {
  return (raw ?? "").toUpperCase().includes("GAME_FINISHED");
}

export function isGameFinishedResult(result?: { code?: string | null; message?: string | null } | null): boolean {
  return isGameFinishedCode(result?.code) || isGameFinishedText(result?.message);
}

/** 传输层（fetch/HTTP/鉴权）英文错误 → 中文；其余未知英文不外泄。 */
function classifyTransportError(source: string): string {
  const normalized = source.toLowerCase();
  if (/unauthorized|forbidden|invalid api key|invalid player key|\b401\b|\b403\b/.test(normalized)) {
    return "登录状态失效，请重新登录。";
  }
  if (/bad gateway|\b50[234]\b|failed to fetch|fetch failed|network|econnreset|econnrefused|etimedout|timeout/.test(normalized)) {
    return "服务器连接异常，请稍后重试。";
  }
  if (/\b404\b|not found/.test(normalized)) {
    return "请求的内容不存在或已被移除。";
  }
  return GENERIC_FALLBACK;
}

/** 错误文案：中文原样放行；终局/传输层错误翻译；无法识别的英文回退通用文案。 */
export function toPlayerFacingMessage(raw?: string | null): string {
  const source = raw?.trim() ?? "";
  if (!source) {
    return GENERIC_FALLBACK;
  }
  if (isGameFinishedText(source)) {
    return GAME_FINISHED_MESSAGE;
  }
  if (/[一-鿿]/.test(source)) {
    return source;
  }
  return classifyTransportError(source);
}

/**
 * HTTP 拒绝回执的玩家文案。任一 result.code===GAME_FINISHED 时优先用终局文案。
 */
export function rejectionPlayerMessage(
  results: ReadonlyArray<{ code?: string | null; message?: string | null }>,
  fallback: string,
): string {
  if (results.some((result) => isGameFinishedResult(result))) {
    return GAME_FINISHED_MESSAGE;
  }
  const raw = results
    .map((result) => result.message?.trim())
    .filter((message): message is string => Boolean(message))
    .join(" / ");
  return toPlayerFacingMessage(raw || fallback);
}
