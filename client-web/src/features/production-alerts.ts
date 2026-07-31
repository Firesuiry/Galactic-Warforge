/**
 * 产线告警展示策略（纯函数）。
 *
 * server 已在 production_monitor 对研究模式（Research 模块 + 空配方）
 * 跳过吞吐类告警；本模块保留同等过滤作为防御层，防止旧存档/旧服
 * 仍把噪音推到 toast、活动流与顶栏计数。
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
