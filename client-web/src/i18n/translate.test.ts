import { describe, expect, it } from 'vitest';

import { translateBuildingType, translateItemId } from '@/i18n/translate';
import { TRANSLATIONS } from '@/i18n/translation-config';

describe('translateCatalogBackedValue 回退链', () => {
  it('中文 displayName 优先（旧服务端/旧存档兼容）', () => {
    expect(translateBuildingType('wind_turbine', '风力发电机')).toBe('风力发电机');
  });

  it('英文 displayName + 字典命中 → 中文', () => {
    expect(translateBuildingType('wind_turbine', 'Wind Turbine')).toBe('风力涡轮机');
    expect(translateBuildingType('matrix_lab', 'Matrix Lab')).toBe('矩阵研究站');
    expect(translateBuildingType('conveyor_belt_mk1', 'Conveyor Belt Mk.I')).toBe('传送带 Mk.I');
  });

  it('字典未命中时回退英文 displayName，不暴露下划线裸 ID', () => {
    expect(translateBuildingType('future_building_x', 'Future Building X')).toBe('Future Building X');
    expect(translateItemId('future_item_x', 'Future Item X')).toBe('Future Item X');
  });

  it('字典未命中且无 displayName 时才回退原始 ID', () => {
    expect(translateBuildingType('future_building_x')).toBe('future_building_x');
  });

  it('buildingType 字典与服务端建筑 ID 口径一致（无陈旧死键）', () => {
    // 服务端 62 个建筑 ID 全覆盖（抽样核对代表性 ID）
    for (const id of ['mining_machine', 'wind_turbine', 'matrix_lab', 'tesla_tower', 'conveyor_belt_mk1', 'foundation']) {
      expect(TRANSLATIONS.buildingType[id as keyof typeof TRANSLATIONS.buildingType]).toBeTruthy();
    }
    // 陈旧键已清除
    expect('assembler' in TRANSLATIONS.buildingType).toBe(false);
    expect('smelter' in TRANSLATIONS.buildingType).toBe(false);
    expect('power_generator' in TRANSLATIONS.buildingType).toBe(false);
  });
});
