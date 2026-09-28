import { translateBuildingType, translateItemId } from "@/i18n/translate";

const GENERIC_FALLBACK = "操作未成功，请稍后重试。";

/**
 * 已知服务端消息 → 玩家可读中文。
 * 未命中任何模式时返回 undefined，由调用方决定兜底文案。
 */
function matchKnownMessage(source: string): string | undefined {
  const normalized = source.toLowerCase();

  const missingLabItem = source.match(/missing\s+(.+?)\s+in\s+research\s+labs/i);
  if (missingLabItem) {
    return `研究站缺少物料：${missingLabItem[1]}，请先把对应物品装入研究站。`;
  }

  // ---- 建造命令拒绝（server/internal/gamecore/rules.go）----
  const missingBuildItem = source.match(/need\s+(\d+)\s+([a-z0-9_]+)\s+for\s+build/i);
  if (missingBuildItem) {
    return `建造材料不足：还需要 ${missingBuildItem[1]} 个「${translateItemId(missingBuildItem[2])}」，请先生产或采集。`;
  }

  const missingMinerals = source.match(/need\s+(\d+)\s+minerals?,\s*have\s+(\d+)/i);
  if (missingMinerals) {
    return `矿石不足：建造需要 ${missingMinerals[1]}，当前仅有 ${missingMinerals[2]}。`;
  }

  const missingEnergy = source.match(/need\s+(\d+)\s+energy,\s*have\s+(\d+)/i);
  if (missingEnergy) {
    return `能量不足：建造需要 ${missingEnergy[1]}，当前仅有 ${missingEnergy[2]}。`;
  }

  if (/target tile is not buildable/i.test(source)) {
    return "目标地块不可建造，请换一个位置。";
  }
  if (/tile is reserved for construction/i.test(source)) {
    return "目标地块已被其他建造任务占用，请选择其他位置。";
  }

  const buildingNeedsResearch = source.match(
    /building type\s+(\S+)\s+requires research to unlock/i,
  );
  if (buildingNeedsResearch) {
    return `「${translateBuildingType(buildingNeedsResearch[1])}」尚未解锁，请先完成对应科技研究。`;
  }
  if (/requires research to unlock/i.test(source)) {
    return "该配方尚未解锁，请先完成对应科技研究。";
  }

  const needsResourceNode = source.match(/(\S+)\s+must be built on a resource node/i);
  if (needsResourceNode) {
    return `「${translateBuildingType(needsResourceNode[1])}」必须建在资源矿脉上。`;
  }
  if (/orbital collector must be built on a gas giant/i.test(source)) {
    return "轨道采集器只能建在气态巨行星上。";
  }
  const needsLava = source.match(/(\S+)\s+must be built on or adjacent to lava/i);
  if (needsLava) {
    return `「${translateBuildingType(needsLava[1])}」必须建在岩浆上或紧邻岩浆。`;
  }
  if (/position required for build command/i.test(source)) {
    return "建造命令缺少目标位置，请先在地图上点选位置。";
  }
  if (/invalid conveyor direction/i.test(source)) {
    return "传送带方向无效，请重新选择方向。";
  }

  // ---- 建造队列回执（成功/pending 反馈）----
  const queuedTask = source.match(/construction task\s+\S+\s+queued at\s+\((-?\d+),(-?\d+)\)/i);
  if (queuedTask) {
    return `建造任务已加入队列（${queuedTask[1]}, ${queuedTask[2]}）。`;
  }
  if (/construction task\s+\S+\s+cancelled/i.test(source)) {
    return "建造任务已取消。";
  }
  if (/construction task\s+\S+\s+restored to pending/i.test(source)) {
    return "建造任务已恢复排队。";
  }

  if (/executor out of range/i.test(source)) {
    return "目标位置超出玩家机甲的可操作范围，请先移动机甲再试。";
  }

  if (/mecha requires .* core energy/i.test(source)) {
    return "机甲核心能量不足，请在机甲详情中使用背包燃料补能。";
  }
  if (/mecha is full or still has stored fuel energy/i.test(source)) {
    return "机甲核心已满或仍有燃料余能，暂时无需添加燃料。";
  }
  if (/item cannot fuel the mecha core/i.test(source)) {
    return "所选物品不能作为机甲燃料，请选择有效燃料。";
  }
  if (/need \d+ .* in inventory/i.test(source)) {
    return "背包中的物品不足，请补充后再试。";
  }

  const moveRangeExceeded = source.match(
    /move distance (\d+) exceeds unit move range (\d+)/i,
  );
  if (moveRangeExceeded) {
    return `移动距离 ${moveRangeExceeded[1]} 超出该单位单次移动范围 ${moveRangeExceeded[2]}，请分多段移动。`;
  }

  if (/out of map bounds/i.test(source)) {
    return "目标位置超出地图边界。";
  }

  if (/destination tile is occupied/i.test(source)) {
    return "目标位置已被建筑占用，请选择其他位置。";
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

  return undefined;
}

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

  // 服务端本就返回中文玩家文案时原样放行，不做二次翻译。
  if (/[一-鿿]/.test(source)) {
    return source;
  }

  return matchKnownMessage(source) ?? GENERIC_FALLBACK;
}

/**
 * 命令回执展示用翻译：已知模式翻成中文，未识别时保留原文
 * （成功类回执没有通用兜底文案，保留原文比误导性兜底更可取）。
 */
export function toPlayerFacingFeedback(raw?: string | null): string {
  const source = raw?.trim() ?? "";
  if (!source) {
    return "";
  }
  if (/[一-鿿]/.test(source)) {
    return source;
  }
  return matchKnownMessage(source) ?? source;
}
