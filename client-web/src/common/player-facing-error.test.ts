import { describe, expect, it } from "vitest";

import { toPlayerFacingFeedback, toPlayerFacingMessage } from "@/common/player-facing-error";

describe("toPlayerFacingMessage", () => {
  it("把研究站缺料错误翻译成玩家口径", () => {
    expect(toPlayerFacingMessage("missing electromagnetic_matrix in research labs"))
      .toBe("研究站缺少物料：electromagnetic_matrix，请先把对应物品装入研究站。");
  });

  it("把建造缺料错误翻译成玩家口径并翻译物品名", () => {
    expect(toPlayerFacingMessage("need 1 gear for build"))
      .toBe("建造材料不足：还需要 1 个「齿轮」，请先生产或采集。");
    expect(toPlayerFacingMessage("need 2 circuit_board for build"))
      .toBe("建造材料不足：还需要 2 个「电路板」，请先生产或采集。");
  });

  it("把建造资源不足错误翻译成玩家口径", () => {
    expect(toPlayerFacingMessage("need 100 minerals, have 40"))
      .toBe("矿石不足：建造需要 100，当前仅有 40。");
    expect(toPlayerFacingMessage("need 50 energy, have 0"))
      .toBe("能量不足：建造需要 50，当前仅有 0。");
  });

  it("把建造地块/解锁限制错误翻译成玩家口径", () => {
    expect(toPlayerFacingMessage("target tile is not buildable"))
      .toBe("目标地块不可建造，请换一个位置。");
    expect(toPlayerFacingMessage("tile is reserved for construction"))
      .toBe("目标地块已被其他建造任务占用，请选择其他位置。");
    expect(toPlayerFacingMessage("building type matrix_lab requires research to unlock"))
      .toContain("尚未解锁，请先完成对应科技研究");
    expect(toPlayerFacingMessage("mining_machine must be built on a resource node"))
      .toContain("必须建在资源矿脉上");
    expect(toPlayerFacingMessage("thermal_power_plant must be built on or adjacent to lava"))
      .toContain("必须建在岩浆上或紧邻岩浆");
  });

  it("把建造队列回执翻译成中文", () => {
    expect(toPlayerFacingMessage("construction task c5 queued at (3,4)"))
      .toBe("建造任务已加入队列（3, 4）。");
    expect(toPlayerFacingMessage("construction task c5 cancelled"))
      .toBe("建造任务已取消。");
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

  it("把移动失败错误翻译成玩家口径", () => {
    expect(toPlayerFacingMessage("move distance 13 exceeds unit move range 12"))
      .toBe("移动距离 13 超出该单位单次移动范围 12，请分多段移动。");
    expect(toPlayerFacingMessage("position (40,2) out of map bounds"))
      .toBe("目标位置超出地图边界。");
    expect(toPlayerFacingMessage("destination tile is occupied by a building"))
      .toBe("目标位置已被建筑占用，请选择其他位置。");
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

describe("toPlayerFacingFeedback", () => {
  it("已知模式翻成中文，未识别时保留原文", () => {
    expect(toPlayerFacingFeedback("construction task c1 queued at (10,20)"))
      .toBe("建造任务已加入队列（10, 20）。");
    expect(toPlayerFacingFeedback("some unrecognized success message"))
      .toBe("some unrecognized success message");
    expect(toPlayerFacingFeedback("物料已装入研究站"))
      .toBe("物料已装入研究站");
  });
});
