import { describe, expect, it } from "vitest";

import { toPlayerFacingMessage } from "@/common/player-facing-error";

describe("toPlayerFacingMessage", () => {
  it("把研究站缺料错误翻译成玩家口径", () => {
    expect(toPlayerFacingMessage("missing electromagnetic_matrix in research labs"))
      .toBe("研究站缺少物料：electromagnetic_matrix，请先把对应物品装入研究站。");
  });

  it("把协议校验错误翻译成玩家口径", () => {
    expect(toPlayerFacingMessage("VALIDATION_FAILED: action.type is required"))
      .toBe("命令参数未通过校验，请检查输入后重试。");
  });

  it("把网关/网络错误翻译成连接异常", () => {
    expect(toPlayerFacingMessage("502 Bad Gateway")).toBe("服务器连接异常，请稍后重试。");
    expect(toPlayerFacingMessage("fetch failed")).toBe("服务器连接异常，请稍后重试。");
  });

  it("把鉴权错误翻译成重新登录提示", () => {
    expect(toPlayerFacingMessage("unauthorized")).toBe("登录状态失效，请重新登录。");
  });

  it("无法识别的原文一律回退到通用文案，不外泄实现细节", () => {
    expect(toPlayerFacingMessage("some internal stack trace with request id abc"))
      .toBe("操作未成功，请稍后重试。");
    expect(toPlayerFacingMessage("")).toBe("操作未成功，请稍后重试。");
    expect(toPlayerFacingMessage(undefined)).toBe("操作未成功，请稍后重试。");
  });

  it("已是中文玩家文案的原文原样放行", () => {
    expect(toPlayerFacingMessage("缺少 electromagnetic_matrix"))
      .toBe("缺少 electromagnetic_matrix");
  });
});
