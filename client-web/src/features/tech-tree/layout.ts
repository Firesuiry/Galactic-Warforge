/**
 * 科技树布局（纯函数，对标文明6/群星科技树）。
 *
 * 输入 catalog.techs（含 prerequisites/leads_to/level/type），
 * 输出每个节点的网格坐标（col=深度层, row=同层内序号）与连线列表，
 * 供 TechPage 用绝对定位渲染，不依赖任何图形库。
 */

import type { TechCatalogEntry } from "@shared/types";

export type TechNodeStatus = "completed" | "researching" | "available" | "locked";

export interface TechNode {
  entry: TechCatalogEntry;
  /** 层级列（0 = 无前置的起点科技），由最长前置链深度决定，不用 catalog level 字段直接摆放。 */
  col: number;
  /** 同一 lane（type）内、同一 col 内的行号。 */
  row: number;
  lane: string;
  status: TechNodeStatus;
}

export interface TechEdge {
  fromId: string;
  toId: string;
  /** 边两端节点均已完成时高亮。 */
  active: boolean;
}

export interface TechTreeLayout {
  nodes: TechNode[];
  edges: TechEdge[];
  lanes: string[];
  /** 布局总列数，供容器宽度计算。 */
  colCount: number;
}

const LANE_ORDER = ["main", "energy", "smelting", "chemical", "logistics", "mecha", "combat", "dyson"];

function laneOf(entry: TechCatalogEntry): string {
  return entry.type || "main";
}

/** 每个节点的深度 = 其前置链的最长路径长度（无前置为 0）。 */
function computeDepths(entries: TechCatalogEntry[]): Map<string, number> {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  function resolve(id: string): number {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    const entry = byId.get(id);
    if (!entry || visiting.has(id)) return 0; // 防御环形依赖
    visiting.add(id);
    const prereqs = (entry.prerequisites ?? []).filter((p) => byId.has(p));
    const d = prereqs.length === 0 ? 0 : 1 + Math.max(...prereqs.map(resolve));
    visiting.delete(id);
    depth.set(id, d);
    return d;
  }

  for (const entry of entries) resolve(entry.id);
  return depth;
}

export function buildTechTreeLayout(
  entries: TechCatalogEntry[],
  completedTechIds: ReadonlySet<string>,
  currentResearchTechId?: string | null,
): TechTreeLayout {
  const visible = entries.filter((e) => !e.hidden);
  const depths = computeDepths(visible);
  const byId = new Map(visible.map((e) => [e.id, e]));

  const laneSet = new Set(visible.map(laneOf));
  const lanes = [
    ...LANE_ORDER.filter((l) => laneSet.has(l)),
    ...[...laneSet].filter((l) => !LANE_ORDER.includes(l)).sort(),
  ];

  // 按 lane 分组，组内按 (col, id) 排序后分配 row，保证同层节点纵向紧凑排列。
  const rowCounters = new Map<string, Map<number, number>>();
  const nodes: TechNode[] = [];
  let colCount = 0;

  for (const lane of lanes) {
    const laneEntries = visible
      .filter((e) => laneOf(e) === lane)
      .sort((a, b) => (depths.get(a.id)! - depths.get(b.id)!) || a.id.localeCompare(b.id));
    const counters = rowCounters.get(lane) ?? new Map<number, number>();
    rowCounters.set(lane, counters);
    for (const entry of laneEntries) {
      const col = depths.get(entry.id) ?? 0;
      const row = counters.get(col) ?? 0;
      counters.set(col, row + 1);
      colCount = Math.max(colCount, col + 1);

      let status: TechNodeStatus;
      if (completedTechIds.has(entry.id)) {
        status = "completed";
      } else if (entry.id === currentResearchTechId) {
        status = "researching";
      } else {
        const prereqs = entry.prerequisites ?? [];
        const ready = prereqs.every((p) => completedTechIds.has(p));
        status = ready ? "available" : "locked";
      }

      nodes.push({ entry, col, row, lane, status });
    }
  }

  const edges: TechEdge[] = [];
  for (const entry of visible) {
    for (const prereqId of entry.prerequisites ?? []) {
      if (!byId.has(prereqId)) continue;
      edges.push({
        fromId: prereqId,
        toId: entry.id,
        active: completedTechIds.has(prereqId) && completedTechIds.has(entry.id),
      });
    }
  }

  return { nodes, edges, lanes, colCount };
}

/** UI 状态 → 展示态：颜色 token 名（由 tech.css 定义），供节点渲染直接取用。 */
export function techNodeStatusToken(status: TechNodeStatus): string {
  switch (status) {
    case "completed":
      return "completed";
    case "researching":
      return "researching";
    case "available":
      return "available";
    default:
      return "locked";
  }
}
