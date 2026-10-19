import type { AgentBriefingSelf, MechaView, PlayerState, StateSummary } from './types.js';

/** 未绑定机甲时的统一提示（CLI / agent 文案共用）。 */
export const NO_MECHA_HINT = '未绑定机甲：mecha list / mecha assign <id>';

/** summary 或 briefing 里携带「我的机甲」的那一层。 */
export type MechaHolder = Pick<PlayerState, 'mechas'> | Pick<AgentBriefingSelf, 'mechas'> | { mechas?: MechaView[] } | null | undefined;

function mechasOf(summaryOrBriefing: MechaHolder): MechaView[] {
  return summaryOrBriefing?.mechas ?? [];
}

/**
 * 「我的机甲」= `mechas.find(m => m.operator === issuerId)`。
 * 服务端不额外区分发令者，客户端按自己的 issuer_id 在列表里找。
 */
export function selectMyMecha(
  summaryOrBriefing: MechaHolder,
  issuerId: string,
): MechaView | undefined {
  if (!issuerId) {
    return undefined;
  }
  return mechasOf(summaryOrBriefing).find((mecha) => mecha.operator === issuerId);
}

/** 从完整 summary 里取自己那一层的机甲列表。 */
export function selectMyMechaFromSummary(
  summary: StateSummary | null | undefined,
  playerId: string,
  issuerId: string,
): MechaView | undefined {
  return selectMyMecha(summary?.players?.[playerId], issuerId);
}

/** 按 unit_id 排序的机甲表格（mecha list / 总览共用）。 */
export function sortMechas(mechas: MechaView[] | undefined): MechaView[] {
  return [...(mechas ?? [])].sort((a, b) => a.unit_id.localeCompare(b.unit_id));
}
