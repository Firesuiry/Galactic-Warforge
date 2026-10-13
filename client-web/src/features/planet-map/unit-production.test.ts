import { isUnitProducerBuilding, listUnitsForBuildingType, listWorldProduceUnits, orderBuildingsForProduce } from '@/features/planet-map/unit-production';

describe('unit-production 配对', () => {
  const catalog = {
    buildings: [
      { id: 'barracks', can_produce_units: true },
      { id: 'battlefield_analysis_base' },
      { id: 'wind_turbine' },
    ],
    world_units: [
      { id: 'soldier', producer: 'barracks', production_mode: 'world_produce' },
      { id: 'transport_robot', producer: 'battlefield_analysis_base', production_mode: 'world_produce' },
      { id: 'combat_drone', producer: 'airfield', production_mode: 'factory_recipe' },
    ],
  } as never;
  const own = [
    { id: 'b1', type: 'barracks' },
    { id: 'b2', type: 'battlefield_analysis_base' },
    { id: 'b3', type: 'wind_turbine' },
  ];

  it('只列 world_produce 单位，按 producer 配对', () => {
    expect(listWorldProduceUnits(catalog).map((unit) => unit.id)).toEqual(['soldier', 'transport_robot']);
    expect(listUnitsForBuildingType(catalog, 'battlefield_analysis_base').map((unit) => unit.id)).toEqual(['transport_robot']);
    expect(listUnitsForBuildingType(catalog, 'airfield')).toEqual([]);
  });

  it('生产建筑 = can_produce_units 标记 ∪ 单位 producer 配对（HQ 无标记也要认）', () => {
    expect(isUnitProducerBuilding(catalog, 'barracks')).toBe(true);
    expect(isUnitProducerBuilding(catalog, 'battlefield_analysis_base')).toBe(true);
    expect(isUnitProducerBuilding(catalog, 'wind_turbine')).toBe(false);
  });

  it('下拉候选：生产建筑排前面，其余己方建筑照旧在列（服务端配对错误是玩法反馈）', () => {
    expect(orderBuildingsForProduce(catalog, own).map((building) => building.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('目录缺 can_produce_units 时靠 producer 配对兜底', () => {
    const noMarker = {
      buildings: [{ id: 'barracks' }],
      world_units: [{ id: 'soldier', producer: 'barracks', production_mode: 'world_produce' }],
    } as never;
    expect(isUnitProducerBuilding(noMarker, 'barracks')).toBe(true);
    expect(orderBuildingsForProduce(noMarker, own).map((building) => building.id)).toEqual(['b1', 'b2', 'b3']);
  });
});
