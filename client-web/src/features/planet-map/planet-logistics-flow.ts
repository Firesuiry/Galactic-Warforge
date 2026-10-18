/**
 * 行星地图物流可视化纯逻辑：传送带货物文本摘要。
 *
 * 不依赖 Pixi：只把 server 快照数据（conveyor.buffer）翻译成详情面板的文案。
 * 2D 视图退役后，货物圆点/采集脉冲/流速这些渲染参数只由 3D 使用，已随 2D 删除。
 */

import type { ItemAmount } from '@shared/types';

/** 带上物料的文本摘要（选中传送带详情面板用）：按 buffer 顺序「铁块 ×12 · 齿轮 ×4」。 */
export function beltBufferSummary(
  buffer: ItemAmount[] | undefined,
  label: (itemId: string) => string,
): string {
  const stacks = (buffer ?? []).filter((stack) => stack && stack.quantity > 0 && stack.item_id);
  if (stacks.length === 0) {
    return '空';
  }
  return stacks.map((stack) => `${label(stack.item_id)} ×${stack.quantity}`).join(' · ');
}
