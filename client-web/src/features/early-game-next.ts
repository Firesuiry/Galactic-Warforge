/**
 * 开局 / 中前期「下一步」主行动（对标文明6 下一步 + DSP 引导）。
 *
 * 仅依赖 summary + stats 已有字段，不额外请求 scene，
 * 保证总览页在冷启动时也能给出正确入口，而不是空态跳银河。
 */

import type { AlertEntry, EnergyStats, PlayerState } from "@shared/types";

import { normalizeCompletedTechIds } from "@/features/planet-map/research-workflow";
import {
  translateAlertType,
  translateBuildingType,
  translateSeverity,
  translateTechId,
} from "@/i18n/translate";

export interface EarlyGameNextAction {
  /** 路由目标（可带 query）。 */
  to: string;
  iconKey: string;
  color: string;
  /** 主文案（按钮大字）。 */
  text: string;
  /** 是否为无紧急压力的引导态。 */
  idle: boolean;
  /** 诊断用阶段 id，测试可断言。 */
  stage:
    | "alert"
    | "power_first"
    | "power_reinforce"
    | "build_lab"
    | "load_matrix"
    | "research_blocked_power"
    | "research_running"
    | "research_electromagnetism"
    | "mine_expand"
    | "research_basic_logistics"
    | "logistics_expand"
    | "dyson_intro"
    | "war_intro"
    | "scout_expand";
}

export interface ResolveEarlyGameNextInput {
  activePlanetId: string;
  player?: PlayerState | null;
  energy?: EnergyStats | null;
  /** 已过滤噪声后的产线告警，优先级最高。 */
  alerts?: AlertEntry[];
}

const EARLY_TECH = "electromagnetism";
const LOGISTICS_TECH = "basic_logistics_system";
const DYSON_ORBIT_TECH = "solar_sail_orbit";
const RAY_RECEIVER_TECH = "ray_receiver";
const MATRIX_ITEM = "electromagnetic_matrix";
const MATRIX_NEEDED = 10;

function planetPath(planetId: string, query?: Record<string, string>) {
  const base = `/planet/${planetId || "planet-1-1"}`;
  if (!query || Object.keys(query).length === 0) {
    return base;
  }
  const params = new URLSearchParams(query);
  return `${base}?${params.toString()}`;
}

function inventoryQty(player: PlayerState | null | undefined, itemId: string) {
  const inv = player?.inventory;
  if (!inv) {
    return 0;
  }
  const raw = inv[itemId];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

/**
 * 解析总览「下一步优先处理」。
 * 优先级：产线告警 > 无电起步 > 研究阻塞 > 开局科研链 > 采矿扩张 >
 * 中期物流/戴森/军工 > 星图侦察。
 */
export function resolveEarlyGameNextAction(
  input: ResolveEarlyGameNextInput,
): EarlyGameNextAction {
  const planetId = input.activePlanetId || "planet-1-1";
  const player = input.player ?? null;
  const energy = input.energy;
  const generation = energy?.generation ?? 0;
  const consumption = energy?.consumption ?? 0;
  const shortage = (energy?.shortage_ticks ?? 0) > 0 || consumption > generation;
  const completed = new Set(normalizeCompletedTechIds(player?.tech));
  const electromagnetismDone = completed.has(EARLY_TECH);
  const basicLogisticsDone = completed.has(LOGISTICS_TECH);
  const dysonUnlocked =
    completed.has(DYSON_ORBIT_TECH) || completed.has(RAY_RECEIVER_TECH);
  const current = player?.tech?.current_research;
  const matrixQty = inventoryQty(player, MATRIX_ITEM);
  const productionOutput = player?.stats?.production_stats?.total_output ?? 0;
  const logisticsThroughput = player?.stats?.logistics_stats?.throughput ?? 0;

  const recommendedAlert = input.alerts?.[0];
  if (recommendedAlert) {
    return {
      to: planetPath(planetId),
      iconKey: recommendedAlert.building_type || "alert",
      color: "#ffb454",
      text: `${translateAlertType(recommendedAlert.alert_type, translateSeverity(recommendedAlert.severity))} · ${translateBuildingType(recommendedAlert.building_type)} ${recommendedAlert.building_id}`,
      idle: false,
      stage: "alert",
    };
  }

  // 1) 完全无发电：新局标准第一步
  if (generation <= 0) {
    return {
      to: planetPath(planetId, { build: "wind_turbine" }),
      iconKey: "wind_turbine",
      color: "#39e6d0",
      text: electromagnetismDone
        ? "基地无电 · 先建风力涡轮机恢复供电"
        : "开局第一步：建造风力涡轮机供电",
      idle: false,
      stage: "power_first",
    };
  }

  // 2) 有研究但被阻塞 / 进行中
  if (current?.tech_id) {
    const blocked = current.blocked_reason;
    if (blocked === "waiting_lab") {
      return {
        to: planetPath(planetId, { build: "matrix_lab" }),
        iconKey: "matrix_lab",
        color: "#6ee7b7",
        text: "缺少研究站 · 建造矩阵研究站",
        idle: false,
        stage: "build_lab",
      };
    }
    if (blocked === "waiting_matrix") {
      return {
        to: planetPath(planetId, { workflow: "research" }),
        iconKey: "tech",
        color: "#ffb454",
        text: `研究缺矩阵 · 向研究站装入电磁矩阵（背包 ${matrixQty}）`,
        idle: false,
        stage: "load_matrix",
      };
    }
    if (blocked === "low_power" || shortage) {
      return {
        to: planetPath(planetId, { build: "wind_turbine" }),
        iconKey: "power",
        color: "#ff5757",
        text: "研究站供电不足 · 扩建风力涡轮机",
        idle: false,
        stage: "research_blocked_power",
      };
    }

    const techName = translateTechId(current.tech_id);
    const percent =
      current.total_cost > 0
        ? Math.min(100, Math.round((current.progress / current.total_cost) * 100))
        : 0;
    return {
      to: planetPath(planetId, { workflow: "research" }),
      iconKey: "tech",
      color: "#6ee7b7",
      text: `研究进行中：${techName} ${percent}%`,
      idle: true,
      stage: "research_running",
    };
  }

  // 3) 开局科技链未完成：引导建站 + 研究电磁学
  if (!electromagnetismDone) {
    if (matrixQty < MATRIX_NEEDED) {
      return {
        to: planetPath(planetId, { build: "matrix_lab" }),
        iconKey: "matrix_lab",
        color: "#6ee7b7",
        text: `背包矩阵不足（${matrixQty}/${MATRIX_NEEDED}）· 先建研究站准备科研`,
        idle: false,
        stage: "build_lab",
      };
    }
    return {
      to: planetPath(planetId, { build: "matrix_lab", workflow: "research" }),
      iconKey: "tech",
      color: "#6ee7b7",
      text: "建造矩阵研究站 · 装入矩阵并研究电磁学",
      idle: false,
      stage: "research_electromagnetism",
    };
  }

  // 4) 电磁学完成但尚无产出：采矿扩张
  if (productionOutput <= 0) {
    return {
      to: planetPath(planetId, { build: "mining_machine" }),
      iconKey: "mining_machine",
      color: "#5fb0ff",
      text: "电磁学已解锁 · 建造采矿机开采矿物",
      idle: false,
      stage: "mine_expand",
    };
  }

  // 5) 供电紧张但未形成告警
  if (shortage) {
    return {
      to: planetPath(planetId, { build: "wind_turbine" }),
      iconKey: "power",
      color: "#ffb454",
      text: "电力偏紧 · 扩建风力涡轮机或特斯拉塔",
      idle: false,
      stage: "power_reinforce",
    };
  }

  // 6) 中期：基础物流科技（传送带/分拣器入口）
  if (!basicLogisticsDone) {
    const logisticsName = translateTechId(LOGISTICS_TECH, "基础物流系统");
    return {
      to: planetPath(planetId, { workflow: "research" }),
      iconKey: "conveyor_belt_mk1",
      color: "#8fa3c8",
      text: `研究${logisticsName} · 解锁传送带与分拣器`,
      idle: false,
      stage: "research_basic_logistics",
    };
  }

  // 7) 物流科技已解锁但产线未跑通：铺传送带
  if (logisticsThroughput <= 0) {
    return {
      to: planetPath(planetId, { build: "conveyor_belt_mk1" }),
      iconKey: "conveyor_belt_mk1",
      color: "#8fa3c8",
      text: "物流已解锁 · 铺设传送带连接产线",
      idle: false,
      stage: "logistics_expand",
    };
  }

  // 8) 戴森链已解锁：引导戴森工作流
  if (dysonUnlocked) {
    return {
      to: planetPath(planetId, { workflow: "dyson" }),
      iconKey: "ray_receiver",
      color: "#39e6d0",
      text: "戴森链已开启 · 配置发射与射线接收",
      idle: true,
      stage: "dyson_intro",
    };
  }

  // 9) 中期稳态：军工部署入口（比纯侦察更可玩）
  return {
    to: "/war?tab=industry",
    iconKey: "fleet",
    color: "#ffb454",
    text: "编成首支舰队 · 从军工部署起步",
    idle: true,
    stage: "war_intro",
  };
}
