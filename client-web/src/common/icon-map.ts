/**
 * iconKey → lucide SVG 节点数据（IconNode）映射：全站图标的唯一事实来源。
 *
 * - 数据深导入自 lucide-react 的单图标模块（`__iconNode`，24×24 viewBox 线稿），
 *   tree-shake 友好，不引入第二个图标库。
 * - DOM 侧由 common/Icon 用 lucide-react 的基础 <Icon iconNode> 渲染；
 *   Pixi 侧由 engine/textures 用 Path2D 把同一节点数据烘焙进 Canvas 纹理。
 * - key 覆盖建筑/资源/单位的核心 catalog key（含常见别名与 UI 语义别名）；
 *   未命中的 key 由调用方走回退（DOM 回退首字母，纹理回退字母字形）。
 */

import type { IconNode } from 'lucide-react';

import { __iconNode as atom } from 'lucide-react/dist/esm/icons/atom.mjs';
import { __iconNode as arrowDownWideNarrow } from 'lucide-react/dist/esm/icons/arrow-down-wide-narrow.mjs';
import { __iconNode as batteryCharging } from 'lucide-react/dist/esm/icons/battery-charging.mjs';
import { __iconNode as bomb } from 'lucide-react/dist/esm/icons/bomb.mjs';
import { __iconNode as bot } from 'lucide-react/dist/esm/icons/bot.mjs';
import { __iconNode as cog } from 'lucide-react/dist/esm/icons/cog.mjs';
import { __iconNode as crosshair } from 'lucide-react/dist/esm/icons/crosshair.mjs';
import { __iconNode as cylinder } from 'lucide-react/dist/esm/icons/cylinder.mjs';
import { __iconNode as droplet } from 'lucide-react/dist/esm/icons/droplet.mjs';
import { __iconNode as droplets } from 'lucide-react/dist/esm/icons/droplets.mjs';
import { __iconNode as factory } from 'lucide-react/dist/esm/icons/factory.mjs';
import { __iconNode as filter } from 'lucide-react/dist/esm/icons/funnel.mjs';
import { __iconNode as flame } from 'lucide-react/dist/esm/icons/flame.mjs';
import { __iconNode as flameKindling } from 'lucide-react/dist/esm/icons/flame-kindling.mjs';
import { __iconNode as flaskConical } from 'lucide-react/dist/esm/icons/flask-conical.mjs';
import { __iconNode as flaskRound } from 'lucide-react/dist/esm/icons/flask-round.mjs';
import { __iconNode as fuel } from 'lucide-react/dist/esm/icons/fuel.mjs';
import { __iconNode as gauge } from 'lucide-react/dist/esm/icons/gauge.mjs';
import { __iconNode as gem } from 'lucide-react/dist/esm/icons/gem.mjs';
import { __iconNode as globe } from 'lucide-react/dist/esm/icons/globe.mjs';
import { __iconNode as hammer } from 'lucide-react/dist/esm/icons/hammer.mjs';
import { __iconNode as hardHat } from 'lucide-react/dist/esm/icons/hard-hat.mjs';
import { __iconNode as history } from 'lucide-react/dist/esm/icons/rotate-ccw-clock.mjs';
import { __iconNode as layers } from 'lucide-react/dist/esm/icons/layers.mjs';
import { __iconNode as mountain } from 'lucide-react/dist/esm/icons/mountain.mjs';
import { __iconNode as moveRight } from 'lucide-react/dist/esm/icons/move-right.mjs';
import { __iconNode as orbit } from 'lucide-react/dist/esm/icons/orbit.mjs';
import { __iconNode as pickaxe } from 'lucide-react/dist/esm/icons/pickaxe.mjs';
import { __iconNode as plugZap } from 'lucide-react/dist/esm/icons/plug-zap.mjs';
import { __iconNode as radar } from 'lucide-react/dist/esm/icons/radar.mjs';
import { __iconNode as radio } from 'lucide-react/dist/esm/icons/radio.mjs';
import { __iconNode as radioTower } from 'lucide-react/dist/esm/icons/radio-tower.mjs';
import { __iconNode as radiation } from 'lucide-react/dist/esm/icons/radiation.mjs';
import { __iconNode as rocket } from 'lucide-react/dist/esm/icons/rocket.mjs';
import { __iconNode as satellite } from 'lucide-react/dist/esm/icons/satellite.mjs';
import { __iconNode as satelliteDish } from 'lucide-react/dist/esm/icons/satellite-dish.mjs';
import { __iconNode as shield } from 'lucide-react/dist/esm/icons/shield.mjs';
import { __iconNode as snowflake } from 'lucide-react/dist/esm/icons/snowflake.mjs';
import { __iconNode as sparkles } from 'lucide-react/dist/esm/icons/sparkles.mjs';
import { __iconNode as split } from 'lucide-react/dist/esm/icons/split.mjs';
import { __iconNode as sprayCan } from 'lucide-react/dist/esm/icons/spray-can.mjs';
import { __iconNode as sun } from 'lucide-react/dist/esm/icons/sun.mjs';
import { __iconNode as sword } from 'lucide-react/dist/esm/icons/sword.mjs';
import { __iconNode as target } from 'lucide-react/dist/esm/icons/target.mjs';
import { __iconNode as telescope } from 'lucide-react/dist/esm/icons/telescope.mjs';
import { __iconNode as triangleAlert } from 'lucide-react/dist/esm/icons/triangle-alert.mjs';
import { __iconNode as truck } from 'lucide-react/dist/esm/icons/truck.mjs';
import { __iconNode as warehouse } from 'lucide-react/dist/esm/icons/warehouse.mjs';
import { __iconNode as wind } from 'lucide-react/dist/esm/icons/wind.mjs';
import { __iconNode as wrench } from 'lucide-react/dist/esm/icons/wrench.mjs';
import { __iconNode as zap } from 'lucide-react/dist/esm/icons/zap.mjs';

/** iconKey → lucide 节点数据。建筑 key 与 config/defs 的实体 id 对齐。 */
export const ICON_MAP: Record<string, IconNode> = {
  // 建筑 —— 采集
  mining_machine: pickaxe,
  miner: pickaxe,
  advanced_mining_machine: pickaxe,
  oil_extractor: fuel,
  water_pump: droplet,
  orbital_collector: satellite,
  // 建筑 —— 生产/冶炼/化工
  assembling_machine_mk1: wrench,
  assembling_machine_mk2: wrench,
  assembling_machine_mk3: wrench,
  assembler: wrench,
  recomposing_assembler: wrench,
  arc_smelter: flame,
  negentropy_smelter: flame,
  plane_smelter: flame,
  chemical_plant: flaskRound,
  quantum_chemical_plant: flaskRound,
  oil_refinery: factory,
  fractionator: filter,
  spray_coater: sprayCan,
  automatic_piler: layers,
  pile_sorter: layers,
  miniature_particle_collider: atom,
  // 建筑 —— 能源
  solar_panel: sun,
  wind_turbine: wind,
  tesla_tower: zap,
  tesla: zap,
  wireless_power_tower: zap,
  satellite_substation: zap,
  thermal_power_plant: flame,
  geothermal_power_station: flame,
  mini_fusion_power_plant: radiation,
  accumulator: batteryCharging,
  accumulator_full: batteryCharging,
  energy_exchanger: plugZap,
  // 建筑 —— 科研/情报
  lab: flaskConical,
  research_station: flaskConical,
  matrix_lab: flaskConical,
  self_evolution_lab: flaskConical,
  battlefield_analysis_base: radar,
  // 建筑 —— 仓储/物流
  depot_mk1: warehouse,
  depot_mk2: warehouse,
  storage_tank: cylinder,
  logistics_station: satelliteDish,
  planetary_logistics_station: satelliteDish,
  interstellar_logistics_station: satellite,
  logistics_distributor: truck,
  conveyor_belt_mk1: moveRight,
  conveyor_belt_mk2: moveRight,
  conveyor_belt_mk3: moveRight,
  splitter: split,
  sorter_mk1: arrowDownWideNarrow,
  sorter_mk2: arrowDownWideNarrow,
  sorter_mk3: arrowDownWideNarrow,
  traffic_monitor: gauge,
  // 建筑 —— 防御/军事
  laser_turret: crosshair,
  gauss_turret: crosshair,
  missile_turret: target,
  plasma_turret: target,
  sr_plasma_turret: target,
  implosion_cannon: bomb,
  planetary_shield_generator: shield,
  signal_tower: radioTower,
  jammer_tower: radio,
  // 建筑 —— 戴森球/航天
  em_rail_ejector: orbit,
  vertical_launching_silo: rocket,
  ray_receiver: telescope,
  artificial_star: sparkles,
  // 资源
  iron_ore: mountain,
  copper_ore: mountain,
  stone: mountain,
  silicon_ore: gem,
  kimberlite_ore: gem,
  coal: flameKindling,
  oil: droplets,
  crude_oil: droplets,
  water: droplet,
  fire_ice: snowflake,
  gear: cog,
  // 单位
  worker: hardHat,
  soldier: sword,
  executor: bot,
  // UI 语义别名（chip/Tab/通知等复用同一映射）
  build: hammer,
  tech: atom,
  electromagnetism: atom,
  basic_logistics_system: truck,
  power: plugZap,
  energy: batteryCharging,
  logistics: truck,
  fleet: rocket,
  planet: globe,
  system: orbit,
  galaxy: orbit,
  alert: triangleAlert,
  intel: radar,
  replay: history,
};

/** 解析 iconKey → lucide 节点数据；未命中返回 null（调用方走各自回退）。 */
export function resolveIconNode(iconKey: string | undefined): IconNode | null {
  if (!iconKey) {
    return null;
  }
  return ICON_MAP[iconKey] ?? null;
}
