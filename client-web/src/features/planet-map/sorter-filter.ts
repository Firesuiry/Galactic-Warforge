/**
 * 分拣器过滤物品选择器的纯逻辑（试玩 1016 U2）。
 *
 * 旧实现是一个原生 `<select multiple>`，把 100+ 件物品一次性铺开：没有搜索、没有分类，
 * 玩家要 Ctrl+点选一个铁矿得在长列表里翻半天。这里把「筛选 / 排序 / 增删」抽成纯函数，
 * 组件只负责渲染，便于单测。
 *
 * 排序规则：**已选在前**（玩家最关心自己挑了什么），其次按目录顺序（与服务端 catalog
 * 一致，不另造一套物品序）。搜索按中文名 / 物品 id 子串匹配，大小写不敏感。
 */

import type { CatalogView } from '@shared/types';

export interface SorterFilterOption {
  id: string;
  name: string;
  color: string;
  selected: boolean;
}

/** 过滤物品候选：搜索命中（空串 = 全部）的目录项，已选项排在最前。 */
export function sorterFilterOptions(
  catalog: CatalogView | undefined,
  selected: readonly string[],
  query: string,
): SorterFilterOption[] {
  const chosen = new Set(selected);
  const needle = query.trim().toLowerCase();
  const entries = (catalog?.items ?? [])
    .filter((item) => !needle
      || item.id.toLowerCase().includes(needle)
      || (item.name ?? '').toLowerCase().includes(needle))
    .map((item) => ({
      id: item.id,
      name: item.name || item.id,
      color: item.color,
      selected: chosen.has(item.id),
    }));
  return [...entries.filter((option) => option.selected), ...entries.filter((option) => !option.selected)];
}

/**
 * 勾选/取消勾选一件物品。**保持目录顺序**（不按点击顺序）：服务端过滤列表是集合语义，
 * 但稳定的顺序让下拉/回显在多次编辑后不会跳来跳去（试玩 1016 U2）。
 */
export function toggleSorterFilterItem(
  catalog: CatalogView | undefined,
  selected: readonly string[],
  itemId: string,
): string[] {
  const chosen = new Set(selected);
  if (chosen.has(itemId)) {
    chosen.delete(itemId);
  } else {
    chosen.add(itemId);
  }
  const order = (catalog?.items ?? []).map((item) => item.id);
  const known = order.filter((id) => chosen.has(id));
  const extra = [...chosen].filter((id) => !order.includes(id));
  return [...known, ...extra];
}
