import { describe, expect, it } from "vitest";

import { GAME_FINISHED_MESSAGE, rejectionPlayerMessage, toPlayerFacingMessage } from "@/common/player-facing-error";

describe("toPlayerFacingMessage", () => {
  it("服务端中文文案原样放行", () => {
    expect(toPlayerFacingMessage("背包需有 2 个电路板，当前 0 个")).toBe("背包需有 2 个电路板，当前 0 个");
  });

  it("传输层错误翻译成中文", () => {
    expect(toPlayerFacingMessage("502 Bad Gateway")).toBe("服务器连接异常，请稍后重试。");
    expect(toPlayerFacingMessage("fetch failed")).toBe("服务器连接异常，请稍后重试。");
    expect(toPlayerFacingMessage("unauthorized")).toBe("登录状态失效，请重新登录。");
  });

  it("无法识别的英文一律回退通用文案，不外泄实现细节", () => {
    expect(toPlayerFacingMessage("some internal stack trace with request id abc")).toBe("操作未成功，请稍后重试。");
    expect(toPlayerFacingMessage("")).toBe("操作未成功，请稍后重试。");
    expect(toPlayerFacingMessage(undefined)).toBe("操作未成功，请稍后重试。");
  });

  it("GAME_FINISHED 映射为终局文案，code 优先于其它 message", () => {
    expect(toPlayerFacingMessage("GAME_FINISHED")).toBe(GAME_FINISHED_MESSAGE);
    expect(rejectionPlayerMessage([{ code: "GAME_FINISHED", message: "其它文本" }], "fallback")).toBe(GAME_FINISHED_MESSAGE);
  });
});
