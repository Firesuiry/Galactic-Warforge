import { isUnitProducerBuilding, listUnitsForBuildingType, listWorldProduceUnits, orderBuildingsForProduce } from '@/features/planet-map/unit-production';
import { formatUnitCost } from '@/features/planet-map/model';

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
      // 第 21 轮契约 §5：executor（执行体机甲）改成可生产单位，producer = 战场分析基站。
      {
        id: 'executor',
        name: '执行体机甲',
        producer: 'battlefield_analysis_base',
        production_mode: 'world_produce',
        production_ticks: 600,
        cost: [
          { item_id: 'iron_ingot', quantity: 16 },
          { item_id: 'gear', quantity: 8 },
          { item_id: 'magnetic_coil', quantity: 8 },
          { item_id: 'circuit_board', quantity: 8 },
        ],
      },
      { id: 'combat_drone', producer: 'airfield', production_mode: 'factory_recipe' },
    ],
  } as never;
  const own = [
    { id: 'b1', type: 'barracks' },
    { id: 'b2', type: 'battlefield_analysis_base' },
    { id: 'b3', type: 'wind_turbine' },
  ];

  it('只列 world_produce 单位，按 producer 配对', () => {
    expect(listWorldProduceUnits(catalog).map((unit) => unit.id)).toEqual(['soldier', 'transport_robot', 'executor']);
    expect(listUnitsForBuildingType(catalog, 'battlefield_analysis_base').map((unit) => unit.id)).toEqual(['transport_robot', 'executor']);
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

  it('executor 出现在基站生产面板，造价文案含铁块/齿轮/磁线圈/电路板与 600 tick', () => {
    const items = {
      items: [
        { id: 'iron_ingot', name: '铁块' },
        { id: 'gear', name: '齿轮' },
        { id: 'magnetic_coil', name: '磁线圈' },
        { id: 'circuit_board', name: '电路板' },
      ],
    } as never;
    const executor = listUnitsForBuildingType(catalog, 'battlefield_analysis_base')
      .find((unit) => unit.id === 'executor');
    expect(executor).toBeDefined();
    expect(formatUnitCost(items, executor!)).toBe('铁块 × 16、齿轮 × 8、磁线圈 × 8、电路板 × 8 · 600 tick');
  });
});
