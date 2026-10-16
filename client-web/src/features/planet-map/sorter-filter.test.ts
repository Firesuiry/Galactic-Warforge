import { describe, expect, it } from 'vitest';

import type { CatalogView } from '@shared/types';

import { sorterFilterOptions, toggleSorterFilterItem } from './sorter-filter';

const catalog = {
  items: [
    { id: 'iron_ore', name: '铁矿', color: '#2f5a92' },
    { id: 'copper_ore', name: '铜矿', color: '#7a3410' },
    { id: 'iron_ingot', name: '铁块', color: '#e6e8f4' },
    { id: 'glass', name: '玻璃', color: '#9acba2' },
  ],
} as unknown as CatalogView;

describe('分拣器过滤物品选择器（试玩 1016 U2）', () => {
  it('无搜索时列出全部，已选项排在最前（已选内部仍按目录顺序）', () => {
    const options = sorterFilterOptions(catalog, ['iron_ingot', 'copper_ore'], '');
    expect(options.map((option) => option.id)).toEqual(['copper_ore', 'iron_ingot', 'iron_ore', 'glass']);
    expect(options.slice(0, 2).map((option) => option.selected)).toEqual([true, true]);
    expect(options.slice(2).every((option) => !option.selected)).toBe(true);
  });

  it('按中文名与物品 id 搜索（大小写不敏感）', () => {
    expect(sorterFilterOptions(catalog, [], '铁').map((option) => option.id)).toEqual(['iron_ore', 'iron_ingot']);
    expect(sorterFilterOptions(catalog, [], 'GLASS').map((option) => option.id)).toEqual(['glass']);
    expect(sorterFilterOptions(catalog, [], '  copper  ').map((option) => option.id)).toEqual(['copper_ore']);
    expect(sorterFilterOptions(catalog, [], '不存在')).toEqual([]);
  });

  it('搜索结果里已选项仍排最前（搜索时也能看见自己挑了什么）', () => {
    const options = sorterFilterOptions(catalog, ['iron_ingot'], '铁');
    expect(options.map((option) => option.id)).toEqual(['iron_ingot', 'iron_ore']);
    expect(options[0].selected).toBe(true);
  });

  it('勾选/取消后按目录顺序返回，而不是按点击顺序', () => {
    let selected: string[] = [];
    selected = toggleSorterFilterItem(catalog, selected, 'glass');
    selected = toggleSorterFilterItem(catalog, selected, 'iron_ore');
    expect(selected).toEqual(['iron_ore', 'glass']);
    selected = toggleSorterFilterItem(catalog, selected, 'iron_ore');
    expect(selected).toEqual(['glass']);
  });

  it('目录里没有的 id（旧存档 / 服务端新增）保留在末尾，不会被静默丢掉', () => {
    expect(toggleSorterFilterItem(catalog, ['legacy_item'], 'iron_ore')).toEqual(['iron_ore', 'legacy_item']);
  });

  it('目录缺失时不崩，返回空候选', () => {
    expect(sorterFilterOptions(undefined, ['iron_ore'], '')).toEqual([]);
  });
});
