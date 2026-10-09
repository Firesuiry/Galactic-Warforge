/**
 * 事件 payload → 中文可读描述（情报时间线/告警详情统一出口）。
 *
 * 目标：界面上绝不出现 `building_id=b-7`、`next_state=no_power` 这类裸字段名与枚举值。
 * 规则：
 * - 已知字段名走词典 `ui["payload.<key>"]`，未知字段名直接丢弃（不裸显 snake_case）；
 * - 已知枚举值走 `ui["payloadValue.<value>"]`（状态/原因/势力/实体类型等）；
 * - 值形如实体编号（b-7/u-3/enemy-11）时加中文类别前缀（`建筑 b-7`）；
 * - 位置对象渲染成 `(x, y)`，其余对象/数组不展示（避免 JSON dump）。
 */

import { entityKindLabel, itemLabel, buildingLabel, recipeLabel, techLabel, unitLabel } from "@/i18n/labels";
import { translateUi } from "@/i18n/translate";

const POSITION_KEYS = new Set(["position", "target_position", "rally_point"]);

/** 冗余字段：状态变更事件里的「原状态/原原因」对时间线读者没有增量信息，跳过。 */
const REDUNDANT_KEYS = new Set(["prev_state", "prev_reason", "prev_threat_level"]);

/** 字段值本身是目录 id 的键 → 对应中文名翻译器（`iron_ingot` → 铁块）。 */
const ID_VALUE_TRANSLATORS: Record<string, (value: string) => string> = {
  item_id: (value) => itemLabel(value),
  building_type: (value) => buildingLabel(value),
  recipe_id: (value) => recipeLabel(value),
  tech_id: (value) => techLabel(value),
  unit_type: (value) => unitLabel(value),
};

/** 已知字段的中文标签；词典未收录的键返回空串（调用方丢弃该字段）。 */
function payloadFieldLabel(key: string): string {
  const label = translateUi(`payload.${key}`);
  return label.startsWith("payload.") ? "" : label;
}

/** 已知枚举值的中文名；未收录时返回空串（调用方回退为「字段名 值」的编号式描述）。 */
function payloadValueLabel(value: string): string {
  const label = translateUi(`payloadValue.${value}`);
  return label.startsWith("payloadValue.") ? "" : label;
}

/** 内部枚举/目录 id 的形态（纯小写 + 下划线，如 power_no_provider / iron_ingot）。 */
const INTERNAL_ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

function formatPositionValue(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const position = value as { x?: unknown; y?: unknown };
  if (typeof position.x !== "number" || typeof position.y !== "number") {
    return null;
  }
  return `(${position.x}, ${position.y})`;
}

/** 单个字段 → 中文片段；无法中文化时返回 null（不裸显字段名/原始值）。 */
export function describePayloadField(key: string, value: unknown): string | null {
  const label = payloadFieldLabel(key);
  if (!label) {
    return null;
  }
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${label} ${String(value)}`;
  }
  if (typeof value === "string") {
    const enumLabel = payloadValueLabel(value);
    if (enumLabel) {
      return `${label} ${enumLabel}`;
    }
    // 字段值本身是目录 id（item_id/building_type/recipe_id/tech_id）：翻成中文名。
    const idTranslator = ID_VALUE_TRANSLATORS[key];
    if (idTranslator) {
      return `${label} ${idTranslator(value)}`;
    }
    // 实体编号（b-7/u-3/enemy-11）：中文类别 + 编号；其余字符串原样（已是中文或普通短词）。
    const kind = entityKindLabel(value);
    if (kind) {
      // 字段标签本身已是同类词（building_id → 建筑）时不再重复。
      return label === kind ? `${label} ${value}` : `${label} ${kind} ${value}`;
    }
    // 词典未收录的内部枚举/目录 id（如新增的 power_no_provider）：宁可不显示，
    // 也不把裸 snake_case 写进界面（i18n-residue.spec 会扫出来）。
    if (INTERNAL_ID_PATTERN.test(value)) {
      return null;
    }
    return `${label} ${value}`;
  }
  if (POSITION_KEYS.has(key)) {
    const position = formatPositionValue(value);
    return position ? `${label} ${position}` : null;
  }
  return null;
}

/** 事件 payload → 中文可读描述（最多 `limit` 条，全无可读字段时返回空串）。 */
export function describeEventPayload(
  payload: Record<string, unknown> | undefined,
  limit = 4,
): string {
  if (!payload) {
    return "";
  }
  const parts: string[] = [];
  // 位置字段优先（侦察/创建类事件里最有信息量），其余按原顺序补足；冗余字段跳过。
  const entries = Object.entries(payload).filter(([key]) => !REDUNDANT_KEYS.has(key));
  const ordered = [
    ...entries.filter(([key]) => POSITION_KEYS.has(key)),
    ...entries.filter(([key]) => !POSITION_KEYS.has(key)),
  ];
  for (const [key, value] of ordered) {
    if (parts.length >= limit) {
      break;
    }
    const part = describePayloadField(key, value);
    if (part) {
      parts.push(part);
    }
  }
  return parts.join(" · ");
}

/** 告警/事件里的实体编号 → 「建筑 b-7」式中文描述（无前缀时回退编号本身）。 */
export function entityIdLabel(entityId: string | undefined | null): string {
  const id = (entityId ?? "").trim();
  if (!id) {
    return "";
  }
  const kind = entityKindLabel(id);
  return kind ? `${kind} ${id}` : id;
}
