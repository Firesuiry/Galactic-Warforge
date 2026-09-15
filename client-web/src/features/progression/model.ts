import type { CatalogView, PlanetRuntimeView, PlayerState, SystemRuntimeView, TechCatalogEntry } from '@shared/types';
import { getBuildingDisplayName, getItemDisplayName, getTechDisplayName, type PlanetRenderView } from '@/features/planet-map/model';
import { normalizeCompletedTechIds } from '@/features/planet-map/research-workflow';

export interface ProgressionInput {
  catalog: CatalogView;
  planet: PlanetRenderView;
  player?: PlayerState;
  runtime?: PlanetRuntimeView;
  systemRuntime?: SystemRuntimeView;
}

export interface ProgressionGoal {
  id: string;
  label: string;
  complete: boolean;
  detail: string;
  action: { label: string; to: string };
}

export interface ProgressionStage {
  id: string;
  title: string;
  description: string;
  icon: string;
  goals: ProgressionGoal[];
  complete: boolean;
}

/** Resolve the first unfinished prerequisite, using the actual catalog graph. */
export function nextResearchTarget(targetId: string, techs: TechCatalogEntry[], completed: Set<string>): TechCatalogEntry | undefined {
  const byId = new Map(techs.map(tech => [tech.id, tech]));
  const visiting = new Set<string>();
  function visit(id: string): TechCatalogEntry | undefined {
    if (completed.has(id) || visiting.has(id)) return undefined;
    const tech = byId.get(id);
    if (!tech || tech.hidden) return undefined;
    visiting.add(id);
    for (const prerequisite of tech.prerequisites ?? []) {
      if (completed.has(prerequisite)) continue;
      return visit(prerequisite);
    }
    return tech;
  }
  return visit(targetId);
}

export function buildColonyProgression({ catalog, planet, player, runtime, systemRuntime }: ProgressionInput): ProgressionStage[] {
  const completed = new Set(normalizeCompletedTechIds(player?.tech));
  const buildings = Object.values(planet.buildings ?? {}).filter(building => building.owner_id === player?.player_id && building.hp > 0);
  const planetPath = `/planet/${encodeURIComponent(planet.planet_id)}`;
  const workflow = (id: string) => `${planetPath}?workflow=${id}`;
  const researchAction = (id: string) => {
    const next = nextResearchTarget(id, catalog.techs ?? [], completed);
    return { label: next ? `研究路线：${getTechDisplayName(catalog, next.id)}` : '查看科技路线', to: next ? workflow('research') : '/tech' };
  };
  const techGoal = (id: string): ProgressionGoal => {
    const tech = catalog.techs?.find(entry => entry.id === id);
    const complete = completed.has(id);
    const missing = tech?.prerequisites?.filter(prerequisite => !completed.has(prerequisite)) ?? [];
    const costs = tech?.cost?.map(cost => `${getItemDisplayName(catalog, cost.item_id)} ×${cost.quantity}`).join(' / ');
    return {
      id: `tech:${id}`, label: getTechDisplayName(catalog, id), complete,
      detail: complete ? '科技已完成' : !tech ? '当前科技目录未提供此项目' : missing.length ? `前置：${missing.map(prerequisite => getTechDisplayName(catalog, prerequisite)).join('、')}` : costs ? `研究消耗：${costs}` : '前置科技已满足，前往研究站查看',
      action: researchAction(id),
    };
  };
  const buildingGoal = (id: string): ProgressionGoal => {
    const entry = catalog.buildings?.find(building => building.id === id);
    const count = buildings.filter(building => building.type === id).length;
    const missing = entry?.unlock_tech?.filter(techId => !completed.has(techId)) ?? [];
    const canBuild = entry?.buildable && Boolean(entry.unlock_tech?.length) && !missing.length;
    return {
      id: `building:${id}`, label: `部署${getBuildingDisplayName(catalog, id)}`, complete: count > 0,
      detail: count ? `当前载入区域可见 ${count} 座` : missing.length ? `解锁：${missing.map(techId => getTechDisplayName(catalog, techId)).join('、')}` : canBuild ? '选择位置建造；材料与范围在建造栏检查' : '当前建造目录尚未开放',
      action: count ? { label: '查看设施', to: planetPath } : missing.length ? researchAction(missing[0]) : canBuild ? { label: '选择建造位置', to: `${planetPath}?build=${id}` } : { label: '查看科技树', to: '/tech' },
    };
  };
  const observed = (id: string, label: string, complete: boolean, detail: string, target: string, actionLabel: string): ProgressionGoal => ({ id, label, complete, detail, action: { label: actionLabel, to: workflow(target) } });
  const stations = runtime?.available && runtime.planet_id === planet.planet_id ? runtime.logistics_stations?.filter(station => station.owner_id === player?.player_id) ?? [] : [];
  const drones = runtime?.available && runtime.planet_id === planet.planet_id ? runtime.logistics_drones?.filter(drone => drone.owner_id === player?.player_id) ?? [] : [];
  const ships = runtime?.available && runtime.planet_id === planet.planet_id ? runtime.logistics_ships?.filter(ship => ship.owner_id === player?.player_id) ?? [] : [];
  const hasDrone = stations.some(station => station.drone_ids?.length) || drones.length > 0;
  const hasShip = stations.some(station => station.ship_ids?.length) || ships.length > 0;
  const orbit = systemRuntime?.available && systemRuntime.system_id === planet.system_id && systemRuntime.solar_sail_orbit?.player_id === player?.player_id ? systemRuntime.solar_sail_orbit : undefined;
  const sphere = systemRuntime?.available && systemRuntime.system_id === planet.system_id && systemRuntime.dyson_sphere?.player_id === player?.player_id ? systemRuntime.dyson_sphere : undefined;
  const stellarEnergy = (orbit?.total_energy ?? 0) + (sphere?.total_energy ?? 0);
  const stages: Omit<ProgressionStage, 'complete'>[] = [
    { id: 'landing', title: '落地与供电', icon: 'wind_turbine', description: '把第一座基地接入电网，建立科研起点。', goals: [buildingGoal('wind_turbine'), buildingGoal('matrix_lab'), techGoal('electromagnetism')] },
    { id: 'automation', title: '自动化工厂', icon: 'assembling_machine_mk1', description: '开采、冶炼、制造，再用传送带与分拣器连接供需。', goals: [techGoal('basic_logistics_system'), buildingGoal('mining_machine'), buildingGoal('arc_smelter'), buildingGoal('assembling_machine_mk1'), buildingGoal('conveyor_belt_mk1'), buildingGoal('sorter_mk1')] },
    { id: 'science', title: '矩阵与科研', icon: 'matrix_lab', description: '扩大矩阵生产，沿科技前置条件推进能源与制造能力。', goals: [techGoal('energy_matrix'), observed('matrix-production', '启动矩阵生产周期', buildings.some(building => building.runtime.state === 'running' && (building.production?.remaining_ticks ?? 0) > 0 && catalog.recipes?.some(recipe => recipe.id === building.production?.recipe_id && recipe.outputs.some(output => output.quantity > 0 && output.item_id.endsWith('_matrix')))), '确认设施已进入矩阵生产周期；研究站需要装入对应矩阵。', 'research', '打开研究工作台')] },
    { id: 'planetary', title: '行星物流', icon: 'planetary_logistics_station', description: '建立供货与需求站，用运输机连接远距离产线。', goals: [techGoal('planetary_logistics'), buildingGoal('planetary_logistics_station'), observed('logistics-drone', '为物流站配备运输机', hasDrone, hasDrone ? '当前行星物流站已有运输机' : '在物流工作台生产或分配运输机，然后配置供需槽位。', 'logistics', '配置行星物流')] },
    { id: 'interstellar', title: '星际工业', icon: 'interstellar_logistics_station', description: '将行星工厂接入跨星球资源网络，补足稀缺原料。', goals: [techGoal('interstellar_logistics'), buildingGoal('interstellar_logistics_station'), observed('logistics-ship', '为物流站配备运输船', hasShip, hasShip ? '当前行星物流站已有运输船' : '在物流工作台配置运输船，再设置跨星球供需与航线。', 'cross_planet', '配置跨星球物流')] },
    { id: 'dyson', title: '戴森能源', icon: 'ray_receiver', description: '发射太阳帆、规划戴森结构，将恒星能源送回工厂。', goals: [techGoal('solar_sail_orbit'), buildingGoal('em_rail_ejector'), techGoal('ray_receiver'), buildingGoal('ray_receiver'), observed('stellar-energy', '建立恒星能源产出', stellarEnergy > 0, stellarEnergy > 0 ? `当前恒星系能源产出 ${stellarEnergy.toLocaleString('zh-CN')}/tick` : '向发射设施供应太阳帆，在戴森工作台发射并配置射线接收。', 'dyson', '打开戴森工作台')] },
  ];
  return stages.map(stage => ({ ...stage, complete: stage.goals.every(goal => goal.complete) }));
}
