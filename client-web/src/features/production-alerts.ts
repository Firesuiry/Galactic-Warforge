/**
 * 产线告警展示策略（纯函数）。
 *
 * 背景：server 的 production_monitor 对「研究模式」（未配配方）的
 * matrix_lab / self_evolution_lab 也会按周期刷 throughput_drop /
 * input_shortage 等产线告警——空研究站是合法且推荐的开局状态，
 * 这类告警属于噪音。server 侧修复前，客户端统一在展示层过滤：
 * toast、活动流告警面板、顶栏告警计数都走本模块的判定。
 */

/** 研究站类建筑：无配方时恒定"产能下降/原料短缺"，不应当作产线异常。 */
const RESEARCH_STATION_BUILDING_TYPES = new Set([
  'matrix_lab',
  'self_evolution_lab',
]);

/** 产线吞吐类告警（断电类 power_shortage / power_low 不在其列，仍保留）。 */
const THROUGHPUT_ALERT_TYPES = new Set([
  'throughput_drop',
  'input_shortage',
  'output_blocked',
  'backlog',
]);

export interface AlertNoiseProbe {
  building_type?: string;
  alert_type?: string;
}

/**
 * 是否为"研究站产线噪音"：研究站类建筑的吞吐类告警。
 * 断电告警不过滤——研究站断电依然值得提醒。
 */
export function isResearchStationAlertNoise(alert: AlertNoiseProbe): boolean {
  return Boolean(
    alert.building_type
      && alert.alert_type
      && RESEARCH_STATION_BUILDING_TYPES.has(alert.building_type)
      && THROUGHPUT_ALERT_TYPES.has(alert.alert_type),
  );
}
