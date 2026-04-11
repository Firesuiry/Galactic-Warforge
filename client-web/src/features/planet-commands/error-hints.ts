export type PlanetHintTone = "info" | "warning" | "error";
export type PlanetHintSuggestedAction =
  | "move_executor"
  | "build_power"
  | "inspect_power";

export interface PlanetCommandHint {
  tone: PlanetHintTone;
  title: string;
  detail: string;
  nextHint?: string;
  suggestedAction?: PlanetHintSuggestedAction;
}

function normalizeHintSource(value?: string | null) {
  return value?.trim() ?? "";
}

function buildAuthoritativeDetail(source: string, extra?: string) {
  return extra
    ? `${extra}\nauthoritative: ${source}`
    : `authoritative: ${source}`;
}

function buildGenericHint(source: string): PlanetCommandHint {
  return {
    tone: "warning",
    title: "需要进一步检查建筑运行态",
    detail: buildAuthoritativeDetail(source),
  };
}

function parseExecutorOutOfRange(source: string) {
  const match = source.match(/executor out of range:\s*(\d+)\s*>\s*(\d+)/i);
  if (!match) {
    return null;
  }
  const [, distance, operateRange] = match;
  return { distance, operateRange };
}

export function resolvePlanetCommandHint(input: {
  code?: string | null;
  message?: string | null;
  reason?: string | null;
}) {
  const source = normalizeHintSource(input.reason)
    || normalizeHintSource(input.message)
    || normalizeHintSource(input.code);

  if (!source) {
    return undefined;
  }

  const rangeData = parseExecutorOutOfRange(source);
  if (rangeData) {
    return {
      tone: "error",
      title: "当前执行体无法直接建造到目标坐标",
      detail: buildAuthoritativeDetail(
        source,
        `distance / operateRange = ${rangeData.distance} / ${rangeData.operateRange}`,
      ),
      nextHint: `当前执行体距离目标 ${rangeData.distance} 格，但可操作范围只有 ${rangeData.operateRange} 格；先移动执行体再建造。`,
      suggestedAction: "move_executor",
    } satisfies PlanetCommandHint;
  }

  switch (source) {
    case "power_out_of_range":
      return {
        tone: "warning",
        title: "建筑未接入供电覆盖范围",
        detail: buildAuthoritativeDetail(source),
        nextHint: "建筑未接入供电覆盖范围；先补供电塔。",
        suggestedAction: "build_power",
      } satisfies PlanetCommandHint;
    case "power_no_provider":
      return {
        tone: "warning",
        title: "建筑所在电网缺少可用电源",
        detail: buildAuthoritativeDetail(source),
        nextHint: "建筑所在电网没有可用电源；先补发电设施。",
        suggestedAction: "build_power",
      } satisfies PlanetCommandHint;
    case "under_power":
      return {
        tone: "warning",
        title: "电网已接入，但当前发电不足",
        detail: buildAuthoritativeDetail(source),
        nextHint: "电网已接入，但当前发电不足；先补发电设施或降低负载。",
        suggestedAction: "build_power",
      } satisfies PlanetCommandHint;
    case "power_capacity_full":
      return {
        tone: "warning",
        title: "当前电网节点已满载",
        detail: buildAuthoritativeDetail(source),
        nextHint: "当前电网节点已满载；先扩容电网或分流负载。",
        suggestedAction: "inspect_power",
      } satisfies PlanetCommandHint;
    default:
      return buildGenericHint(source);
  }
}
